import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { calculateTimeFromChecklist, formatDuration } from "@/data/projectsData";
import { Send, Plus, Loader2, Bot, User, CheckCheck, Trash2, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/hooks/useActivityLogs";
import { arrCroreValue } from "@/lib/arr";
import { apiAuthHeaders } from "@/lib/api-invoke";

type Msg = { role: "user" | "assistant"; content: string; time: string; toolCalls?: ToolCall[] };
type ToolCall = { id: string; name: string; arguments: any; status?: "pending" | "executing" | "done" | "failed"; result?: string };

const CHAT_URL = `/api/public/ai-chat`;
const ACTIONS_URL = `/api/public/ai-actions`;

const getTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Actions that need approval before executing
// ALL actions require user approval before executing
const APPROVAL_ACTIONS = new Set(["create_workflow", "bulk_update_projects", "assign_owner", "update_project_field", "trigger_brd", "toggle_responsibility", "create_project"]);

// Roles that can use AI action capabilities
const ACTION_ROLES = new Set(["manager", "admin", "super_admin"]);
const canUseActions = (team?: string) => ACTION_ROLES.has(team || "");

// Roles whose dashboard shows the whole portfolio. Everyone else works from
// their own assigned projects, and the assistant must not widen that: it would
// otherwise describe every merchant in the tenant to someone who cannot see
// them on any screen.
const PORTFOLIO_ROLES = new Set(["manager", "admin", "super_admin", "gokwik_general"]);

const ACTION_SUGGESTIONS = [
  { emoji: "➕", text: "Create a new project", message: "Create a new project — ask me for merchant name, MID, and kick-off date", actionOnly: true },
  { emoji: "👤", text: "Assign an owner to a project", message: "Assign an owner to a project that needs one", actionOnly: true },
  { emoji: "📊", text: "Update project fields", message: "Update a project field (state, phase, notes)", actionOnly: true },
  { emoji: "⚡", text: "Create a workflow rule", message: "Suggest and create automated workflow rules for my projects", actionOnly: true },
  { emoji: "📋", text: "Trigger BRD for a project", message: "Trigger BRD for a project - send the BRD form to the merchant", actionOnly: true },
  { emoji: "🔄", text: "Toggle responsibility", message: "Toggle the responsibility (GoKwik/Merchant/Neutral) for a project", actionOnly: true },
  { emoji: "🔍", text: "Analyze project risks", message: "Which projects are at risk and why?", actionOnly: false },
  { emoji: "💡", text: "Suggest automations", message: "What automated workflows would you suggest for my current projects?", actionOnly: false },
];

/**
 * The assistant, as a full page. It used to be a 420x600 panel pinned over the
 * bottom-left of the dashboard; it now fills the Hi There tab, so long answers,
 * tool approvals and history have room to be read.
 */
export const AiChatBot = () => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // One thread at a time, chosen from the recent list. Existing messages have
  // no conversation_id, so they group under a single "Earlier" entry.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    Array<{ id: string | null; title: string; at: string }>
  >([]);
  const [pendingApproval, setPendingApproval] = useState<{ toolCall: ToolCall; msgIndex: number } | null>(null);
  const queryClient = useQueryClient();
  const silenceTimerRef = useRef<number | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // "@" mentions: pick a project or a person to point Buddy at something
  // specific, rather than relying on it to guess from twenty projects of
  // context.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const mentionedRef = useRef<Map<string, { kind: "project" | "person"; id: string; name: string }>>(new Map());
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef("");
  const fullTranscriptRef = useRef("");
  const autoSpeakRef = useRef(false);
  const { projects } = useProjects();
  const { currentUser } = useAuth();
  const { teamLabels, responsibilityLabels } = useLabels();

  // Keep autoSpeakRef in sync so sendMessage closure always sees latest value
  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);

  // ── Speech-to-Text ──────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice input not supported in this browser. Try Chrome or Edge.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    finalTranscriptRef.current = "";
    recognitionRef.current = recognition;

    recognition.onstart = () => setIsListening(true);

    // Chrome only ends a continuous session after its own long silence
    // timeout, so the message sat there for seconds after you stopped talking.
    // Close it ourselves once speech has actually paused.
    const SILENCE_MS = 1600;
    const armSilenceTimer = () => {
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => {
        try { recognition.stop(); } catch { /* already stopped */ }
      }, SILENCE_MS);
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = finalTranscriptRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) { final += t + " "; }
        else { interim = t; }
      }
      finalTranscriptRef.current = final;
      const full = (final + interim).trim();
      fullTranscriptRef.current = full;
      setLiveTranscript(full);
      setInput(full);
      armSilenceTimer();
    };

    recognition.onend = () => {
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      setIsListening(false);
      const text = fullTranscriptRef.current || finalTranscriptRef.current.trim();
      setLiveTranscript("");
      fullTranscriptRef.current = "";
      finalTranscriptRef.current = "";
      if (text) {
        setInput("");
        sendMessageRef.current(text);
      }
    };

    recognition.onerror = (e: any) => {
      setIsListening(false);
      setLiveTranscript("");
      if (e.error !== "no-speech" && e.error !== "aborted") {
        toast.error(`Mic error: ${e.error}`);
      }
    };

    recognition.start();
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { recognitionRef.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  // ── Text-to-Speech ──────────────────────────────────────────────────────────
  /**
   * Pick the least synthetic voice the browser offers.
   *
   * Nothing was chosen before, so it fell back to the platform default, which
   * is the robotic one. Network voices (Google, Neural, Natural) are markedly
   * better than the built-in ones; among those, prefer a female voice. Voices
   * load asynchronously, hence the voiceschanged listener.
   */
  useEffect(() => {
    let cancelled = false;
    supabase.from("profiles").select("id, name").order("name").then(({ data }) => {
      if (!cancelled) setPeople((data || []) as Array<{ id: string; name: string }>);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!window.speechSynthesis) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      const score = (v: SpeechSynthesisVoice) => {
        const n = v.name.toLowerCase();
        if (!v.lang.toLowerCase().startsWith("en")) return -1;
        let s = 0;
        if (/google|natural|neural|premium|enhanced/.test(n)) s += 6;
        if (/female|samantha|zira|aria|jenny|sonia|libby|serena|karen|moira|tessa|fiona/.test(n)) s += 4;
        if (!v.localService) s += 2;
        if (/en-gb|en-in/.test(v.lang.toLowerCase())) s += 1;
        return s;
      };
      const best = voices
        .map((v) => ({ v, s: score(v) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)[0];
      voiceRef.current = best?.v ?? null;
    };
    pick();
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pick);
  }, []);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    // Strip markdown for cleaner speech
    const clean = text.replace(/\*\*|__|~~|\[([^\]]+)\]\([^)]+\)|`{1,3}[^`]*`{1,3}|#{1,6}\s/g, "").trim();
    const utt = new SpeechSynthesisUtterance(clean);
    if (voiceRef.current) {
      utt.voice = voiceRef.current;
      utt.lang = voiceRef.current.lang;
    } else {
      utt.lang = "en-IN";
    }
    // Slightly under natural pace, and a touch of pitch, reads far less flat.
    utt.rate = 0.98;
    utt.pitch = 1.05;
    window.speechSynthesis.speak(utt);
  }, []);

  // Load the recent window once, then derive both the thread list and the
  // active thread from it. Grouping client-side avoids an RPC for what is a
  // per-user handful of rows.
  const RECENT_WINDOW = 400;

  /** Fetch the recent window and group it into threads. */
  const fetchThreads = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) return null;
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content, created_at, conversation_id")
      .eq("user_id", session.session.user.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_WINDOW);

    const rows = ((data || []) as Array<{
      role: string; content: string; created_at: string; conversation_id: string | null;
    }>).slice().reverse();

    const byConversation = new Map<string | null, typeof rows>();
    for (const r of rows) {
      const key = r.conversation_id ?? null;
      if (!byConversation.has(key)) byConversation.set(key, []);
      byConversation.get(key)!.push(r);
    }

    const list = Array.from(byConversation.entries()).map(([id, msgs]) => {
      const firstUser = msgs.find((m) => m.role === "user");
      const title = id === null ? "Earlier messages" : (firstUser?.content || "New chat").slice(0, 60);
      return { id, title, at: msgs[msgs.length - 1]!.created_at };
    }).sort((a, b) => b.at.localeCompare(a.at));

    return { byConversation, list };
  };

  const loadHistory = useCallback(async () => {
    const result = await fetchThreads();
    if (!result) return;
    const { byConversation, list } = result;

    setConversations(list);

    // Open the most recent thread on first load.
    const active = conversationId !== null || historyLoaded ? conversationId : (list[0]?.id ?? null);
    if (!historyLoaded) setConversationId(active);

    const shown = byConversation.get(active) || [];
    setMessages(shown.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })));
    setHistoryLoaded(true);
  }, [conversationId, historyLoaded]);

  useEffect(() => {
    if (!currentUser || historyLoaded) return;
    loadHistory();
  }, [currentUser, historyLoaded, loadHistory]);

  /**
   * Refresh only the thread list. It used to reset historyLoaded, which reran
   * loadHistory and replaced the open thread with what is in the database —
   * wiping any message held only in memory. The approval prompt is exactly
   * that, so it appeared and then vanished, leaving the buttons with nothing
   * to explain what they would do.
   */
  const refreshConversations = async () => {
    const result = await fetchThreads();
    if (result) setConversations(result.list);
  };

  const startNewChat = () => {
    setConversationId(crypto.randomUUID());
    setMessages([]);
    setPendingApproval(null);
  };

  const openConversation = async (id: string | null) => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) return;
    let q = supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("user_id", session.session.user.id)
      .order("created_at", { ascending: true });
    q = id === null ? q.is("conversation_id", null) : q.eq("conversation_id", id);
    const { data } = await q;
    setConversationId(id);
    setPendingApproval(null);
    setMessages(((data || []) as any[]).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })));
  };

  const saveMessage = async (role: "user" | "assistant", content: string) => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) return;
    // A thread id is minted on first send so a fresh tab does not need one up front.
    const convo = conversationId ?? crypto.randomUUID();
    if (conversationId === null) setConversationId(convo);
    await supabase.from("chat_messages").insert({
      user_id: session.session.user.id, role, content, conversation_id: convo,
    });
  };

  /**
   * Delete one thread. Scoped by user_id as well as the conversation, so a
   * crafted id cannot reach someone else's messages even if RLS were ever
   * loosened. The NULL group is addressable too — it is a real thread to
   * whoever has one.
   */
  const deleteConversation = async (id: string | null) => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) return;

    let q = supabase.from("chat_messages").delete().eq("user_id", session.session.user.id);
    q = id === null ? q.is("conversation_id", null) : q.eq("conversation_id", id);
    const { error } = await q;
    if (error) {
      toast.error("Could not delete that chat");
      return;
    }

    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);

    // Only move the user if they were reading the thread that just went.
    if (id === conversationId) {
      const next = remaining[0]?.id ?? null;
      setPendingApproval(null);
      if (remaining.length) {
        await openConversation(next);
      } else {
        setConversationId(crypto.randomUUID());
        setMessages([]);
      }
    }
    toast.success("Chat deleted");
  };

  const clearHistory = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) return;
    await supabase.from("chat_messages").delete().eq("user_id", session.session.user.id);
    setMessages([]);
    setPendingApproval(null);
    setConversations([]);
    setConversationId(crypto.randomUUID());
    toast.success("Chat history cleared");
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Focus the composer when the tab opens.
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const scopedProjects = useMemo(
    () =>
      PORTFOLIO_ROLES.has(currentUser?.team || "")
        ? projects
        : projects.filter((p) => p.assignedOwner === currentUser?.id),
    [projects, currentUser?.team, currentUser?.id],
  );

  const getProjectContext = useCallback(() => {
    if (!scopedProjects.length) return "";
    const summary = scopedProjects.slice(0, 20).map(p => {
      const time = calculateTimeFromChecklist(p.checklist);
      const completed = p.checklist.filter(c => c.completed).length;
      const total = p.checklist.length;
      return `- ${p.merchantName} (${p.mid}, ID=${p.id}): Phase=${p.currentPhase}, State=${p.projectState}, Team=${teamLabels[p.currentOwnerTeam] || p.currentOwnerTeam}, Owner=${p.assignedOwnerName || "Unassigned"}, OwnerID=${p.assignedOwner || "none"}, Tasks=${completed}/${total}, ${responsibilityLabels.gokwik}Time=${formatDuration(time.gokwik)}, ${responsibilityLabels.merchant}Time=${formatDuration(time.merchant)}, ARR=${arrCroreValue(p.arr)}Cr`;
    }).join("\n");
    return `Total projects: ${scopedProjects.length}\n${summary}`;
  }, [scopedProjects, teamLabels, responsibilityLabels]);

  /**
   * Pull the app's data back in after an action changed it.
   *
   * Nothing here invalidated anything, so an assignment succeeded in the
   * database while the project page kept showing its cached copy — the owner
   * name is resolved from profiles at query time, so only a refetch reveals it.
   */
  const refreshAfterAction = (action: string) => {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    if (action.includes("workflow")) {
      queryClient.invalidateQueries({ queryKey: ["ai_workflows"] });
      queryClient.invalidateQueries({ queryKey: ["workflow_runs"] });
    }
  };

  const executeToolCall = async (toolCall: ToolCall): Promise<string> => {
    // Role check - only managers/super_admin can execute actions
    if (!canUseActions(currentUser?.team)) {
      return "Error: You don't have permission to execute AI actions. Contact a manager.";
    }

    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return "Error: Not authenticated";

    try {
      const resp = await fetch(ACTIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: toolCall.name, params: toolCall.arguments }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Action failed");
      
      // Log user-initiated AI action
      await logActivity({
        action_type: "ai",
        category: "project",
        description: `AI action: ${toolCall.name} - ${result.message || "completed"}`,
        metadata: { toolCall: toolCall.name, params: toolCall.arguments, result },
      });

      return result.message || "Action completed successfully";
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      await logActivity({
        action_type: "ai",
        category: "api",
        description: `AI action failed: ${toolCall.name} - ${errMsg}`,
        metadata: { toolCall: toolCall.name, params: toolCall.arguments, error: errMsg },
        status: "failed",
      });
      return `Error: ${errMsg}`;
    }
  };

  const sendMessageRef = useRef<(override?: string) => void>(async () => {});
  /**
   * Names the user @-mentioned, with their ids.
   *
   * The model otherwise has to guess which "Urban Threads" is meant from twenty
   * projects of context, and an action needs the id, not the name.
   */
  const mentionContext = (text: string): string => {
    const used = Array.from(mentionedRef.current.values()).filter((m) => text.includes(`@${m.name}`));
    if (used.length === 0) return "";
    const lines = used.map((m) =>
      m.kind === "project"
        ? `- Project "${m.name}" (ID=${m.id})`
        : `- Person "${m.name}" (user ID=${m.id})`,
    );
    return `The user referred to these specifically — act on them unless they say otherwise:\n${lines.join("\n")}\n\n`;
  };

  const sendMessage = async (overrideInput?: string) => {
    const text = overrideInput || input.trim();
    if (!text || isLoading) return;
    const userMsg: Msg = { role: "user", content: text, time: getTime() };
    if (!overrideInput) setInput("");
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    saveMessage("user", userMsg.content);
    if (inputRef.current) inputRef.current.style.height = "auto";

    let assistantSoFar = "";
    let toolCalls: ToolCall[] = [];
    const allMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await apiAuthHeaders()),
        },
        body: JSON.stringify({
          messages: allMessages,
          projectContext: mentionContext(text) + getProjectContext(),
          enableActions: canUseActions(currentUser?.team),
        }),
      });

      if (resp.status === 429) { toast.error("Rate limit exceeded."); setIsLoading(false); return; }
      if (resp.status === 402) { toast.error("AI credits exhausted."); setIsLoading(false); return; }
      if (!resp.ok || !resp.body) throw new Error("Failed to start stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;
      const assistantTime = getTime();

      // Accumulate tool call deltas
      const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map();

      const processSSELine = (jsonStr: string) => {
        try {
          const parsed = JSON.parse(jsonStr);
          const choice = parsed.choices?.[0];
          if (!choice) return;

          const delta = choice.delta;
          if (delta?.content) {
            assistantSoFar += delta.content;
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
              }
              return [...prev, { role: "assistant", content: assistantSoFar, time: assistantTime }];
            });
          }

          // Handle tool call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallAccum.has(idx)) {
                toolCallAccum.set(idx, { id: tc.id || "", name: "", args: "" });
              }
              const accum = toolCallAccum.get(idx)!;
              if (tc.id) accum.id = tc.id;
              if (tc.function?.name) accum.name += tc.function.name;
              if (tc.function?.arguments) accum.args += tc.function.arguments;
            }
          }

          // If finish_reason is "tool_calls", we have completed tool calls
          if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
            if (toolCallAccum.size > 0) {
              toolCalls = Array.from(toolCallAccum.values()).map(tc => ({
                id: tc.id,
                name: tc.name,
                arguments: (() => { try { return JSON.parse(tc.args); } catch { return {}; } })(),
                status: "pending" as const,
              }));
            }
          }
        } catch {
          // incomplete JSON, ignore
        }
      };

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          processSSELine(jsonStr);
        }
      }

      // Flush remaining buffer
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw || raw.startsWith(":") || raw.trim() === "") continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          processSSELine(jsonStr);
        }
      }

      // Process tool calls
      if (toolCalls.length > 0) {
        const results: string[] = [];
        for (const tc of toolCalls) {
          if (APPROVAL_ACTIONS.has(tc.name)) {
            // Needs approval - show to user
            const approvalMsg = `🔒 **Action requires approval:**\n\n**${tc.name}**: ${JSON.stringify(tc.arguments, null, 2)}\n\nClick ✅ to approve or ❌ to reject.`;
            setMessages(prev => [
              ...prev.filter(m => m.role !== "assistant" || m.content !== assistantSoFar || prev.indexOf(m) < prev.length - 1),
              ...(assistantSoFar ? [{ role: "assistant" as const, content: assistantSoFar, time: assistantTime }] : []),
              { role: "assistant" as const, content: approvalMsg, time: getTime(), toolCalls: [tc] },
            ]);
            setPendingApproval({ toolCall: tc, msgIndex: messages.length + 2 });
          } else {
            // Direct execution
            tc.status = "executing";
            const resultMsg = await executeToolCall(tc);
            tc.status = "done";
            refreshAfterAction(tc.name);
            tc.result = resultMsg;
            results.push(`✅ **${tc.name}**: ${resultMsg}`);
          }
        }

        if (results.length > 0) {
          const finalContent = (assistantSoFar ? assistantSoFar + "\n\n" : "") + results.join("\n\n");
          setMessages(prev => {
            const last = prev[prev.length - 1];
            // Never overwrite an approval prompt: when a reply mixes an action
            // needing approval with one that ran outright, the prompt is the
            // last message, and replacing it leaves the buttons unexplained.
            const isApprovalPrompt = !!last?.toolCalls?.length;
            if (last?.role === "assistant" && !isApprovalPrompt) {
              return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: finalContent } : m));
            }
            return [...prev, { role: "assistant", content: finalContent, time: assistantTime }];
          });
          saveMessage("assistant", finalContent);
          if (autoSpeakRef.current) speak(finalContent);
        }
      } else if (assistantSoFar) {
        saveMessage("assistant", assistantSoFar);
        if (autoSpeakRef.current) speak(assistantSoFar);
      }
    } catch (e) {
      console.error("Chat error:", e);
      toast.error("Failed to get AI response");
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again.", time: getTime() }]);
    } finally {
      setIsLoading(false);
      // A brand-new thread only earns a place in Recent once it has a message.
      refreshConversations();
    }
  };
  // Keep ref always pointing to the latest sendMessage so STT onend can call it without stale closure
  sendMessageRef.current = sendMessage;

  const handleApproval = async (approved: boolean) => {
    if (!pendingApproval) return;
    const { toolCall } = pendingApproval;
    setPendingApproval(null);

    if (approved) {
      setIsLoading(true);
      const resultMsg = await executeToolCall(toolCall);
      refreshAfterAction(toolCall.name);
      const content = `✅ **Approved & Executed** - ${toolCall.name}: ${resultMsg}`;
      setMessages(prev => [...prev, { role: "assistant", content, time: getTime() }]);
      saveMessage("assistant", content);
      setIsLoading(false);
      toast.success("Action executed successfully");
    } else {
      const content = "❌ **Action cancelled** by user.";
      setMessages(prev => [...prev, { role: "assistant", content, time: getTime() }]);
      saveMessage("assistant", content);
      toast.info("Action cancelled");
    }
  };

  /** The "@word" being typed at the caret, or null when there is not one. */
  const readMentionQuery = (value: string, caret: number): string | null => {
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1) return null;
    // Only a fresh word counts, so an email address does not open the picker.
    if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
    const term = upto.slice(at + 1);
    if (/\s/.test(term)) return null;
    return term;
  };

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const projects = scopedProjects
      .filter((p) => p.merchantName.toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({ kind: "project" as const, id: p.id, name: p.merchantName, sub: p.mid }));
    const persons = people
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({ kind: "person" as const, id: p.id, name: p.name, sub: "" }));
    return [...projects, ...persons];
  }, [mentionQuery, scopedProjects, people]);

  const applyMention = (m: { kind: "project" | "person"; id: string; name: string }) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const upto = input.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1) return;
    const next = `${input.slice(0, at)}@${m.name} ${input.slice(caret)}`;
    mentionedRef.current.set(m.name, m);
    setInput(next);
    setMentionQuery(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + m.name.length + 2;
      el?.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // The picker owns these keys while it is open, or Enter would send the
    // half-typed name instead of choosing from the list.
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionMatches.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applyMention(mentionMatches[mentionIndex]!); return; }
      if (e.key === "Escape")    { e.preventDefault(); setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleTextareaInput = () => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  };

  if (!currentUser) return null;

  const isPortfolioRole = PORTFOLIO_ROLES.has(currentUser.team);
  const buddyIntroduction = isPortfolioRole
    ? "I’m Buddy. Ask about your portfolio or tell me to take an action on your behalf."
    : `I’m Buddy. Ask about your assigned ${teamLabels[currentUser.team] || "team"} projects, checklists, risks, and next steps.`;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
      {/* Threads. Hidden on narrow screens, where the conversation matters more
          than the ability to switch between them. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-muted/30 md:flex">
        <div className="p-3">
          <Button onClick={startNewChat} size="sm" className="w-full gap-2">
            <Plus className="h-4 w-4" /> New chat
          </Button>
        </div>
        <p className="px-4 pb-1 text-[11px] font-semibold text-muted-foreground">Recent</p>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">No conversations yet.</p>
          ) : (
            conversations.map((c) => (
              // The delete sits beside the row, not inside it: a button cannot
              // contain another button, and the row is already the open action.
              <div
                key={c.id ?? "legacy"}
                className={cn(
                  "group flex items-center gap-1 rounded-md pr-1 transition-colors",
                  c.id === conversationId ? "bg-primary/10" : "hover:bg-muted",
                )}
              >
                <button
                  type="button"
                  onClick={() => openConversation(c.id)}
                  title={c.title}
                  className={cn(
                    "min-w-0 flex-1 truncate px-2.5 py-2 text-left text-xs transition-colors",
                    c.id === conversationId
                      ? "font-medium text-primary"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => { if (confirm(`Delete "${c.title}"? This cannot be undone.`)) void deleteConversation(c.id); }}
                  title="Delete this chat"
                  aria-label={`Delete ${c.title}`}
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                {/* The tab already names this screen; the line below introduces
                    who is answering, so a title here only repeats one of them. */}
                <p className="text-sm text-muted-foreground">{isLoading ? "Thinking…" : buddyIntroduction}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  const next = !autoSpeak;
                  setAutoSpeak(next);
                  if (!next) window.speechSynthesis?.cancel();
                  toast(next ? "Auto-speak on" : "Auto-speak off");
                }}
                title={autoSpeak ? "Mute AI voice" : "Enable AI voice responses"}
              >
                {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 opacity-60" />}
              </Button>
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearHistory} title="Clear chat history">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              backgroundColor: "hsl(var(--background))",
            }}
          >
            {messages.length === 0 && (
              <div className="text-center py-4">
                <div className="space-y-1.5">
                  {ACTION_SUGGESTIONS
                    .filter(s => !s.actionOnly || canUseActions(currentUser?.team))
                    .map((s) => (
                    <button
                      key={s.text}
                      onClick={() => sendMessage(s.message)}
                      className="block w-full text-left text-xs px-3 py-2 rounded-xl border bg-card hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {s.emoji} {s.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed relative shadow-sm",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-card border rounded-bl-md"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1.5 [&>p:last-child]:mb-0 [&>ul]:my-1 [&>ol]:my-1 text-sm">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                  <div className={cn("flex items-center gap-1 mt-1", msg.role === "user" ? "justify-end" : "justify-start")}>
                    <span className="text-[10px] text-muted-foreground">{msg.time}</span>
                    {msg.role === "user" && <CheckCheck className="h-3 w-3 text-blue-500" />}
                  </div>
                </div>
              </div>
            ))}

            {/* Approval buttons */}
            {pendingApproval && (
              <div className="flex justify-start">
                {/* What is being approved sits with the buttons rather than in a
                    separate message, so the two cannot become separated. */}
                <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                    Approve this action?
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground">
                    {pendingApproval.toolCall.name.replace(/_/g, " ")}
                  </p>
                  <dl className="mt-1.5 space-y-0.5">
                    {Object.entries(pendingApproval.toolCall.arguments || {}).map(([k, v]) => (
                      <div key={k} className="flex gap-2 text-[11px]">
                        <dt className="shrink-0 text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                        <dd className="min-w-0 break-words text-foreground/90">
                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" variant="default" className="h-8 text-xs" onClick={() => handleApproval(true)}>
                      Approve &amp; execute
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleApproval(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex justify-start">
                <div className="bg-card border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="relative px-3 py-2.5 border-t bg-card">
            {mentionQuery !== null && mentionMatches.length > 0 && (
              <div className="absolute bottom-full left-3 right-3 z-20 mb-2 max-h-56 overflow-y-auto rounded-lg border bg-popover shadow-lg">
                {mentionMatches.map((m, i) => (
                  <button
                    key={`${m.kind}-${m.id}`}
                    type="button"
                    // onMouseDown, not onClick: blur fires first and would close
                    // the list before a click could land.
                    onMouseDown={(e) => { e.preventDefault(); applyMention(m); }}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs",
                      i === mentionIndex ? "bg-primary/10 text-primary" : "hover:bg-muted",
                    )}
                  >
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                      {m.kind === "project" ? "Project" : "Person"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                    {m.sub && <span className="shrink-0 text-[10px] text-muted-foreground">{m.sub}</span>}
                  </button>
                ))}
              </div>
            )}
            {/* Live transcript indicator */}
            {isListening && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {liveTranscript || "Listening…"}
                </span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setMentionQuery(readMentionQuery(e.target.value, e.target.selectionStart ?? 0));
                  setMentionIndex(0);
                }}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setMentionQuery(null), 120)}
                onInput={handleTextareaInput}
                placeholder="Ask a question or request an action — @ to mention a project or person"
                rows={1}
                disabled={isLoading || isListening}
                className="flex-1 resize-none rounded-2xl border bg-muted/50 px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 max-h-[120px]"
              />
              {/* Mic button */}
              <button
                onClick={isListening ? stopListening : startListening}
                disabled={isLoading}
                title={isListening ? "Stop listening" : "Speak your message"}
                className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                  isListening
                    ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 border"
                )}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              {/* Send button */}
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isLoading}
                className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
      </div>
    </div>
  );
};
