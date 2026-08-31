import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { calculateTimeFromChecklist, formatDuration } from "@/data/projectsData";
import { MessageCircle, X, Send, Loader2, Bot, User, CheckCheck, Trash2, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/hooks/useActivityLogs";

type Msg = { role: "user" | "assistant"; content: string; time: string; toolCalls?: ToolCall[] };
type ToolCall = { id: string; name: string; arguments: any; status?: "pending" | "executing" | "done" | "failed"; result?: string };

const CHAT_URL = `/api/public/ai-chat`;
const ACTIONS_URL = `/api/public/ai-actions`;

const getTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Actions that need approval before executing
// ALL actions require user approval before executing
const APPROVAL_ACTIONS = new Set(["create_workflow", "bulk_update_projects", "assign_owner", "update_project_field", "trigger_brd", "toggle_responsibility", "create_project"]);

// Roles that can use AI action capabilities
const ACTION_ROLES = new Set(["manager", "super_admin"]);
const canUseActions = (team?: string) => ACTION_ROLES.has(team || "");

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

export const AiChatBot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ toolCall: ToolCall; msgIndex: number } | null>(null);
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
    };

    recognition.onend = () => {
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
  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    // Strip markdown for cleaner speech
    const clean = text.replace(/\*\*|__|~~|\[([^\]]+)\]\([^)]+\)|`{1,3}[^`]*`{1,3}|#{1,6}\s/g, "").trim();
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = "en-IN";
    utt.rate = 1.05;
    window.speechSynthesis.speak(utt);
  }, []);

  // Load chat history
  useEffect(() => {
    if (!currentUser || historyLoaded) return;
    const loadHistory = async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) return;
      const { data } = await supabase
        .from("chat_messages")
        .select("role, content, created_at")
        .eq("user_id", session.session.user.id)
        .order("created_at", { ascending: true })
        .limit(50);
      if (data && data.length > 0) {
        setMessages(
          data.map((m: any) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
            time: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }))
        );
      }
      setHistoryLoaded(true);
    };
    loadHistory();
  }, [currentUser, historyLoaded]);

  const saveMessage = async (role: "user" | "assistant", content: string) => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) return;
    await supabase.from("chat_messages").insert({ user_id: session.session.user.id, role, content });
  };

  const clearHistory = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) return;
    await supabase.from("chat_messages").delete().eq("user_id", session.session.user.id);
    setMessages([]);
    setPendingApproval(null);
    toast.success("Chat history cleared");
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);

  const getProjectContext = useCallback(() => {
    if (!projects.length) return "";
    const summary = projects.slice(0, 20).map(p => {
      const time = calculateTimeFromChecklist(p.checklist);
      const completed = p.checklist.filter(c => c.completed).length;
      const total = p.checklist.length;
      return `- ${p.merchantName} (${p.mid}, ID=${p.id}): Phase=${p.currentPhase}, State=${p.projectState}, Team=${teamLabels[p.currentOwnerTeam] || p.currentOwnerTeam}, Owner=${p.assignedOwnerName || "Unassigned"}, OwnerID=${p.assignedOwner || "none"}, Tasks=${completed}/${total}, ${responsibilityLabels.gokwik}Time=${formatDuration(time.gokwik)}, ${responsibilityLabels.merchant}Time=${formatDuration(time.merchant)}, ARR=${p.arr}Cr`;
    }).join("\n");
    return `Total projects: ${projects.length}\n${summary}`;
  }, [projects, teamLabels, responsibilityLabels]);

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
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: allMessages, projectContext: getProjectContext(), enableActions: canUseActions(currentUser?.team) }),
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
            tc.result = resultMsg;
            results.push(`✅ **${tc.name}**: ${resultMsg}`);
          }
        }

        if (results.length > 0) {
          const finalContent = (assistantSoFar ? assistantSoFar + "\n\n" : "") + results.join("\n\n");
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleTextareaInput = () => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  };

  if (!currentUser) return null;

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 left-6 z-50 h-14 w-14 rounded-full bg-[hsl(142,71%,45%)] text-white shadow-xl hover:shadow-2xl transition-all hover:scale-105 flex items-center justify-center"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 left-6 z-50 w-[420px] h-[600px] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300 border border-border">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[hsl(142,71%,35%)] text-white">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-sm">AI Assistant</p>
                <p className="text-[11px] text-white/70">{isLoading ? "typing..." : "online"}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20"
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
                <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={clearHistory} title="Clear chat history">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => setIsOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
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
                <div className="h-14 w-14 mx-auto rounded-full bg-[hsl(142,71%,45%)]/10 flex items-center justify-center mb-3">
                  <Bot className="h-7 w-7 text-[hsl(142,71%,45%)]" />
                </div>
                <p className="text-sm font-semibold mb-1">Hey there! 👋</p>
                <p className="text-xs text-muted-foreground mb-3 max-w-[280px] mx-auto">
                  I can answer questions AND take actions on your projects. Here's what I can do:
                </p>
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
                      ? "bg-[hsl(142,71%,90%)] dark:bg-[hsl(142,50%,25%)] text-foreground rounded-br-md"
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
                <div className="flex gap-2 mt-1">
                  <Button size="sm" variant="default" className="h-8 text-xs" onClick={() => handleApproval(true)}>
                    ✅ Approve & Execute
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleApproval(false)}>
                    ❌ Cancel
                  </Button>
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
          <div className="px-3 py-2.5 border-t bg-card">
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
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onInput={handleTextareaInput}
                placeholder="Ask a question or request an action..."
                rows={1}
                disabled={isLoading || isListening}
                className="flex-1 resize-none rounded-2xl border bg-muted/50 px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(142,71%,45%)]/30 disabled:opacity-50 max-h-[120px]"
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
                className="h-10 w-10 rounded-full bg-[hsl(142,71%,45%)] text-white flex items-center justify-center shrink-0 hover:bg-[hsl(142,71%,40%)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
