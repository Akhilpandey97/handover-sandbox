import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useSearchParams, useParams } from "@/lib/router-compat";
import {
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  FileText,
  HelpCircle,
  Moon,
  Sun,
  Lock,
  Zap,
  Search,
  AlertTriangle,
  Copy,
  Check,
  Upload,
  Image,
  Download,
  X,
  Eye,
  EyeOff,
  ExternalLink,
  BookOpen,
  ListChecks,
  MessageCircle,
  Send,
  Bot,
  ChevronDown,
  KeyRound,
  Code,
  LogOut,
  Trash2,
  Pencil,
  ClipboardList,
  Bell,
  CheckCheck,
  Folder,
  ListTodo,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatArrCr } from "@/lib/arr";
import { GuidedTour, type TourStep } from "@/components/GuidedTour";

const API_URL = `/api/public/merchant-portal-data`;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Portal accents. Primary and accent stay hex: they are Handover navy
// (--color-navy) and some styles append a two-digit alpha to them.
// Status colours come from the theme so they match the app and switch with dark mode.
const BRAND = {
  primary: "#0074F8",
  primaryLight: "#3f7fb0",
  primarySoft: "#e8f1f7",
  accent: "#3f7fb0",
  logoKwik: "#0074F8",
  green: "hsl(var(--success))",
  greenLight: "hsl(var(--success-soft))",
  amber: "hsl(var(--warning))",
  amberLight: "hsl(var(--warning-soft))",
};

interface PortalUpload {
  id: string;
  upload_type: string;
  file_name: string;
  file_url: string;
  uploaded_by: string;
  created_at: string;
}

interface MerchantNote {
  text: string;
  timestamp: string;
}

interface PortalFaq {
  id?: string;
  question: string;
  answer: string;
  updatedAt?: string;
}

const POSTMAN_COLLECTION_URL =
  "https://documenter.getpostman.com/view/53067515/2sBXqQFxdo#3df70d23-774a-4599-945a-21f28ef6b6c4";

interface PortalData {
  project: {
    id: string;
    merchant_name: string;
    mid: string;
    platform: string;
    category: string;
    integration_type: string;
    current_stage: string;
    project_state: string;
    go_live_percent: number;
    current_responsibility: string;
    kick_off_date: string | null;
    expected_go_live_date: string | null;
    go_live_date: string | null;
    brand_url: string | null;
    brd_link: string | null;
    sow_link: string | null;
    jira_link: string | null;
    mint_checklist_link: string | null;
    integration_checklist_link: string | null;
    contact_email: string | null;
    arr: number | null;
    config_id: string | null;
    faq_help: PortalFaq[];
    payment_simulator_link: string | null;
  };
  owner: { name: string; email: string; team: string } | null;
  checklist_progress: { completed: number; total: number; percent: number };
  checklist: {
    title: string;
    completed: boolean;
    completed_at: string | null;
    stage: string;
    owner_team: string;
    due_date: string | null;
    start_date: string | null;
  }[];
  custom_fields: { key: string; label: string; type: string; value: string | null }[];
  recent_activity: {
    description: string;
    category: string;
    created_at: string;
    user_name: string;
  }[];
  branding: Record<string, string>;
  labels?: Record<string, string>;
  credentials: {
    sandbox: {
      mid?: string;
      app_id?: string;
      app_secret?: string;
      base_url?: string;
      config_id?: string;
    };
    production: {
      mid?: string;
      app_id?: string;
      app_secret?: string;
      base_url?: string;
      config_id?: string;
    };
  } | null;
  uploads: PortalUpload[];
  brd_configured?: boolean;
  brd_progress?: { answered: number; total: number; percent: number; status: string | null };
  tasks: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    due_date: string | null;
    checklist_item_id: string;
    assigned_to_ext: string | null;
  }[];
  task_comments: {
    id: string;
    checklist_task_id: string;
    user_name: string;
    user_id: string | null;
    comment: string;
    created_at: string;
  }[];
}

// STAGES are dynamically derived from the checklist items (MINT checklist)
function buildStagesFromChecklist(
  checklist: PortalData["checklist"],
): { num: number; label: string }[] {
  if (!checklist || checklist.length === 0) {
    return [{ num: 1, label: "No Items" }];
  }
  return checklist.map((item, i) => ({
    num: i + 1,
    label: item.title,
  }));
}

function formatArr(arr: number | null): string {
  if (!arr) return "—";
  return formatArrCr(arr);
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return d;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function deriveCurrentStage(data: PortalData): number {
  const checklist = data.checklist;
  if (!checklist || checklist.length === 0) return 1;
  // Current stage = first incomplete item index + 1, or total if all done
  const firstIncomplete = checklist.findIndex((c) => !c.completed);
  if (firstIncomplete === -1) return checklist.length;
  return firstIncomplete + 1;
}

type NavPage =
  "integration" | "credentials" | "documents" | "faq" | "simulator" | "brd";

// ========== COPY BUTTON ==========
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all
        border-border text-muted-foreground hover:text-foreground hover:bg-muted"
    >
      {copied ? <Check className="w-3 h-3 text-success-strong" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ========== KWIKASSIST LOGO ==========
function KwikAssistLogo({
  size = "md",
  onClick,
}: {
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}) {
  const sizes = { sm: "text-sm", md: "text-lg", lg: "text-2xl" };
  return (
    <button onClick={onClick} className={cn("font-bold tracking-tight", sizes[size])}>
      <span style={{ color: BRAND.logoKwik }} className="dark:text-white">
        Handover
      </span>
      <span className="text-2xs text-muted-foreground ml-1 font-medium">Portal</span>
    </button>
  );
}

// ========== AI CHATBOT ==========
function AiChatWidget({
  merchantName,
  token,
  faqs = [],
}: {
  merchantName: string;
  token: string;
  faqs?: PortalFaq[];
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    {
      role: "assistant",
      content: `Hi! I'm Handover Assist 🤖\n\nI can help you with:\n• API integration questions\n• Debugging common errors\n• Validator guidance\n• Setup & configuration\n\nHow can I help you today?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    const newMsgs = [...messages, { role: "user" as const, content: userMsg }];
    setMessages(newMsgs);
    setLoading(true);

    try {
      const res = await fetch(`/api/public/kwikassist-ai-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: API_KEY,
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          messages: newMsgs.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          merchant_name: merchantName,
          token,
          faqs: faqs.filter((f) => f.question.trim() && f.answer.trim()).slice(0, 25),
        }),
      });

      if (!res.ok) {
        throw new Error("Failed");
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "I'm sorry, I couldn't process that. Please try again.",
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I'm having trouble connecting right now. Here are some quick tips:\n\n• Check your API credentials in the Credentials section\n• Use the tools in the Documents section to test your integration\n• Review the FAQ section for common questions\n• Contact your SE for specific issues",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-tour="tour-ai"
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-all hover:scale-110 active:scale-95"
        style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})` }}
        title="Handover Assist Chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[380px] max-w-[calc(100vw-2.5rem)] max-h-[560px] rounded-2xl shadow-2xl border border-border bg-card flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-border"
        style={{ background: BRAND.primary }}
      >
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-white">Handover Assist</p>
          <p className="text-2xs text-white/70">Integration Support</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-white/70 hover:text-white transition-colors"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[380px]">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed",
                msg.role === "user"
                  ? "text-white rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm",
              )}
              style={msg.role === "user" ? { background: BRAND.primary } : {}}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-sm">
              <div className="flex gap-1.5">
                <div
                  className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask about your integration..."
            className="flex-1 px-3.5 py-2.5 rounded-xl text-sm bg-muted/40 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-all disabled:opacity-40"
            style={{ background: BRAND.primary }}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ========== MAIN COMPONENT ==========
export default function MerchantPortal() {
  const [searchParams] = useSearchParams();
  const params = useParams();
  const midFromPath = params.mid || null;
  const tokenFromQuery = searchParams.get("token");
  const isMagicLink = searchParams.get("ml") === "1";
  const [resolvedToken, setResolvedToken] = useState<string | null>(tokenFromQuery);
  const [resolvingMid, setResolvingMid] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [magicAuthLoading, setMagicAuthLoading] = useState(false);
  const token = resolvedToken;

  // Resolve /portal/:mid -> portal token via edge function (for direct CE access).
  // Re-runs whenever the :mid in the URL changes, so switching MIDs swaps merchants.
  useEffect(() => {
    if (tokenFromQuery) {
      setResolvedToken(tokenFromQuery);
      return;
    }
    if (!midFromPath) return;
    // Shared portal links use a 64-char hex token in the path; treat those as tokens.
    if (/^[a-f0-9]{64}$/i.test(midFromPath)) {
      setResolvedToken(midFromPath);
      setResolvingMid(false);
      setResolveError(null);
      return;
    }
    setResolvedToken(null); // force data refetch for the new merchant
    setResolvingMid(true);
    setResolveError(null);
    fetch(`${API_URL}/resolve-mid?mid=${encodeURIComponent(midFromPath)}`, {
      headers: { apikey: API_KEY, "Content-Type": "application/json" },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.token) {
          setResolvedToken(d.token);
          try {
            localStorage.setItem(`portal_mid_${d.token}`, midFromPath);
          } catch {}
        } else {
          setResolveError(d.error || "Unable to open portal for that MID");
        }
      })
      .catch(() => setResolveError("Unable to open portal for that MID"))
      .finally(() => setResolvingMid(false));
  }, [midFromPath, tokenFromQuery]);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [midInput, setMidInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [merchantEmail, setMerchantEmail] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [merchantNamePreview, setMerchantNamePreview] = useState<string | null>(null);

  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activePage, setActivePage] = useState<NavPage>("integration");
  const [darkMode, setDarkMode] = useState(false);

  // Notes with timestamps
  const [noteText, setNoteText] = useState("");
  const [savedNotes, setSavedNotes] = useState<MerchantNote[]>([]);

  // Task completion state (task id → status string, synced to DB via PATCH)
  const [taskStatuses, setTaskStatuses] = useState<Record<string, string>>({});
  // Task comments per task id (augmented optimistically)
  const [taskComments, setTaskComments] = useState<PortalData["task_comments"]>([]);

  // Shell state — mirrors the signed-in dashboard shell
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [darkMode]);

  useEffect(() => {
    if (token) {
      const stored =
        localStorage.getItem(`portal_auth_${token}`) ||
        sessionStorage.getItem(`portal_auth_${token}`);
      let lastCredentials: { appId?: string; email?: string } = {};
      try {
        lastCredentials = JSON.parse(localStorage.getItem("portal_last_credentials") || "{}");
      } catch {}
      const storedEmail =
        localStorage.getItem(`portal_email_${token}`) ||
        sessionStorage.getItem(`portal_email_${token}`) ||
        lastCredentials.email;
      const storedMid =
        localStorage.getItem(`portal_mid_${token}`) ||
        localStorage.getItem(`portal_app_id_${token}`) ||
        lastCredentials.appId;
      if (stored) setIsAuthenticated(true);
      if (storedEmail) {
        setMerchantEmail(storedEmail);
        setEmailInput(storedEmail);
      }
      if (storedMid) setMidInput(storedMid);
      // Load saved notes
      const notesKey = `portal_notes_${token}`;
      const storedNotes = localStorage.getItem(notesKey);
      if (storedNotes) {
        try {
          setSavedNotes(JSON.parse(storedNotes));
        } catch {}
      }
      // Task status is now server-driven; nothing to load from localStorage
    }
  }, [token]);

  // Magic-link auto-authentication: if URL has ?ml=1&token=..., skip MID gate
  useEffect(() => {
    if (!token || !isMagicLink || isAuthenticated) return;
    setMagicAuthLoading(true);
    fetch(`${API_URL}/magic-auth`, {
      method: "POST",
      headers: { apikey: API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          localStorage.setItem(`portal_auth_${token}`, d.session_token || "1");
          localStorage.setItem(`portal_email_${token}`, d.email);
          if (d.mid) localStorage.setItem(`portal_mid_${token}`, d.mid);
          setMerchantEmail(d.email);
          setMerchantNamePreview(d.merchant_name);
          setIsAuthenticated(true);
        } else {
          setLoginError(d.error || "Magic link is invalid or expired");
        }
      })
      .catch(() => setLoginError("Unable to authenticate via magic link"))
      .finally(() => setMagicAuthLoading(false));
  }, [token, isMagicLink, isAuthenticated]);

  // First-visit guided tour
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    if (!token || !isAuthenticated) return;
    const seen = localStorage.getItem(`portal_tour_seen_${token}`);
    if (!seen) {
      // small delay so layout settles
      const t = setTimeout(() => setShowTour(true), 350);
      return () => clearTimeout(t);
    }
  }, [token, isAuthenticated]);
  const dismissTour = () => {
    if (token) localStorage.setItem(`portal_tour_seen_${token}`, "1");
    setShowTour(false);
  };

  const tourSteps: TourStep[] = useMemo(() => {
    const proj = data?.project;
    const steps: TourStep[] = [
      {
        title: `Welcome to Handover Assist${proj ? `, ${proj.merchant_name}` : ""}`,
        body: "Your one-stop workspace to go live faster. This quick tour shows what each section does — takes under a minute.",
      },
      {
        target: '[data-tour="tour-integration"]',
        title: "My Integration",
        body: "Your live integration status: current stage, owner, milestones, and next steps — always in sync with your Handover team.",
        placement: "right",
      },
      {
        target: '[data-tour="tour-credentials"]',
        title: "Credentials",
        body: "Your sandbox & production API keys. Hidden by default — reveal or copy with one click when you need them.",
        placement: "right",
      },
      {
        target: '[data-tour="tour-documents"]',
        title: "Documents",
        body: "BRD, SOW, mandatory APIs, KwikPass & MCP integration guides — all linked from one place.",
        placement: "right",
      },
      {
        target: '[data-tour="tour-faq"]',
        title: "FAQ & Help",
        body: "Common questions answered. Check here first before reaching out — most blockers have a known fix.",
        placement: "right",
      },
    ];
    if (proj?.payment_simulator_link) {
      steps.push({
        target: '[data-tour="tour-simulator"]',
        title: "Payment Simulator",
        body: "Trigger test payments to verify your checkout flow before going live.",
        placement: "right",
      });
    }
    steps.push({
      target: '[data-tour="tour-ai"]',
      title: "Handover Assist",
      body: "Stuck? Ask the AI anything about your integration — it's trained on your project's context and the FAQs.",
      placement: "top",
    });
    steps.push({
      title: "You're all set!",
      body: "You can re-open this tour any time by clearing your browser data. Happy integrating!",
    });
    return steps;
  }, [data?.project]);

  // Track page visits
  useEffect(() => {
    if (!isAuthenticated || !token || !merchantEmail) return;
    fetch(`${API_URL}/track`, {
      method: "POST",
      headers: { apikey: API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ token, email: merchantEmail, page: activePage }),
    }).catch(() => {});
  }, [activePage, isAuthenticated, token, merchantEmail]);

  const saveNote = () => {
    if (!noteText.trim() || !token) return;
    const text = noteText.trim();
    const newNote: MerchantNote = { text, timestamp: new Date().toISOString() };
    const updated = [newNote, ...savedNotes];
    setSavedNotes(updated);
    localStorage.setItem(`portal_notes_${token}`, JSON.stringify(updated));
    setNoteText("");
    // Log to project activity history and notify the internal team
    fetch(`${API_URL}/note`, {
      method: "POST",
      headers: { apikey: API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ token, email: merchantEmail, note: text }),
    }).catch(() => {});
  };

  const editNote = (idx: number, newText: string) => {
    if (!token) return;
    const updated = savedNotes.map((n, i) =>
      i === idx ? { ...n, text: newText, timestamp: new Date().toISOString() } : n,
    );
    setSavedNotes(updated);
    localStorage.setItem(`portal_notes_${token}`, JSON.stringify(updated));
  };

  const deleteNote = (idx: number) => {
    if (!token) return;
    const updated = savedNotes.filter((_, i) => i !== idx);
    setSavedNotes(updated);
    localStorage.setItem(`portal_notes_${token}`, JSON.stringify(updated));
  };

  const handleLogout = () => {
    if (!token) return;
    sessionStorage.removeItem(`portal_auth_${token}`);
    sessionStorage.removeItem(`portal_email_${token}`);
    localStorage.removeItem(`portal_auth_${token}`);
    setIsAuthenticated(false);
    setMerchantEmail(null);
    let lastCredentials: { appId?: string; email?: string } = {};
    try {
      lastCredentials = JSON.parse(localStorage.getItem("portal_last_credentials") || "{}");
    } catch {}
    const storedEmail = localStorage.getItem(`portal_email_${token}`) || lastCredentials.email;
    const storedMid =
      localStorage.getItem(`portal_mid_${token}`) ||
      localStorage.getItem(`portal_app_id_${token}`) ||
      lastCredentials.appId;
    setMidInput(storedMid || "");
    setEmailInput(storedEmail || "");
  };

  const toggleTask = async (taskId: string) => {
    if (!token) return;
    const current = taskStatuses[taskId] ?? "todo";
    const action = current === "done" ? "uncomplete" : "complete";
    // Optimistic update
    setTaskStatuses((prev) => ({ ...prev, [taskId]: action === "complete" ? "done" : "todo" }));
    const customerName =
      (typeof window !== "undefined" && localStorage.getItem(`portal_email_${token}`)) ||
      "Customer";
    try {
      const res = await fetch(API_URL, {
        method: "PATCH",
        headers: { apikey: API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ token, task_id: taskId, action, customer_name: customerName }),
      });
      const json = await res.json();
      if (json.error) {
        // Revert on failure
        setTaskStatuses((prev) => ({ ...prev, [taskId]: current }));
      } else {
        // Add the auto-comment to local state
        if (json.comment) {
          setTaskComments((prev) => [...prev, json.comment]);
        }
        // Refresh to get the auto-comment that was added server-side
        refreshData();
      }
    } catch {
      setTaskStatuses((prev) => ({ ...prev, [taskId]: current }));
    }
  };

  const submitTaskComment = async (taskId: string, comment: string) => {
    if (!token || !comment.trim()) return;
    const customerName =
      (typeof window !== "undefined" && localStorage.getItem(`portal_email_${token}`)) ||
      "Customer";
    const res = await fetch(API_URL, {
      method: "PATCH",
      headers: { apikey: API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        task_id: taskId,
        action: "comment",
        comment,
        customer_name: customerName,
      }),
    });
    const json = await res.json();
    if (!json.error && json.comment) {
      setTaskComments((prev) => [...prev, json.comment]);
    }
    return json;
  };

  const handleMidLogin = async () => {
    if (!token) return;
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setLoginError("Please enter a valid work email address");
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`${API_URL}/verify`, {
        method: "POST",
        headers: { apikey: API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ token, mid: midInput.trim(), email: cleanEmail }),
      });
      const result = await res.json();
      if (result.success) {
        localStorage.setItem(`portal_auth_${token}`, result.session_token || "1");
        localStorage.setItem(`portal_email_${token}`, cleanEmail);
        localStorage.setItem(`portal_mid_${token}`, midInput.trim());
        localStorage.setItem(`portal_app_id_${token}`, midInput.trim());
        localStorage.setItem(
          "portal_last_credentials",
          JSON.stringify({ appId: midInput.trim(), email: cleanEmail }),
        );
        setMerchantEmail(cleanEmail);
        setMerchantNamePreview(result.merchant_name);
        setIsAuthenticated(true);
      } else {
        setLoginError(result.error || "Authentication failed");
      }
    } catch {
      setLoginError("Unable to verify. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  const refreshData = useCallback(() => {
    if (!token || !isAuthenticated) return;
    setLoading(true);
    fetch(`${API_URL}?token=${encodeURIComponent(token)}`, {
      headers: { apikey: API_KEY, "Content-Type": "application/json" },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setData({ tasks: [], task_comments: [], ...d });
          const statuses: Record<string, string> = {};
          (d.tasks || []).forEach((t: any) => { statuses[t.id] = t.status; });
          setTaskStatuses(statuses);
          setTaskComments(d.task_comments || []);
        }
      })
      .catch(() => setError("Failed to load data."))
      .finally(() => setLoading(false));
  }, [token, isAuthenticated]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Poll every 60s and show a toast when new tasks arrive
  const prevTaskIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!token || !isAuthenticated) return;
    const poll = setInterval(() => {
      fetch(`${API_URL}?token=${encodeURIComponent(token)}`, {
        headers: { apikey: API_KEY, "Content-Type": "application/json" },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) return;
          const freshTasks: { id: string; title: string }[] = d.tasks || [];
          if (prevTaskIdsRef.current === null) {
            prevTaskIdsRef.current = new Set(freshTasks.map((t) => t.id));
            return;
          }
          const newTasks = freshTasks.filter((t) => !prevTaskIdsRef.current!.has(t.id));
          if (newTasks.length > 0) {
            prevTaskIdsRef.current = new Set(freshTasks.map((t) => t.id));
            setData({ tasks: [], task_comments: [], ...d });
            const statuses: Record<string, string> = {};
            (d.tasks || []).forEach((t: any) => { statuses[t.id] = t.status; });
            setTaskStatuses(statuses);
            setTaskComments(d.task_comments || []);
            toast.custom(
              (id) => (
                <div
                  className="pointer-events-auto flex w-full max-w-md gap-4 rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10"
                  style={{ minWidth: 340 }}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Bell className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">New task assigned to you</p>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {newTasks.map((t) => t.title).join(", ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toast.dismiss(id)}
                    className="shrink-0 text-muted-foreground/60 hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ),
              { duration: 8000, position: "top-center" },
            );
          }
        })
        .catch(() => {});
    }, 60_000);
    // Seed the ref after first data load
    if (data && prevTaskIdsRef.current === null) {
      prevTaskIdsRef.current = new Set((data.tasks || []).map((t) => t.id));
    }
    return () => clearInterval(poll);
  }, [token, isAuthenticated, data]);

  const currentStage = useMemo(() => (data ? deriveCurrentStage(data) : 1), [data]);
  const orgName = data?.branding?.org_name || "Handover";
  const orgLogoUrl = data?.branding?.org_logo_url || data?.branding?.logo_url || "";

  // ===== NO TOKEN =====
  if (!token) {
    if (resolvingMid) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">Opening portal for {midFromPath}…</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center bg-destructive-soft">
            <ShieldAlert className="w-8 h-8 text-destructive-strong" />
          </div>
          <h1 className="heading-section text-foreground mb-2">Access Denied</h1>
          <p className="text-muted-foreground text-sm">
            {resolveError ||
              "No access token provided. Please use the link shared by your integration team."}
          </p>
        </div>
      </div>
    );
  }

  // ===== MAGIC LINK AUTH LOADING =====
  if (isMagicLink && !isAuthenticated && magicAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Signing you in via secure link…</p>
        </div>
      </div>
    );
  }

  // ===== MID LOGIN GATE =====
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-background via-muted/40 to-background">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, #0074F8 1px, transparent 0)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="w-full max-w-md relative z-10">
          <div className="bg-card rounded-2xl shadow-xl shadow-[var(--shadow-soft)] p-8 border border-border">
            <div className="text-center mb-8">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-md"
                style={{ background: BRAND.primary }}
              >
                <Zap className="w-7 h-7 text-white" fill="white" />
              </div>
              <h1 className="heading-page">
                <span style={{ color: BRAND.logoKwik }} className="dark:text-white">
                  Handover
                </span>
                <span className="text-xs font-medium text-muted-foreground ml-1">Portal</span>
              </h1>
              <p className="text-muted-foreground text-sm mt-2 font-medium">
                Your Complete Merchant Integration Workspace
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Work Email
                </label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setLoginError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleMidLogin();
                  }}
                  placeholder="you@company.com"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all text-sm"
                />
                <p className="text-2xs text-muted-foreground mt-1.5">
                  We use this to track your integration progress.
                </p>
              </div>

              {loginError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive-soft border border-destructive/30">
                  <AlertTriangle className="w-4 h-4 text-destructive-strong mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-destructive-strong">{loginError}</p>
                </div>
              )}

              <button
                onClick={handleMidLogin}
                disabled={loginLoading || !emailInput.trim()}
                className="w-full py-3 px-4 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] shadow-lg hover:shadow-xl"
                style={{
                  background: BRAND.primary,
                  boxShadow: `0 8px 24px -4px ${BRAND.primary}40`,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = BRAND.primaryLight)}
                onMouseLeave={(e) => (e.currentTarget.style.background = BRAND.primary)}
              >
                {loginLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </span>
                ) : (
                  "Login to Portal"
                )}
              </button>
            </div>

            <div className="mt-6 pt-5 border-t border-border">
              <p className="text-center text-2xs text-muted-foreground">
                Use the work email shared with your Handover integration team.
                <br />
                Contact your project manager if you need assistance.
              </p>
            </div>
          </div>
          <p className="text-center text-2xs text-muted-foreground mt-4">Powered by Handover</p>
        </div>
      </div>
    );
  }

  // ===== LOADING DATA =====
  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div
            className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: BRAND.primary }}
          >
            <Loader2 className="w-6 h-6 animate-spin text-white" />
          </div>
          <p className="text-muted-foreground text-sm">Loading your integration workspace...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-md">
          <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-destructive-strong" />
          <h1 className="heading-section text-foreground mb-2">Access Denied</h1>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const { project, owner, checklist_progress } = data;

  // Only customer-assigned tasks count as "pending actions" for the customer
  const pendingItems = (data.tasks || []).filter((t) => t.status !== "done");

  const navItems: { key: NavPage; label: string; icon: any; tour: string }[] = [
    {
      key: "integration",
      label: "My Integration",
      icon: LayoutDashboard,
      tour: "tour-integration",
    },
    { key: "credentials", label: "Credentials", icon: Lock, tour: "tour-credentials" },
    { key: "documents", label: "Documents", icon: FileText, tour: "tour-documents" },
    // Offered only when this tenant has a BRD form. It used to be listed
    // unconditionally, so merchants saw a form nobody had set up for them.
    ...(data.brd_configured
      ? [
          {
            key: "brd" as NavPage,
            label: `BRD Form${data.brd_progress && data.brd_progress.total ? ` · ${data.brd_progress.percent}%` : ""}`,
            icon: ClipboardList,
            tour: "tour-brd",
          },
        ]
      : []),
    { key: "faq", label: "FAQ & Help", icon: HelpCircle, tour: "tour-faq" },
    ...(project.payment_simulator_link
      ? [
          {
            key: "simulator" as NavPage,
            label: "Payment Simulator",
            icon: Zap,
            tour: "tour-simulator",
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(var(--surface-2))] text-foreground">
      {/* SIDEBAR — matches the signed-in dashboard shell */}
      <aside
        className={cn(
          "relative flex shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-all duration-300",
          sidebarCollapsed ? "w-16" : "w-[212px]",
        )}
      >
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            {orgLogoUrl ? (
              <img
                src={orgLogoUrl}
                alt={`${orgName} logo`}
                className={cn(
                  "shrink-0 rounded-xl bg-sidebar-accent object-contain shadow-[var(--shadow-soft)]",
                  sidebarCollapsed ? "h-8 w-8" : "h-11 w-11",
                )}
              />
            ) : (
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-xl gradient-primary shadow-[var(--shadow-soft)]",
                  sidebarCollapsed ? "h-8 w-8" : "h-11 w-11",
                )}
              >
                <Zap
                  className={cn(
                    "text-primary-foreground",
                    sidebarCollapsed ? "h-4 w-4" : "h-5 w-5",
                  )}
                  fill="currentColor"
                />
              </span>
            )}
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1" />
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    onClick={() => setSearchOpen((open) => !open)}
                    title="Search checklist"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                  <Popover open={notifOpen} onOpenChange={setNotifOpen}>
                    <PopoverTrigger asChild>
                      <button
                        title="Pending actions"
                        className="relative flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      >
                        <Bell className="h-4 w-4" />
                        {pendingItems.length > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-2xs font-bold text-destructive-foreground">
                            {pendingItems.length > 9 ? "9+" : pendingItems.length}
                          </span>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" align="start" sideOffset={12} collisionPadding={12} className="w-[440px] p-0">
                      <div className="flex items-center justify-between border-b border-border px-5 py-4">
                        <div>
                          <p className="text-base font-semibold">Your Action Items</p>
                          <p className="text-xs text-muted-foreground">{pendingItems.length} pending</p>
                        </div>
                        {pendingItems.length > 0 && (
                          <button
                            onClick={() => { pendingItems.forEach((t) => toggleTask(t.id)); setNotifOpen(false); }}
                            className="flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            Mark all done
                          </button>
                        )}
                      </div>
                      <ScrollArea className="max-h-[520px] overflow-y-auto">
                        {pendingItems.length === 0 ? (
                          <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                            You're all caught up.
                          </p>
                        ) : (
                          <div className="divide-y divide-border/60">
                            <div className="py-3">
                              <div className="flex items-center gap-2 px-5 pb-2 pt-1">
                                <Folder className="h-4 w-4 text-primary" />
                                <p className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-bold tracking-normal text-primary">
                                  {data.project.merchant_name}
                                </p>
                              </div>
                              <div className="px-3">
                                {pendingItems.map((task) => {
                                  const overdue = task.due_date && task.status !== "done" ? new Date(task.due_date) < new Date() : false;
                                  return (
                                    <button
                                      key={task.id}
                                      type="button"
                                      onClick={() => { setActivePage("integration"); setNotifOpen(false); }}
                                      className="flex w-full gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 bg-primary/5"
                                    >
                                      <span className="mt-0.5 shrink-0 text-primary"><ListTodo className="h-3.5 w-3.5" /></span>
                                      <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                          <span className="truncate text-sm font-semibold text-foreground">{task.title}</span>
                                          <Badge className="h-4 px-1.5 text-2xs">Pending</Badge>
                                        </span>
                                        {task.description && (
                                          <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">{task.description}</span>
                                        )}
                                        {task.due_date && (
                                          <span className={cn("mt-0.5 block text-2xs", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
                                            Due {formatDate(task.due_date)}{overdue ? " · overdue" : ""}
                                          </span>
                                        )}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    title="Collapse sidebar"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
          {sidebarCollapsed && (
            <div className="mt-3 flex flex-col items-center gap-1">
              <button
                onClick={() => {
                  setSidebarCollapsed(false);
                  setSearchOpen(true);
                }}
                title="Search checklist"
                className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                onClick={() => { setSidebarCollapsed(false); setNotifOpen(true); }}
                title="Pending actions"
                className="relative flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              >
                <Bell className="h-4 w-4" />
                {pendingItems.length > 0 && (
                  <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-destructive" />
                )}
              </button>
              <button
                onClick={() => setSidebarCollapsed(false)}
                title="Expand sidebar"
                className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {!sidebarCollapsed && searchOpen && (
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/50" />
              <input
                autoFocus
                placeholder="Search checklist..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-full rounded-md border border-sidebar-border bg-sidebar-accent/40 pl-8 pr-7 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/60 hover:text-sidebar-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2 pb-2 pt-8">
          <div className="space-y-0.5">
            {navItems.map((item) => (
              <SidebarItem
                key={item.key}
                icon={item.icon}
                label={item.label}
                collapsed={sidebarCollapsed}
                active={activePage === item.key}
                onClick={() => setActivePage(item.key)}
                dataTour={item.tour}
              />
            ))}
          </div>
        </nav>

        <div className="p-2">
          <div
            className={cn(
              "flex items-center gap-1 rounded-lg p-1",
              sidebarCollapsed && "flex-col gap-1.5",
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-sm">
              {project.merchant_name?.charAt(0).toUpperCase()}
            </span>
            {!sidebarCollapsed && (
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-xs font-medium leading-tight text-sidebar-foreground">
                  {project.merchant_name}
                </span>
                <span className="block truncate text-2xs leading-tight text-sidebar-foreground/60">
                  Customer portal
                </span>
              </span>
            )}
            <button
              onClick={() => setDarkMode(!darkMode)}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto app-shell-surface">
          {activePage === "integration" && (
            <IntegrationPage
              data={data}
              project={project}
              owner={owner}
              checklist_progress={checklist_progress}
              currentStage={currentStage}
              noteText={noteText}
              setNoteText={setNoteText}
              orgName={orgName}
              savedNotes={savedNotes}
              onSaveNote={saveNote}
              onEditNote={editNote}
              onDeleteNote={deleteNote}
              taskStatuses={taskStatuses}
              taskComments={taskComments}
              onToggleTask={toggleTask}
              onSubmitTaskComment={submitTaskComment}
              brdProgress={data.brd_progress}
              searchQuery={searchQuery}
              onOpenBrd={() => setActivePage("brd")}
            />
          )}
          {activePage === "credentials" && (
            <CredentialsPage project={project} credentials={data.credentials} />
          )}
          {activePage === "documents" && (
            <DocumentsPage data={data} setActivePage={setActivePage} token={token!} onUploaded={refreshData} />
          )}
          {activePage === "brd" && <BrdPage token={token!} onProgress={refreshData} />}

          {activePage === "faq" && <FAQPage faqs={project.faq_help} />}
          {activePage === "simulator" && project.payment_simulator_link && (
            <PaymentSimulatorPage link={project.payment_simulator_link} />
          )}
        </div>
      </main>

      {/* First-visit Guided Tour */}
      <GuidedTour
        steps={tourSteps}
        open={showTour}
        onClose={dismissTour}
        merchantName={project.merchant_name}
        brandColor={BRAND.primary}
      />

      {/* AI Chatbot */}
      <AiChatWidget merchantName={project.merchant_name} token={token!} faqs={project.faq_help} />
    </div>
  );
}

/* ===================== SIDEBAR ITEM ===================== */
function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
  dataTour,
  collapsed,
}: {
  icon: any;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
  dataTour?: string;
  collapsed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      data-tour={dataTour}
      title={label}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all duration-200",
        collapsed && "justify-center px-0",
        active
          ? "gradient-primary text-primary-foreground shadow-[var(--shadow-soft)]"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60",
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
          active
            ? "bg-primary-foreground/20 text-primary-foreground"
            : "bg-sidebar-accent text-sidebar-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      {!collapsed && <span className="flex-1 text-sm font-medium">{label}</span>}
      {!collapsed && badge !== undefined && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-foreground/20 text-2xs font-bold">
          {badge}
        </span>
      )}
    </button>
  );
}

/* ===================== CARD WRAPPER ===================== */
function Card({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("bg-card border border-border rounded-xl shadow-sm", className)}
      style={style}
    >
      {children}
    </div>
  );
}

/* ===================== INTEGRATION PAGE ===================== */
function BrdPage({ token, onProgress }: { token: string; onProgress?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brdToken, setBrdToken] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [info, setInfo] = useState<{
    percent: number;
    answered: number;
    total: number;
    status: string | null;
  } | null>(null);

  const fetchSession = useCallback(
    async (withLoading: boolean) => {
      if (withLoading) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/brd-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: API_KEY },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (res.status === 404 && data.error === "not_configured") {
          setNotConfigured(true);
          return;
        }
        if (!res.ok) throw new Error(data.error || "Failed to load BRD");
        // Only set brd_token on the very first load; never replace it on poll —
        // changing the iframe src would reload the form and wipe the in-progress answer.
        setBrdToken((prev) => prev ?? data.brd_token);
        setInfo({
          percent: data.percent,
          answered: data.answered,
          total: data.total,
          status: data.status,
        });
      } catch (e) {
        if (withLoading) setError(e instanceof Error ? e.message : "Failed to load BRD");
      } finally {
        if (withLoading) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchSession(true);
  }, [fetchSession]);

  // Lightweight progress poll: never touches brdToken or loading, so the iframe stays mounted.
  useEffect(() => {
    if (!brdToken) return;
    const id = window.setInterval(() => {
      fetchSession(false);
      onProgress?.();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [brdToken, fetchSession, onProgress]);

  if (notConfigured) {
    return (
      <div className="p-10 text-center">
        <ClipboardList className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-semibold text-foreground">No BRD form yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your onboarding team has not set one up. There is nothing for you to fill in here.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-10 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: BRAND.primary }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-10 max-w-xl mx-auto">
        <div className="border border-destructive/30 bg-destructive-soft rounded-xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive-strong mx-auto mb-2" />
          <p className="text-sm font-medium text-destructive-strong">{error}</p>
          <button
            onClick={() => fetchSession(true)}
            className="mt-3 text-xs font-bold text-white px-4 py-1.5 rounded"
            style={{ background: BRAND.primary }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const brdUrl = brdToken ? `/brd?token=${brdToken}` : "";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-4 bg-card">
        <div className="flex items-center gap-3 min-w-0">
          <ClipboardList className="w-5 h-5 flex-shrink-0" style={{ color: BRAND.primary }} />
          <div className="min-w-0">
            <h1 className="text-base font-bold text-foreground truncate">BRD Form</h1>
            <p className="text-2xs text-muted-foreground">
              {info?.answered ?? 0}/{info?.total ?? 0} answered · {info?.percent ?? 0}% complete
              {info?.status === "completed" && " · Submitted"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${info?.percent ?? 0}%`,
                background: (info?.percent ?? 0) === 100 ? BRAND.green : BRAND.accent,
              }}
            />
          </div>
          <a
            href={brdUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-muted/50"
          >
            <ExternalLink className="w-3 h-3" /> Open in new tab
          </a>
        </div>
      </div>
      <div className="flex-1 bg-card">
        {brdUrl && (
          <iframe
            src={brdUrl}
            title="BRD Form"
            className="w-full h-full border-0"
            style={{ minHeight: "calc(100vh - 180px)" }}
          />
        )}
      </div>
    </div>
  );
}

function TaskActionItem({
  task,
  status,
  comments,
  onToggle,
  onComment,
}: {
  task: PortalData["tasks"][0];
  status: string;
  comments: PortalData["task_comments"];
  onToggle: () => void;
  onComment: (text: string) => Promise<any>;
}) {
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const isDone = status === "done";
  const overdue = !isDone && task.due_date ? new Date(task.due_date) < new Date() : false;

  const handleSubmit = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    await onComment(commentText.trim());
    setCommentText("");
    setSubmitting(false);
    setShowComment(false);
  };

  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="flex-shrink-0 mt-0.5 transition-opacity hover:opacity-70 focus:outline-none"
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
        >
          <CheckCircle2
            className="w-4 h-4"
            style={{ color: isDone ? BRAND.green : "#cbd5e1" }}
          />
        </button>
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-medium", isDone && "text-muted-foreground line-through")}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
          )}
          {/* Existing comments */}
          {comments.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {comments.map((c) => {
                const isCustomer = !c.user_id;
                return (
                  <div key={c.id} className={cn("flex gap-2 text-xs rounded-lg px-2.5 py-1.5", isCustomer ? "bg-primary/[0.06]" : "bg-muted/50")}>
                    <span className={cn("font-semibold shrink-0", isCustomer ? "text-primary" : "text-foreground")}>
                      {isCustomer ? `${c.user_name} (you)` : c.user_name}:
                    </span>
                    <span className="text-muted-foreground leading-relaxed">{c.comment}</span>
                  </div>
                );
              })}
            </div>
          )}
          {/* Comment input */}
          {showComment ? (
            <div className="mt-2 flex gap-2 items-center">
              <input
                type="text"
                className="flex-1 text-xs border border-border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Add a comment…"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit()}
                autoFocus
              />
              <button
                onClick={handleSubmit}
                disabled={submitting || !commentText.trim()}
                className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
              >
                {submitting ? "…" : "Send"}
              </button>
              <button
                onClick={() => setShowComment(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowComment(true)}
              className="mt-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              + Add comment
            </button>
          )}
        </div>
        {task.due_date && (
          <span className={cn("text-xs whitespace-nowrap font-semibold flex-shrink-0", overdue ? "text-destructive-strong" : "text-muted-foreground")}>
            Due {formatDate(task.due_date)}
          </span>
        )}
      </div>
    </div>
  );
}

function IntegrationPage({
  data,
  project,
  owner,
  checklist_progress,
  currentStage,
  noteText,
  setNoteText,
  orgName,
  savedNotes,
  onSaveNote,
  onEditNote,
  onDeleteNote,
  taskStatuses,
  taskComments,
  onToggleTask,
  onSubmitTaskComment,
  brdProgress,
  onOpenBrd,
  searchQuery = "",
}: {
  searchQuery?: string;
  data: PortalData;
  project: PortalData["project"];
  owner: PortalData["owner"];
  checklist_progress: PortalData["checklist_progress"];
  currentStage: number;
  noteText: string;
  setNoteText: (v: string) => void;
  orgName: string;
  savedNotes: MerchantNote[];
  onSaveNote: () => void;
  onEditNote: (idx: number, text: string) => void;
  onDeleteNote: (idx: number) => void;
  taskStatuses: Record<string, string>;
  taskComments: PortalData["task_comments"];
  onToggleTask: (taskId: string) => void;
  onSubmitTaskComment: (taskId: string, comment: string) => Promise<any>;
  brdProgress?: PortalData["brd_progress"];
  onOpenBrd?: () => void;
}) {
  const stages = useMemo(() => buildStagesFromChecklist(data.checklist), [data.checklist]);
  const totalStages = stages.length;
  // Field names configured in Settings win over the built-in wording.
  const portalLabel = (key: string, fallback: string) => data.labels?.[key] || fallback;

  return (
    <div className="px-8 py-7 max-w-6xl mx-auto space-y-6">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="heading-page text-foreground">{project.merchant_name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {project.brand_url || "—"} · {project.platform} ·{" "}
              {project.integration_type || "Standard"}
            </p>
          </div>
        </div>
        {(owner || project.expected_go_live_date || project.go_live_date) && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            {owner && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-foreground">
                <span className="text-muted-foreground">POC</span>
                {owner.name}
              </span>
            )}
            {(project.expected_go_live_date || project.go_live_date) && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-foreground">
                <span className="text-muted-foreground">Go-Live</span>
                {formatDate(project.expected_go_live_date || project.go_live_date)}
              </span>
            )}
          </div>
        )}
        {brdProgress && brdProgress.total > 0 && brdProgress.status !== "completed" && (
          <button
            onClick={onOpenBrd}
            className="mt-4 w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl border-2 transition-all hover:shadow-md"
            style={{
              background:
                brdProgress.percent === 100 ? `${BRAND.greenLight}` : `${BRAND.amberLight}`,
              borderColor: brdProgress.percent === 100 ? BRAND.green : BRAND.amber,
            }}
          >
            <div className="flex items-center gap-3 text-left">
              <ClipboardList
                className="w-5 h-5 flex-shrink-0"
                style={{ color: brdProgress.percent === 100 ? BRAND.green : BRAND.amber }}
              />
              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: brdProgress.percent === 100 ? BRAND.green : BRAND.amber }}
                >
                  BRD Form · {brdProgress.percent}% complete
                </p>
                <p className="text-2xs text-muted-foreground">
                  {brdProgress.answered}/{brdProgress.total} answered{" "}
                  {brdProgress.status === "completed" ? "· Submitted" : "· Click to continue"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-32 h-2 bg-white/60 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${brdProgress.percent}%`,
                    background: brdProgress.percent === 100 ? BRAND.green : BRAND.amber,
                  }}
                />
              </div>
              <ChevronRight
                className="w-4 h-4"
                style={{ color: brdProgress.percent === 100 ? BRAND.green : BRAND.amber }}
              />
            </div>
          </button>
        )}
      </div>

      {/* Integration Roadmap */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="heading-section text-foreground">Integration Roadmap</h2>
            <p className="text-sm text-muted-foreground">
              Stage {currentStage} of {totalStages} — {stages[currentStage - 1]?.label}
            </p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-bold" style={{ color: BRAND.accent }}>
              {checklist_progress.percent}%
            </span>
            <p className="text-xs text-muted-foreground">Complete</p>
          </div>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden mb-6 mt-3">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${checklist_progress.percent}%`,
              background: `linear-gradient(90deg, ${BRAND.accent}, ${BRAND.primary})`,
            }}
          />
        </div>
        <div className="flex items-start gap-0 overflow-x-auto px-2 pb-2">
          {stages.map((stage, i) => {
            const isDone = data.checklist[i]?.completed;
            const isCurrent = stage.num === currentStage;
            const isFuture = !isDone && !isCurrent;
            return (
              <div
                key={stage.num}
                className="flex min-w-0 flex-1 items-start"
                style={{ minWidth: 72 }}
              >
                <div className="flex flex-col items-center flex-1">
                  <div className="flex items-center w-full">
                    {i > 0 && (
                      <div
                        className="h-0.5 flex-1"
                        style={{ background: isDone ? BRAND.green : darkMode_bg() }}
                      />
                    )}
                    <div
                      className={cn(
                        "w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold transition-all",
                        isFuture && "bg-muted text-muted-foreground border border-border",
                      )}
                      style={
                        isDone
                          ? { background: BRAND.green, color: "white" }
                          : isCurrent
                            ? {
                                background: BRAND.accent,
                                color: "white",
                                boxShadow: `0 0 16px ${BRAND.accent}60`,
                              }
                            : {}
                      }
                    >
                      {isDone ? <CheckCircle2 className="w-4 h-4" /> : stage.num}
                    </div>
                    {i < stages.length - 1 && (
                      <div
                        className="h-0.5 flex-1"
                        style={{
                          background: data.checklist[i + 1]?.completed
                            ? BRAND.green
                            : darkMode_bg(),
                        }}
                      />
                    )}
                  </div>
                  <span
                    className={cn(
                      "mt-1.5 w-full text-center text-2xs leading-tight",
                      isCurrent ? "font-semibold" : "font-medium opacity-60",
                    )}
                    style={{ color: isCurrent ? BRAND.accent : undefined }}
                  >
                    {stage.label.replace(/^\s*\d+\.\s*/, "")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Full checklist with start + due dates */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="heading-section text-foreground">Checklist</h2>
          <span className="text-xs font-semibold text-muted-foreground">
            {checklist_progress.completed} of {checklist_progress.total} complete
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs font-semibold text-muted-foreground pb-2.5 w-full">Task</th>
              <th className="text-right text-xs font-semibold text-muted-foreground pb-2.5 whitespace-nowrap pl-6">Start Date</th>
              <th className="text-right text-xs font-semibold text-muted-foreground pb-2.5 whitespace-nowrap pl-6">Due Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.checklist
              .filter((item) => item.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
              .map((item, i) => {
                const overdue =
                  !item.completed && item.due_date ? new Date(item.due_date) < new Date() : false;
                return (
                  <tr key={`${item.title}-${i}`}>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CheckCircle2
                          className="w-4 h-4 flex-shrink-0"
                          style={{ color: item.completed ? BRAND.green : "#cbd5e1" }}
                        />
                        <span
                          className={cn(
                            "truncate",
                            item.completed ? "text-muted-foreground" : "text-foreground font-medium",
                          )}
                        >
                          {item.title}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pl-6 text-right whitespace-nowrap text-xs text-muted-foreground">
                      {item.start_date ? formatDate(item.start_date) : "—"}
                    </td>
                    <td className={cn("py-2.5 pl-6 text-right whitespace-nowrap text-xs font-semibold", overdue ? "text-destructive" : "text-muted-foreground")}>
                      {item.due_date ? formatDate(item.due_date) : "—"}
                      {overdue && <span className="ml-1 font-normal text-2xs">(overdue)</span>}
                    </td>
                  </tr>
                );
              })}
            {data.checklist.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-sm text-muted-foreground">No checklist items yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Customer-visible tasks */}
      {data.tasks && data.tasks.length > 0 && (
        <Card className="p-6">
          <h2 className="heading-section text-foreground mb-4">Your Action Items</h2>
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
            {data.tasks.map((task) => (
              <TaskActionItem
                key={task.id}
                task={task}
                status={taskStatuses[task.id] ?? task.status}
                comments={taskComments.filter((c) => c.checklist_task_id === task.id)}
                onToggle={() => onToggleTask(task.id)}
                onComment={(text) => onSubmitTaskComment(task.id, text)}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Notes & Updates (full width — Project Overview removed) */}
      <div>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="heading-card text-foreground">Notes & Updates</h3>
            <button
              onClick={onSaveNote}
              disabled={!noteText.trim()}
              className="text-xs font-bold text-white px-4 py-1.5 rounded transition-colors disabled:opacity-40"
              style={{ background: BRAND.primary }}
            >
              Save
            </button>
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note for your SE..."
            className="w-full bg-muted/40 border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {savedNotes.length > 0 && (
            <div className="mt-4 space-y-2 max-h-[320px] overflow-y-auto">
              {savedNotes.map((note, i) => (
                <NoteRow
                  key={i}
                  note={note}
                  onEdit={(text) => onEditNote(i, text)}
                  onDelete={() => onDeleteNote(i)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        className="px-5 py-3 flex items-center gap-3"
        style={{ borderLeft: `3px solid ${BRAND.accent}` }}
      >
        <Zap className="w-4 h-4 flex-shrink-0" style={{ color: BRAND.accent }} />
        <p className="text-sm text-muted-foreground">
          Your {orgName} SE will advance your stage once milestones are complete. Use{" "}
          <span className="font-bold text-foreground">Handover Assist</span> for help.
        </p>
      </Card>
    </div>
  );
}

function darkMode_bg() {
  return "#253553";
}

function NoteRow({
  note,
  onEdit,
  onDelete,
}: {
  note: MerchantNote;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const d = new Date(note.timestamp);
  const save = () => {
    const t = draft.trim();
    if (!t) return;
    onEdit(t);
    setEditing(false);
  };
  return (
    <div className="bg-muted/40 border border-border rounded-lg px-3 py-2 group">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-card border border-border rounded-md p-2 text-sm text-foreground resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-ring/30"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              className="text-2xs font-bold text-white px-3 py-1 rounded"
              style={{ background: BRAND.primary }}
            >
              Save
            </button>
            <button
              onClick={() => {
                setDraft(note.text);
                setEditing(false);
              }}
              className="text-2xs font-medium text-muted-foreground hover:text-foreground px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <p className="text-sm text-foreground flex-1 whitespace-pre-wrap break-words">
              {note.text}
            </p>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                title="Edit"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  if (confirm("Delete this note?")) onDelete();
                }}
                className="p-1 rounded hover:bg-destructive-soft text-muted-foreground hover:text-destructive-strong"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          <p className="text-2xs text-muted-foreground mt-1">
            {d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
            {d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
          </p>
        </>
      )}
    </div>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

/* ===================== CREDENTIALS PAGE ===================== */
function CredentialsPage({
  project,
  credentials,
}: {
  project: PortalData["project"];
  credentials: PortalData["credentials"];
}) {
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");
  const creds = env === "sandbox" ? credentials?.sandbox : credentials?.production;
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="heading-page text-foreground">My Credentials</h1>
        <p className="text-sm text-muted-foreground">
          Keep your App Secret secure. Do not share it publicly.
        </p>
      </div>

      <div className="flex gap-2">
        {(["sandbox", "production"] as const).map((e) => (
          <button
            key={e}
            onClick={() => setEnv(e)}
            className={cn(
              "px-5 py-2 rounded-lg text-sm font-semibold transition-all capitalize",
              env === e ? "text-white shadow-md" : "bg-muted text-muted-foreground hover:bg-muted",
            )}
            style={env === e ? { background: BRAND.primary } : {}}
          >
            {e}
          </button>
        ))}
      </div>

      <Card className="p-6 space-y-5">
        <h3 className="heading-card text-foreground">
          {env === "sandbox" ? "Sandbox" : "Production"} Credentials
        </h3>
        <CredentialField label="MERCHANT ID (MID)" value={creds?.mid || project.mid || "NA"} />
        <CredentialField
          label="APP ID"
          value={
            creds?.app_id ||
            "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
          }
          masked
          sensitive={!!creds?.app_id}
        />
        <CredentialField
          label="APP SECRET"
          value={
            creds?.app_secret ||
            "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
          }
          masked
          sensitive={!!creds?.app_secret}
        />
        <CredentialField
          label="BASE URL"
          value={
            creds?.base_url ||
            (env === "sandbox" ? "https://sandbox.api.gokwik.co" : "https://api.gokwik.co")
          }
        />
        <CredentialField
          label="CONFIG ID (MERCHANT VALIDATOR)"
          value={
            project.config_id ||
            credentials?.sandbox?.config_id ||
            credentials?.production?.config_id ||
            "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
          }
          masked
          sensitive={
            !!(
              project.config_id ||
              credentials?.sandbox?.config_id ||
              credentials?.production?.config_id
            )
          }
        />
      </Card>
    </div>
  );
}

function CredentialField({
  label,
  value,
  masked,
  sensitive,
}: {
  label: string;
  value: string;
  masked?: boolean;
  sensitive?: boolean;
}) {
  // `masked` = field can be hidden behind dots. `sensitive` = true when value is real (not the placeholder dots).
  // Default: if masked AND sensitive (real value present), hide it; user clicks eye to reveal.
  // If masked but no real value (placeholder), just show the placeholder with no toggle.
  const hasRealValue = sensitive ?? !value.startsWith("\u2022\u2022\u2022");
  const [visible, setVisible] = useState(false);
  const showToggle = masked && hasRealValue;
  const displayVal =
    showToggle && !visible
      ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
      : value;
  return (
    <div>
      <p className="text-2xs font-bold text-muted-foreground tracking-normal mb-1.5">{label}</p>
      <div className="bg-muted/40 border border-border rounded-lg px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-foreground font-mono">{displayVal}</span>
        <div className="flex items-center gap-2">
          {showToggle && (
            <button
              onClick={() => setVisible(!visible)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={visible ? "Hide" : "Reveal"}
            >
              {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
          <CopyButton text={value} />
        </div>
      </div>
    </div>
  );
}

/* ===================== DOCUMENTS PAGE ===================== */
function DocumentsPage({
  data,
  setActivePage,
  token,
  onUploaded,
}: {
  data: PortalData;
  setActivePage: (p: NavPage) => void;
  token: string;
  onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customerUploads = (data.uploads || []).filter(
    (u) => u.upload_type === "customer_document" || u.uploaded_by === "merchant",
  );

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("token", token);
      form.append("upload_type", "customer_document");
      const res = await fetch(`${API_URL}/upload`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Upload failed");
      onUploaded();
    } catch (err: any) {
      alert(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };
  const docs: {
    icon: React.ReactNode;
    title: string;
    desc: string;
    badge: string;
    link?: string | null;
    onClick?: () => void;
    badgeColor?: string;
  }[] = [];

  if (data.project.brd_link) {
    docs.push({
      icon: <FileText className="w-5 h-5" style={{ color: BRAND.primary }} />,
      title: "BRD Document",
      desc: "Business Requirements Document",
      badge: "Available",
      link: data.project.brd_link,
    });
  }

  if (data.project.sow_link) {
    docs.push({
      icon: <BookOpen className="w-5 h-5" style={{ color: BRAND.primary }} />,
      title: "SOW / Merchant Playbook",
      desc: "Statement of Work & Integration Playbook",
      badge: "Available",
      link: data.project.sow_link,
    });
  }

  // The remaining link fields from Settings → Links. Anything filled in on the
  // project belongs in front of the merchant, not only BRD and SOW.
  if (data.project.mint_checklist_link) {
    docs.push({
      icon: <ListChecks className="w-5 h-5" style={{ color: BRAND.primary }} />,
      title: "Onboarding Checklist",
      desc: "Pre-integration checklist for your onboarding",
      badge: "Available",
      link: data.project.mint_checklist_link,
    });
  }

  if (data.project.integration_checklist_link) {
    docs.push({
      icon: <ListChecks className="w-5 h-5" style={{ color: BRAND.primary }} />,
      title: "Integration Checklist",
      desc: "Technical checklist for your integration",
      badge: "Available",
      link: data.project.integration_checklist_link,
    });
  }

  if (data.project.jira_link) {
    docs.push({
      icon: <ExternalLink className="w-5 h-5" style={{ color: BRAND.primary }} />,
      title: "Project Tracker",
      desc: "Live ticket board for this integration",
      badge: "Available",
      link: data.project.jira_link,
    });
  }


  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="heading-page text-foreground">Documents & Resources</h1>
        <p className="text-sm text-muted-foreground">
          Access your integration documents and resources.
        </p>
      </div>
      <div className="space-y-3">
        {docs.map((doc, i) => {
          const inner = (
            <Card className="p-5 flex items-center gap-4 hover:border-primary/40 transition-colors cursor-pointer">
              <div className="w-10 h-10 rounded-lg bg-muted/40 flex items-center justify-center flex-shrink-0">
                {doc.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-foreground">{doc.title}</p>
                <p className="text-xs text-muted-foreground">{doc.desc}</p>
              </div>
              <span
                className={cn(
                  "text-2xs font-bold px-2.5 py-1 rounded",
                  doc.badgeColor === "blue"
                    ? "bg-info-soft text-info-strong"
                    : "bg-success-soft text-success-strong",
                )}
              >
                {doc.badge}
              </span>
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </Card>
          );
          return doc.onClick ? (
            <button key={i} type="button" onClick={doc.onClick} className="block w-full text-left">
              {inner}
            </button>
          ) : (
            <a
              key={i}
              href={doc.link || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              {inner}
            </a>
          );
        })}
      </div>

      {docs.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">No documents shared yet</p>
        </Card>
      )}

      {/* ── Customer document uploads ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Your Documents</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Upload documents you'd like to share with the team.</p>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-60"
            style={{ background: BRAND.primary }}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading…" : "Upload document"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { handleFileUpload(f); e.target.value = ""; }
            }}
          />
        </div>

        {customerUploads.length > 0 ? (
          <div className="space-y-3">
            {customerUploads.map((u) => (
              <Card key={u.id} className="p-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-lg bg-muted/40 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{u.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <a href={u.file_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline flex-shrink-0">
                  View <ExternalLink className="w-3 h-3" />
                </a>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-6 text-center">
            <Upload className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
          </Card>
        )}
      </div>
    </div>
  );
}


/* ===================== PAYMENT SIMULATOR PAGE ===================== */
function PaymentSimulatorPage({ link }: { link: string }) {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="heading-page text-foreground">Payment Simulator</h1>
        <p className="text-sm text-muted-foreground">
          Run end-to-end test transactions on a sandbox payment flow.
        </p>
      </div>

      <div
        className="rounded-xl p-6"
        style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryLight})` }}
      >
        <div className="flex items-center gap-3 mb-1">
          <Zap className="w-5 h-5 text-white" />
          <h2 className="heading-section text-white">Sandbox Payment Simulator</h2>
        </div>
        <p className="text-sm text-white/70">
          Validate your checkout integration with simulated success, failure and pending scenarios —
          no real charges are made.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: BRAND.primarySoft }}
          >
            <Zap className="w-5 h-5" style={{ color: BRAND.primary }} />
          </div>
          <div className="flex-1">
            <h3 className="heading-card text-foreground">About the Simulator</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The Payment Simulator lets you trigger end-to-end sandbox payment flows tied to your
              merchant configuration. Use it to verify webhooks, order status updates and the full
              checkout experience before going live.
            </p>
          </div>
        </div>

        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-bold text-white shadow-sm transition-colors"
          style={{ background: BRAND.primary }}
        >
          <ExternalLink className="w-4 h-4" /> Open Payment Simulator
        </a>
      </Card>
    </div>
  );
}

/* ===================== MERCHANT VALIDATOR PAGE ===================== */

function FAQPage({ faqs: managedFaqs = [] }: { faqs?: PortalFaq[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const faqs = managedFaqs
    .filter((f) => f.question.trim() && f.answer.trim())
    .map((f) => ({ q: f.question, a: f.answer }));

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="heading-page text-foreground">FAQ & Help</h1>
        <p className="text-sm text-muted-foreground">Answers shared by your project team.</p>
      </div>
      <div className="space-y-2">
        {faqs.length === 0 && (
          <Card className="p-5 text-sm text-muted-foreground">
            No FAQs have been added to this project yet.
          </Card>
        )}
        {faqs.map((faq, i) => (
          <Card key={i} className="overflow-hidden">
            <button
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/50 transition-colors"
            >
              <span className="text-sm text-foreground">{faq.q}</span>
              <ChevronRight
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform",
                  openIdx === i && "rotate-90",
                )}
              />
            </button>
            {openIdx === i && (
              <div className="px-5 pb-4">
                <p className="text-sm text-muted-foreground whitespace-pre-line">{faq.a}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ===================== MANDATORY APIS PAGE ===================== */
const MANDATORY_API_DOC_LINKS: Record<string, string> = {
  "Get Cart":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#ce6c02b2-57bc-4f71-86b9-6967a2dcd0cf",
  "Set Shipping Address":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#3e16f54e-cf77-4fd5-ac46-8058e10a1965",
  "Set Shipping Option":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#10f41fa4-e17f-4009-94ad-773e3e5d0575",
  "Get Available Coupon":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#b2419dfa-27e8-4ac7-b6c8-1e53a7922a1b",
  "Apply Discount":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#5769ba9e-f594-4352-916c-c3c01e8c5463",
  "Remove Discount":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#39df3e59-8304-49ba-9ab9-e03472b4982a",
  "Create Order":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#a1d00cfa-265e-43c3-9bac-4d3aca2e21dc",
  "Place Order":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#1cca8fbf-b36d-4aed-a121-08a1c46bd91a",
  "Update Order":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#2eb04ba6-291b-4603-90ea-f58712acce2a",
  "Split Order":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#5f27d842-a665-4867-a653-89377c221c45",
  "Get Merchant User":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#f4299835-b476-4528-83ae-632e311460a1",
  "Apply Wallet Credit":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#8a701213-8715-4f8f-891f-6ad3878d0b9a",
  "Remove Wallet Credit":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#f589f863-42f2-4be5-a35f-7e428fa03678",
  "Get Available Membership Item":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#5a208267-7d29-469e-bf77-a14850a58726",
  "Add Membership":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#602697ea-a5a6-44b6-88cb-bddf22c4b623",
  "Remove Membership":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#16ba6240-78fc-42ad-9189-218c7e2f70a4",
  "Remove Out of Stock Products":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#9a44aa3f-9765-4417-9259-626431712d46",
  "Check Order Status":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#3adc769c-b933-4fe8-8fb2-3360c72eecc1",
  "Get Redirection URL":
    "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#977ab78c-a343-4584-a9d2-16af5b3a47fc",
  "Sync Product":
    "https://documenter.getpostman.com/view/53067515/2sBXqQFxdo#a6ca9856-bcd6-4153-82a9-840de2ccb557",
  "Sync Collection":
    "https://documenter.getpostman.com/view/53067515/2sBXqQFxdo#0b4716a8-09b2-495d-afe4-fc701e5370be",
};

function IntroOnePagerModal({
  merchantName,
  onClose,
}: {
  merchantName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-card rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-border">
        <div
          className="px-7 py-6 border-b border-border flex items-start justify-between gap-4"
          style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryLight})` }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-5 h-5 text-white" fill="white" />
              <h2 className="heading-page text-white">Welcome to Handover Assist</h2>
            </div>
            <p className="text-sm text-white/80">
              Hi <strong>{merchantName}</strong> — here's how this portal helps you go live faster.
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-7 py-6 space-y-5">
          <div>
            <h3 className="heading-card text-foreground mb-2">🎯 What problem does this solve?</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Merchant integrations often stall because credentials, documents, status updates, and
              validations live across emails, Jira, Slack, and spreadsheets.{" "}
              <strong>
                Handover Assist consolidates everything you need to go live into one secure
                workspace
              </strong>{" "}
              — eliminating back-and-forth and accelerating time-to-launch.
            </p>
          </div>
          <div>
            <h3 className="heading-card text-foreground mb-2">⚡ How are we solving it?</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="text-info-strong">1.</span>
                <span>
                  <strong>Single source of truth</strong> — Live integration status, owner, and next
                  steps, always in sync with your Handover CE.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-info-strong">2.</span>
                <span>
                  <strong>Secure credentials vault</strong> — Sandbox & production keys hidden by
                  default, with copy + reveal controls.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-info-strong">3.</span>
                <span>
                  <strong>Self-service validation</strong> — Run the Payment Simulator without
                  waiting on your onboarding manager.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-info-strong">4.</span>
                <span>
                  <strong>Documents on demand</strong> — BRD, SOW, mandatory APIs, KwikPass & MCP
                  guides, all linked from one place.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-info-strong">5.</span>
                <span>
                  <strong>AI assistant</strong> — Ask anything about your integration; trained on
                  your project's context.
                </span>
              </li>
            </ul>
          </div>
          <div className="p-4 rounded-lg bg-warning-soft border border-warning/30">
            <p className="text-xs text-warning-strong">
              💡 <strong>Tip:</strong> Use the side panel on the right of each page for quick
              guidance. Ping your CE through the in-app chat if you get stuck.
            </p>
          </div>
        </div>
        <div className="px-7 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: BRAND.primary }}
          >
            Get Started →
          </button>
        </div>
      </div>
    </div>
  );
}
