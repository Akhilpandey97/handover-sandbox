import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/hooks/useActivityLogs";
import { executeAction, previewAction, streamChat, undoBuddyAction } from "./api";
import {
  type BuddyAction,
  type BuddyMessage,
  type BuddyPage,
  type BuddySource,
  type Mention,
  type Thread,
  newId,
} from "./types";

const RECENT_WINDOW = 400;
const DELETE_DELAY_MS = 6000;

interface Row {
  id: string;
  role: string;
  content: string;
  created_at: string;
  conversation_id: string | null;
  metadata?: Record<string, any> | null;
}

/** Transient states are stored as the state a reloaded thread can act on. */
const storableActions = (actions?: BuddyAction[]) =>
  actions?.map((a) => ({
    ...a,
    status: a.status === "previewing" || a.status === "executing" ? "pending" : a.status,
  }));

const metaOf = (m: BuddyMessage) => ({
  steps: m.steps?.length ? m.steps : undefined,
  sources: m.sources?.length ? m.sources : undefined,
  reports: m.reports?.length ? m.reports : undefined,
  actions: storableActions(m.actions),
  feedback: m.feedback,
  error: m.error,
  stopped: m.stopped || undefined,
});

const fromRow = (r: Row): BuddyMessage => ({
  id: r.id,
  dbId: r.id,
  role: r.role === "user" ? "user" : "assistant",
  content: r.content,
  createdAt: r.created_at,
  steps: r.metadata?.steps,
  sources: r.metadata?.sources,
  reports: r.metadata?.reports,
  actions: r.metadata?.actions,
  feedback: r.metadata?.feedback,
  error: r.metadata?.error,
  stopped: r.metadata?.stopped,
});

/** What the model sees of earlier turns, including what happened to proposed actions. */
const toModelHistory = (messages: BuddyMessage[]) =>
  messages
    .map((m) => {
      let content = m.content || "";
      if (m.role === "assistant" && m.actions?.length) {
        const notes = m.actions.map((a) => {
          const what = a.preview?.title || a.name.replace(/_/g, " ");
          const outcome =
            a.status === "done"
              ? `done: ${a.result?.message || ""}`
              : a.status === "undone"
                ? "done, then undone"
                : a.status === "cancelled"
                  ? "cancelled by the user"
                  : a.status === "failed"
                    ? `failed: ${a.error || ""}`
                    : "waiting for approval";
          return `[Proposed action: ${what}${a.preview?.target ? ` on ${a.preview.target.label}` : ""}, ${outcome}]`;
        });
        content = `${content}\n\n${notes.join("\n")}`.trim();
      }
      return { role: m.role, content };
    })
    .filter((m) => m.content.trim());

const mergeSources = (a: BuddySource[] = [], b: BuddySource[] = []) => {
  const seen = new Set(a.map((s) => `${s.kind}:${s.id || s.label}`));
  const out = [...a];
  for (const s of b) {
    const key = `${s.kind}:${s.id || s.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
};

export function useBuddyChat({ page, onAnswer }: { page: BuddyPage; onAnswer?: (text: string) => void }) {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const userId = currentUser?.id;

  const [messages, setMessages] = useState<BuddyMessage[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [pins, setPins] = useState<string[]>([]);

  const messagesRef = useRef<BuddyMessage[]>([]);
  messagesRef.current = messages;
  const conversationRef = useRef<string | null>(null);
  conversationRef.current = conversationId;
  const abortRef = useRef<AbortController | null>(null);
  const metadataSupported = useRef(true);
  const pageRef = useRef(page);
  pageRef.current = page;
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;

  const pinKey = userId ? `buddy:pins:${userId}` : null;
  useEffect(() => {
    if (!pinKey) return;
    try {
      setPins(JSON.parse(localStorage.getItem(pinKey) || "[]"));
    } catch {
      setPins([]);
    }
  }, [pinKey]);

  const togglePin = useCallback(
    (id: string | null) => {
      if (!pinKey || id === null) return;
      setPins((prev) => {
        const next = prev.includes(id) ? prev.filter((p) => p !== id) : [id, ...prev];
        try {
          localStorage.setItem(pinKey, JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
    },
    [pinKey],
  );

  const patchMessage = useCallback((id: string, fn: (m: BuddyMessage) => BuddyMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const patchAction = useCallback(
    (messageId: string, callId: string, fn: (a: BuddyAction) => BuddyAction) => {
      patchMessage(messageId, (m) => ({ ...m, actions: m.actions?.map((a) => (a.callId === callId ? fn(a) : a)) }));
    },
    [patchMessage],
  );

  // ── Persistence ─────────────────────────────────────────────────────────
  const fetchRows = useCallback(
    async (conversation?: string | null): Promise<Row[]> => {
      if (!userId) return [];
      const build = (cols: string) => {
        let q = (supabase as any).from("chat_messages").select(cols).eq("user_id", userId);
        if (conversation !== undefined) {
          q = conversation === null ? q.is("conversation_id", null) : q.eq("conversation_id", conversation);
          return q.order("created_at", { ascending: true });
        }
        return q.order("created_at", { ascending: false }).limit(RECENT_WINDOW);
      };
      let res = await build("id, role, content, created_at, conversation_id, metadata");
      if (res.error) {
        metadataSupported.current = false;
        res = await build("id, role, content, created_at, conversation_id");
      }
      const rows = (res.data || []) as Row[];
      return conversation === undefined ? rows.slice().reverse() : rows;
    },
    [userId],
  );

  const groupThreads = (rows: Row[]) => {
    const byConversation = new Map<string | null, Row[]>();
    for (const r of rows) {
      const key = r.conversation_id ?? null;
      if (!byConversation.has(key)) byConversation.set(key, []);
      byConversation.get(key)!.push(r);
    }
    const list: Thread[] = Array.from(byConversation.entries())
      .map(([id, msgs]) => {
        const firstUser = msgs.find((m) => m.role === "user");
        return {
          id,
          title: id === null ? "Earlier messages" : (firstUser?.content || "New chat").slice(0, 70),
          at: msgs[msgs.length - 1]!.created_at,
        };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
    return { byConversation, list };
  };

  const refreshThreads = useCallback(async () => {
    const rows = await fetchRows();
    setThreads(groupThreads(rows).list);
  }, [fetchRows]);

  useEffect(() => {
    if (!userId || historyLoaded) return;
    (async () => {
      const rows = await fetchRows();
      const { byConversation, list } = groupThreads(rows);
      setThreads(list);
      const active = list[0]?.id ?? newId();
      setConversationId(active);
      setMessages((byConversation.get(active) || []).map(fromRow));
      setHistoryLoaded(true);
    })();
  }, [userId, historyLoaded, fetchRows]);

  const saveMessage = useCallback(
    async (m: BuddyMessage) => {
      if (!userId) return;
      const convo = conversationRef.current ?? newId();
      if (conversationRef.current === null) setConversationId(convo);
      const base = { user_id: userId, role: m.role, content: m.content, conversation_id: convo };
      let res = metadataSupported.current
        ? await (supabase as any).from("chat_messages").insert({ ...base, metadata: metaOf(m) }).select("id").single()
        : await (supabase as any).from("chat_messages").insert(base).select("id").single();
      if (res.error && metadataSupported.current) {
        metadataSupported.current = false;
        res = await (supabase as any).from("chat_messages").insert(base).select("id").single();
      }
      const dbId = (res.data as { id?: string } | null)?.id;
      if (dbId) patchMessage(m.id, (x) => ({ ...x, dbId }));
      return dbId;
    },
    [userId, patchMessage],
  );

  const persistMeta = useCallback((messageId: string) => {
    if (!metadataSupported.current) return;
    // Read after React applies the pending update.
    window.setTimeout(() => {
      const m = messagesRef.current.find((x) => x.id === messageId);
      if (!m?.dbId) return;
      void (supabase as any).from("chat_messages").update({ metadata: metaOf(m) }).eq("id", m.dbId);
    }, 0);
  }, []);

  // ── Sending ─────────────────────────────────────────────────────────────
  const loadPreviews = useCallback(
    async (messageId: string, actions: BuddyAction[]) => {
      await Promise.all(
        actions.map(async (a) => {
          try {
            const preview = await previewAction(a.name, a.arguments);
            patchAction(messageId, a.callId, (x) => ({ ...x, status: "pending", preview }));
          } catch (e) {
            patchAction(messageId, a.callId, (x) => ({ ...x, status: "failed", error: (e as Error).message }));
          }
        }),
      );
    },
    [patchAction],
  );

  const send = useCallback(
    async (text: string, mentions: Mention[] = []) => {
      const content = text.trim();
      if (!content || isLoading || !userId) return;

      const userMsg: BuddyMessage = { id: newId(), role: "user", content, createdAt: new Date().toISOString() };
      const assistant: BuddyMessage = {
        id: newId(),
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        steps: [],
        sources: [],
        streaming: true,
      };
      const history = toModelHistory([...messagesRef.current, userMsg]);
      setMessages((prev) => [...prev, userMsg, assistant]);
      setIsLoading(true);
      void saveMessage(userMsg);

      const controller = new AbortController();
      abortRef.current = controller;
      let proposed: BuddyAction[] = [];
      let answer = "";

      try {
        await streamChat({
          messages: history,
          page: pageRef.current,
          mentions,
          signal: controller.signal,
          onEvent: (evt) => {
            switch (evt.type) {
              case "delta":
                answer += evt.content;
                patchMessage(assistant.id, (m) => ({ ...m, content: m.content + evt.content }));
                break;
              case "step":
                patchMessage(assistant.id, (m) => ({ ...m, steps: [...(m.steps || []), evt.label] }));
                break;
              case "sources":
                patchMessage(assistant.id, (m) => ({ ...m, sources: mergeSources(m.sources, evt.items) }));
                break;
              case "report":
                patchMessage(assistant.id, (m) => ({ ...m, reports: [...(m.reports || []), evt.report] }));
                break;
              case "actions":
                proposed = evt.calls.map((c) => ({ callId: c.id, name: c.name, arguments: c.arguments || {}, status: "previewing" }));
                patchMessage(assistant.id, (m) => ({ ...m, actions: proposed }));
                break;
              case "error":
                patchMessage(assistant.id, (m) => ({ ...m, error: evt.message }));
                break;
            }
          },
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          patchMessage(assistant.id, (m) => ({ ...m, stopped: true }));
        } else {
          patchMessage(assistant.id, (m) => ({ ...m, error: (e as Error).message }));
        }
      } finally {
        abortRef.current = null;
        patchMessage(assistant.id, (m) => ({ ...m, streaming: false }));
        setIsLoading(false);
      }

      if (proposed.length) await loadPreviews(assistant.id, proposed);
      const final = messagesRef.current.find((m) => m.id === assistant.id);
      if (final) {
        const snapshot: BuddyMessage = { ...final, streaming: false };
        await saveMessage(snapshot);
        if (answer && onAnswerRef.current) onAnswerRef.current(answer);
      }
      void refreshThreads();
    },
    [isLoading, userId, saveMessage, patchMessage, loadPreviews, refreshThreads],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const retry = useCallback(
    (assistantId: string) => {
      const list = messagesRef.current;
      const idx = list.findIndex((m) => m.id === assistantId);
      const question = [...list.slice(0, idx)].reverse().find((m) => m.role === "user");
      if (!question) return;
      setMessages((prev) => prev.filter((m) => m.id !== assistantId || !(m.error || m.stopped)));
      void send(question.content);
    },
    [send],
  );

  // ── Actions ─────────────────────────────────────────────────────────────
  const refreshData = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const approve = useCallback(
    async (messageId: string, callId: string, overrides: Record<string, any> = {}) => {
      const m = messagesRef.current.find((x) => x.id === messageId);
      const action = m?.actions?.find((a) => a.callId === callId);
      if (!action) return;
      patchAction(messageId, callId, (a) => ({ ...a, status: "executing", error: undefined }));
      try {
        const res = await executeAction(action.name, { ...action.arguments, ...overrides });
        patchAction(messageId, callId, (a) => ({
          ...a,
          arguments: { ...a.arguments, ...overrides },
          status: "done",
          result: { message: res.message, link: res.link, logId: res.log_id, undoable: res.undoable, undoUntil: res.undo_until },
        }));
        toast.success(res.message);
        refreshData();
      } catch (e) {
        patchAction(messageId, callId, (a) => ({ ...a, status: "failed", error: (e as Error).message }));
        toast.error((e as Error).message);
      }
      persistMeta(messageId);
    },
    [patchAction, persistMeta, refreshData],
  );

  const cancel = useCallback(
    (messageId: string, callId: string) => {
      const action = messagesRef.current.find((x) => x.id === messageId)?.actions?.find((a) => a.callId === callId);
      patchAction(messageId, callId, (a) => ({ ...a, status: "cancelled" }));
      persistMeta(messageId);
      if (action) {
        void logActivity({
          action_type: "ai",
          category: "buddy_action_cancelled",
          description: `Cancelled a Buddy action: ${action.preview?.title || action.name.replace(/_/g, " ")}`,
          metadata: { action: action.name },
        });
      }
    },
    [patchAction, persistMeta],
  );

  const undo = useCallback(
    async (messageId: string, callId: string) => {
      const m = messagesRef.current.find((x) => x.id === messageId);
      const logId = m?.actions?.find((a) => a.callId === callId)?.result?.logId;
      if (!logId) return;
      try {
        const res = await undoBuddyAction(logId);
        patchAction(messageId, callId, (a) => ({ ...a, status: "undone" }));
        toast.success(res.message);
        refreshData();
      } catch (e) {
        toast.error((e as Error).message);
      }
      persistMeta(messageId);
    },
    [patchAction, persistMeta, refreshData],
  );

  const setFeedback = useCallback(
    (messageId: string, value: "up" | "down") => {
      const list = messagesRef.current;
      const idx = list.findIndex((m) => m.id === messageId);
      const m = list[idx];
      if (!m) return;
      const next = m.feedback === value ? undefined : value;
      patchMessage(messageId, (x) => ({ ...x, feedback: next }));
      persistMeta(messageId);
      if (next) {
        const question = [...list.slice(0, idx)].reverse().find((x) => x.role === "user");
        void logActivity({
          action_type: "ai",
          category: "buddy_feedback",
          description: `Buddy answer rated ${next === "up" ? "helpful" : "not helpful"}`,
          metadata: {
            value: next,
            question: question?.content?.slice(0, 1000),
            answer: m.content.slice(0, 3000),
            conversation_id: conversationRef.current,
            message_id: m.dbId,
          },
        });
      }
    },
    [patchMessage, persistMeta],
  );

  // ── Threads ─────────────────────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setConversationId(newId());
    setMessages([]);
  }, []);

  const openThread = useCallback(
    async (id: string | null) => {
      abortRef.current?.abort();
      const rows = await fetchRows(id);
      setConversationId(id);
      setMessages(rows.map(fromRow));
    },
    [fetchRows],
  );

  const deleteThread = useCallback(
    (id: string | null) => {
      if (!userId) return;
      const removed = threads.find((t) => t.id === id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (id === conversationRef.current) startNewChat();

      let undone = false;
      const timer = window.setTimeout(async () => {
        if (undone) return;
        let q = (supabase as any).from("chat_messages").delete().eq("user_id", userId);
        q = id === null ? q.is("conversation_id", null) : q.eq("conversation_id", id);
        const { error } = await q;
        if (error) {
          toast.error("Couldn't delete that chat.");
          void refreshThreads();
        }
      }, DELETE_DELAY_MS);

      toast("Chat deleted", {
        description: removed?.title,
        action: {
          label: "Undo",
          onClick: () => {
            undone = true;
            window.clearTimeout(timer);
            void refreshThreads();
          },
        },
      });
    },
    [userId, threads, startNewChat, refreshThreads],
  );

  return {
    messages,
    threads,
    pins,
    conversationId,
    isLoading,
    historyLoaded,
    send,
    stop,
    retry,
    approve,
    cancel,
    undo,
    setFeedback,
    startNewChat,
    openThread,
    deleteThread,
    togglePin,
  };
}
