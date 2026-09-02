import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useParams } from "@/lib/router-compat";
import {
  CheckCircle2, Loader2, ShieldAlert, ChevronLeft, ChevronRight,
  LayoutDashboard, FileText, HelpCircle, Moon, Sun, Lock,
  Zap, Search, AlertTriangle, Copy, Check,
  Upload, Image, Download, X, Eye, EyeOff, ExternalLink, BookOpen, FileCode,
  MessageCircle, Send, Bot, ChevronDown, KeyRound, Code, LogOut, Trash2, Pencil,
  ClipboardList
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GuidedTour, type TourStep } from "@/components/GuidedTour";

const API_URL = `/api/public/merchant-portal-data`;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Clean, professional palette
const BRAND = {
  primary: "#30658F",
  primaryLight: "#3f7fb0",
  primarySoft: "#e8f1f7",
  accent: "#3f7fb0",
  accentLight: "#cfe1ee",
  logoKwik: "#30658F",
  logoAssist: "#30658F",
  green: "#16a34a",
  greenLight: "#dcfce7",
  red: "#dc2626",
  redLight: "#fee2e2",
  amber: "#d97706",
  amberLight: "#fef3c7",
  white: "#FFFFFF",
  bg: "#F8FAFC",
  // Dark theme - improved palette
  bgDark: "#0c1220",
  cardDark: "#141e30",
  cardDarkHover: "#1a2740",
  borderDark: "#253553",
  textDark: "#e2e8f0",
  textDarkMuted: "#94a3b8",
  textDarkFaint: "#64748b",
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

const POSTMAN_COLLECTION_URL = "https://documenter.getpostman.com/view/53067515/2sBXqQFxdo#3df70d23-774a-4599-945a-21f28ef6b6c4";

interface PortalData {
  project: {
    id: string;
    merchant_name: string;
    mid: string;
    platform: string;
    category: string;
    integration_type: string;
    current_phase: string;
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
    enable_mcp_document: boolean;
    mcp_config_id: string | null;
    enable_kp: boolean;
    kp_prod_jwe_key: string | null;
    kp_sandbox_jwe_key: string | null;
    mandatory_apis: string[];
    faq_help: PortalFaq[];
    payment_simulator_link: string | null;
  };
  owner: { name: string; email: string; team: string } | null;
  checklist_progress: { completed: number; total: number; percent: number };
  checklist: {
    title: string;
    completed: boolean;
    completed_at: string | null;
    phase: string;
    owner_team: string;
    due_date: string | null;
  }[];
  custom_fields: { key: string; label: string; type: string; value: string | null }[];
  recent_activity: {
    description: string;
    category: string;
    created_at: string;
    user_name: string;
  }[];
  branding: Record<string, string>;
  credentials: {
    sandbox: { mid?: string; app_id?: string; app_secret?: string; base_url?: string; config_id?: string; kwikpass_jwe_key?: string };
    production: { mid?: string; app_id?: string; app_secret?: string; base_url?: string; config_id?: string; kwikpass_jwe_key?: string };
  } | null;
  uploads: PortalUpload[];
  brd_progress?: { answered: number; total: number; percent: number; status: string | null };
}

// STAGES are dynamically derived from the checklist items (MINT checklist)
function buildStagesFromChecklist(checklist: PortalData["checklist"]): { num: number; label: string }[] {
  if (!checklist || checklist.length === 0) {
    return [{ num: 1, label: "No Items" }];
  }
  return checklist.map((item, i) => ({
    num: i + 1,
    label: item.title.length > 18 ? item.title.substring(0, 16) + "…" : item.title,
  }));
}

function formatArr(arr: number | null): string {
  if (!arr) return "—";
  if (arr >= 10000000) return `${(arr / 10000000).toFixed(2)} Cr`;
  if (arr >= 100000) return `${(arr / 100000).toFixed(2)} L`;
  return arr.toLocaleString("en-IN");
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return d;
}

function deriveCurrentStage(data: PortalData): number {
  const checklist = data.checklist;
  if (!checklist || checklist.length === 0) return 1;
  // Current stage = first incomplete item index + 1, or total if all done
  const firstIncomplete = checklist.findIndex(c => !c.completed);
  if (firstIncomplete === -1) return checklist.length;
  return firstIncomplete + 1;
}

type NavPage = "integration" | "credentials" | "documents" | "faq" | "simulator" | "kwikpass" | "mcp" | "mandatoryApis" | "brd";

// ========== COPY BUTTON ==========
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all
        border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50
        dark:border-slate-500 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-600"
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ========== KWIKASSIST LOGO ==========
function KwikAssistLogo({ size = "md", onClick }: { size?: "sm" | "md" | "lg"; onClick?: () => void }) {
  const sizes = { sm: "text-sm", md: "text-lg", lg: "text-2xl" };
  return (
    <button onClick={onClick} className={cn("font-bold tracking-tight", sizes[size])}>
      <span style={{ color: BRAND.logoKwik }} className="dark:text-white">Handover</span>
      <span className="text-[10px] text-slate-400 ml-1 font-medium">PORTAL</span>
    </button>
  );
}

// ========== AI CHATBOT ==========
function AiChatWidget({ merchantName, token, faqs = [] }: { merchantName: string; token: string; faqs?: PortalFaq[] }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "assistant", content: `Hi! I'm Handover Assist 🤖\n\nI can help you with:\n• API integration questions\n• Debugging common errors\n• Validator guidance\n• Setup & configuration\n\nHow can I help you today?` },
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
          messages: newMsgs.slice(-10).map(m => ({ role: m.role, content: m.content })),
          merchant_name: merchantName,
          faqs: faqs.filter(f => f.question.trim() && f.answer.trim()).slice(0, 25),
        }),
      });

      if (!res.ok) {
        throw new Error("Failed");
      }

      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply || "I'm sorry, I couldn't process that. Please try again." }]);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "I'm having trouble connecting right now. Here are some quick tips:\n\n• Check your API credentials in the Credentials section\n• Use the Merchant Validator to test your integration\n• Review the FAQ section for common questions\n• Contact your SE for specific issues"
      }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-tour="tour-ai"
        className="fixed bottom-5 left-5 z-50 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-all hover:scale-110 active:scale-95"
        style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.accent})` }}
        title="Handover Assist Chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 left-5 z-50 w-[380px] max-h-[560px] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-600" style={{ background: BRAND.primary }}>
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-white">Handover Assist</p>
          <p className="text-[10px] text-white/70">Integration Support</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[380px]">
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed",
              msg.role === "user"
                ? "text-white rounded-br-sm"
                : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
            )} style={msg.role === "user" ? { background: BRAND.primary } : {}}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-700 px-4 py-3 rounded-2xl rounded-bl-sm">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-600">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask about your integration..."
            className="flex-1 px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
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
    if (tokenFromQuery) { setResolvedToken(tokenFromQuery); return; }
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
      .then(r => r.json())
      .then(d => {
        if (d.token) {
          setResolvedToken(d.token);
          try { localStorage.setItem(`portal_mid_${d.token}`, midFromPath); } catch {}
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

  // Task completion state
  const [taskCompletions, setTaskCompletions] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [darkMode]);

  useEffect(() => {
    if (token) {
      const stored = localStorage.getItem(`portal_auth_${token}`) || sessionStorage.getItem(`portal_auth_${token}`);
      let lastCredentials: { appId?: string; email?: string } = {};
      try { lastCredentials = JSON.parse(localStorage.getItem("portal_last_credentials") || "{}"); } catch {}
      const storedEmail = localStorage.getItem(`portal_email_${token}`) || sessionStorage.getItem(`portal_email_${token}`) || lastCredentials.email;
      const storedMid = localStorage.getItem(`portal_mid_${token}`) || localStorage.getItem(`portal_app_id_${token}`) || lastCredentials.appId;
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
        try { setSavedNotes(JSON.parse(storedNotes)); } catch {}
      }
      // Load task completions
      const tasksKey = `portal_tasks_${token}`;
      const storedTasks = localStorage.getItem(tasksKey);
      if (storedTasks) {
        try { setTaskCompletions(JSON.parse(storedTasks)); } catch {}
      }
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
      .then(r => r.json())
      .then(d => {
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
    const newNote: MerchantNote = { text: noteText.trim(), timestamp: new Date().toISOString() };
    const updated = [newNote, ...savedNotes];
    setSavedNotes(updated);
    localStorage.setItem(`portal_notes_${token}`, JSON.stringify(updated));
    setNoteText("");
  };

  const editNote = (idx: number, newText: string) => {
    if (!token) return;
    const updated = savedNotes.map((n, i) => i === idx ? { ...n, text: newText, timestamp: new Date().toISOString() } : n);
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
    try { lastCredentials = JSON.parse(localStorage.getItem("portal_last_credentials") || "{}"); } catch {}
    const storedEmail = localStorage.getItem(`portal_email_${token}`) || lastCredentials.email;
    const storedMid = localStorage.getItem(`portal_mid_${token}`) || localStorage.getItem(`portal_app_id_${token}`) || lastCredentials.appId;
    setMidInput(storedMid || "");
    setEmailInput(storedEmail || "");
  };

  const toggleTask = (idx: number) => {
    if (!token) return;
    const updated = { ...taskCompletions, [idx]: !taskCompletions[idx] };
    setTaskCompletions(updated);
    localStorage.setItem(`portal_tasks_${token}`, JSON.stringify(updated));
  };

  const handleMidLogin = async () => {
    if (!token || !midInput.trim()) {
      setLoginError("Please enter your APP ID");
      return;
    }
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
        localStorage.setItem("portal_last_credentials", JSON.stringify({ appId: midInput.trim(), email: cleanEmail }));
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
      .then((d) => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError("Failed to load data."))
      .finally(() => setLoading(false));
  }, [token, isAuthenticated]);

  useEffect(() => { refreshData(); }, [refreshData]);

  const currentStage = useMemo(() => (data ? deriveCurrentStage(data) : 1), [data]);
  const orgName = data?.branding?.org_name || "Handover";

  // ===== NO TOKEN =====
  if (!token) {
    if (resolvingMid) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0c1220]">
          <div className="text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-slate-500" />
            <p className="text-slate-500 dark:text-slate-300 text-sm">Opening portal for {midFromPath}…</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0c1220] px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center bg-red-50 dark:bg-red-900/30">
            <ShieldAlert className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Access Denied</h1>
          <p className="text-slate-500 dark:text-slate-300 text-sm">{resolveError || "No access token provided. Please use the link shared by your integration team."}</p>
        </div>
      </div>
    );
  }

  // ===== MAGIC LINK AUTH LOADING =====
  if (isMagicLink && !isAuthenticated && magicAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0c1220]">
        <div className="text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-slate-500" />
          <p className="text-slate-500 dark:text-slate-300 text-sm">Signing you in via secure link…</p>
        </div>
      </div>
    );
  }

  // ===== MID LOGIN GATE =====
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-[#0c1220] dark:via-[#101b2e] dark:to-[#0c1220]">
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #30658F 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        <div className="w-full max-w-md relative z-10">
          <div className="bg-white dark:bg-[#141e30] rounded-2xl shadow-xl shadow-slate-200/60 dark:shadow-black/40 p-8 border border-slate-200 dark:border-[#253553]">
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-md" style={{ background: BRAND.primary }}>
                <Zap className="w-7 h-7 text-white" fill="white" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                <span style={{ color: BRAND.logoKwik }} className="dark:text-white">Handover</span>
                <span className="text-xs font-medium text-slate-400 ml-1">PORTAL</span>
              </h1>
              <p className="text-slate-500 dark:text-slate-300 text-sm mt-2 font-medium">
                Your Complete Merchant Integration Workspace
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  <Lock className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                  APP ID
                </label>
                <input
                  type="text"
                  value={midInput}
                  onChange={(e) => { setMidInput(e.target.value); setLoginError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleMidLogin(); }}
                  placeholder="Enter your APP ID"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-[#253553] bg-slate-50 dark:bg-[#1a2740] text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  Work Email
                </label>
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => { setEmailInput(e.target.value); setLoginError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleMidLogin(); }}
                  placeholder="you@company.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-[#253553] bg-slate-50 dark:bg-[#1a2740] text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1.5">We use this to track your integration progress.</p>
              </div>

              {loginError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30">
                  <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-600 dark:text-red-300">{loginError}</p>
                </div>
              )}

              <button
                onClick={handleMidLogin}
                disabled={loginLoading || !midInput.trim() || !emailInput.trim()}
                className="w-full py-3 px-4 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] shadow-lg hover:shadow-xl"
                style={{ background: BRAND.primary, boxShadow: `0 8px 24px -4px ${BRAND.primary}40` }}
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

            <div className="mt-6 pt-5 border-t border-slate-100 dark:border-[#253553]">
              <p className="text-center text-[11px] text-slate-400 dark:text-slate-400">
                Your APP ID was shared by your Handover integration team.
                <br />Contact your project manager if you need assistance.
              </p>
            </div>
          </div>
          <p className="text-center text-[10px] text-slate-400 dark:text-slate-500 mt-4">Powered by Handover</p>
        </div>
      </div>
    );
  }

  // ===== LOADING DATA =====
  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0c1220]">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ background: BRAND.primary }}>
            <Loader2 className="w-6 h-6 animate-spin text-white" />
          </div>
          <p className="text-slate-500 dark:text-slate-300 text-sm">Loading your integration workspace...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0c1220] px-4">
        <div className="text-center max-w-md">
          <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-red-500" />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Access Denied</h1>
          <p className="text-slate-500 dark:text-slate-300 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const { project, owner, checklist_progress } = data;

  return (
    <div className="h-screen bg-slate-50 dark:bg-[#0c1220] text-slate-900 dark:text-slate-100 flex flex-col overflow-hidden">
      {/* TOP HEADER */}
      <header className="h-14 flex items-center px-4 gap-3 sticky top-0 z-50 flex-shrink-0 border-b border-slate-200 dark:border-[#253553] bg-white dark:bg-[#111827] shadow-sm">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: BRAND.primary }}>
          <Zap className="w-4 h-4 text-white" fill="white" />
        </div>
        <KwikAssistLogo size="sm" onClick={() => setActivePage("integration")} />
        <span className="text-[10px] text-white px-2 py-0.5 rounded font-bold uppercase" style={{ background: BRAND.primary }}>Merchant</span>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: BRAND.primary }}>
            {project.merchant_name?.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 hidden sm:inline">{project.merchant_name}</span>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-[#1a2740] flex items-center justify-center text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white transition-colors"
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-slate-100 dark:bg-[#1a2740] text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/15 text-xs font-semibold transition-colors"
            title="Sign out of the portal"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* SIDEBAR */}
        <aside className="w-56 flex flex-col flex-shrink-0 hidden md:flex border-r border-slate-200 dark:border-[#253553] bg-white dark:bg-[#111827]">
          <div className="px-4 pt-5 pb-2">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-3">Navigation</p>
          </div>
          <nav className="px-2 space-y-0.5 flex-1">
            <SidebarItem icon={LayoutDashboard} label="My Integration" active={activePage === "integration"} onClick={() => setActivePage("integration")} dataTour="tour-integration" />
            <SidebarItem icon={Lock} label="Credentials" active={activePage === "credentials"} onClick={() => setActivePage("credentials")} dataTour="tour-credentials" />
            <SidebarItem icon={FileText} label="Documents" active={activePage === "documents"} onClick={() => setActivePage("documents")} dataTour="tour-documents" />
            <SidebarItem
              icon={ClipboardList}
              label={`BRD Form${data.brd_progress && data.brd_progress.total ? ` · ${data.brd_progress.percent}%` : ""}`}
              active={activePage === "brd"}
              onClick={() => setActivePage("brd")}
              dataTour="tour-brd"
            />
            <SidebarItem icon={HelpCircle} label="FAQ & Help" active={activePage === "faq"} onClick={() => setActivePage("faq")} dataTour="tour-faq" />
            {project.payment_simulator_link && (
              <SidebarItem icon={Zap} label="Payment Simulator" active={activePage === "simulator"} onClick={() => setActivePage("simulator")} dataTour="tour-simulator" />
            )}
          </nav>
        </aside>

        {/* MAIN CONTENT */}
        <main className="flex-1 overflow-y-auto">
          {activePage === "integration" && (
            <IntegrationPage data={data} project={project} owner={owner}
              checklist_progress={checklist_progress} currentStage={currentStage}
              noteText={noteText} setNoteText={setNoteText} orgName={orgName}
              savedNotes={savedNotes} onSaveNote={saveNote}
              onEditNote={editNote} onDeleteNote={deleteNote}
              taskCompletions={taskCompletions} onToggleTask={toggleTask}
              brdProgress={data.brd_progress}
              onOpenBrd={() => setActivePage("brd")} />
          )}
          {activePage === "credentials" && <CredentialsPage project={project} credentials={data.credentials} />}
          {activePage === "documents" && <DocumentsPage data={data} setActivePage={setActivePage} />}
          {activePage === "brd" && <BrdPage token={token!} onProgress={refreshData} />}
          {activePage === "kwikpass" && project.enable_kp && <KwikPassPage project={project} credentials={data.credentials} onBack={() => setActivePage("documents")} />}
          {activePage === "mcp" && project.enable_mcp_document && <MCPPage project={project} credentials={data.credentials} onBack={() => setActivePage("documents")} />}
          {activePage === "mandatoryApis" && <MandatoryApisPage project={project} onBack={() => setActivePage("documents")} />}
          {activePage === "faq" && <FAQPage faqs={project.faq_help} />}
          {activePage === "simulator" && project.payment_simulator_link && (
            <PaymentSimulatorPage link={project.payment_simulator_link} />
          )}
        </main>

      </div>

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
function SidebarItem({ icon: Icon, label, active, onClick, badge, dataTour }: {
  icon: any; label: string; active?: boolean; onClick?: () => void; badge?: number; dataTour?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-tour={dataTour}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left border-l-[3px]",
        active
          ? "font-semibold shadow-sm"
          : "border-l-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-[#1a2740]"
      )}
      style={active ? { color: "#ffffff", borderLeftColor: BRAND.primary, background: BRAND.primary } : {}}
    >
      <Icon className={cn("w-4 h-4 flex-shrink-0")} />
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className={cn("text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold", active ? "bg-white text-slate-900" : "text-white")} style={!active ? { background: BRAND.primary } : {}}>{badge}</span>
      )}
    </button>
  );
}

/* ===================== CARD WRAPPER ===================== */
function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("bg-white dark:bg-[#141e30] border border-slate-200 dark:border-[#253553] rounded-xl shadow-sm", className)} style={style}>
      {children}
    </div>
  );
}

/* ===================== INTEGRATION PAGE ===================== */
function BrdPage({ token, onProgress }: { token: string; onProgress?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brdToken, setBrdToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ percent: number; answered: number; total: number; status: string | null } | null>(null);

  const fetchSession = useCallback(async (withLoading: boolean) => {
    if (withLoading) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/brd-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: API_KEY },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load BRD");
      // Only set brd_token on the very first load; never replace it on poll —
      // changing the iframe src would reload the form and wipe the in-progress answer.
      setBrdToken((prev) => prev ?? data.brd_token);
      setInfo({ percent: data.percent, answered: data.answered, total: data.total, status: data.status });
    } catch (e) {
      if (withLoading) setError(e instanceof Error ? e.message : "Failed to load BRD");
    } finally {
      if (withLoading) setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchSession(true); }, [fetchSession]);

  // Lightweight progress poll: never touches brdToken or loading, so the iframe stays mounted.
  useEffect(() => {
    if (!brdToken) return;
    const id = window.setInterval(() => { fetchSession(false); onProgress?.(); }, 60_000);
    return () => window.clearInterval(id);
  }, [brdToken, fetchSession, onProgress]);

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
        <div className="border border-red-200 bg-red-50 dark:bg-red-900/20 rounded-xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-2" />
          <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
          <button onClick={() => fetchSession(true)} className="mt-3 text-xs font-bold text-white px-4 py-1.5 rounded" style={{ background: BRAND.primary }}>Retry</button>
        </div>
      </div>
    );
  }

  const brdUrl = brdToken ? `/brd?token=${brdToken}` : "";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 border-b border-slate-200 dark:border-[#253553] flex items-center justify-between gap-4 bg-white dark:bg-[#0c1220]">
        <div className="flex items-center gap-3 min-w-0">
          <ClipboardList className="w-5 h-5 flex-shrink-0" style={{ color: BRAND.primary }} />
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 dark:text-white truncate">BRD Form</h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {info?.answered ?? 0}/{info?.total ?? 0} answered · {info?.percent ?? 0}% complete
              {info?.status === "completed" && " · Submitted"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40 h-2 bg-slate-100 dark:bg-[#1a2740] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${info?.percent ?? 0}%`, background: (info?.percent ?? 0) === 100 ? BRAND.green : BRAND.accent }} />
          </div>
          <a href={brdUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded border border-slate-200 dark:border-[#253553] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1a2740]">
            <ExternalLink className="w-3 h-3" /> Open in new tab
          </a>
        </div>
      </div>
      <div className="flex-1 bg-white dark:bg-[#0c1220]">
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

function IntegrationPage({ data, project, owner, checklist_progress, currentStage, noteText, setNoteText, orgName, savedNotes, onSaveNote, onEditNote, onDeleteNote, taskCompletions, onToggleTask, brdProgress, onOpenBrd }: {
  data: PortalData; project: PortalData["project"]; owner: PortalData["owner"];
  checklist_progress: PortalData["checklist_progress"]; currentStage: number;
  noteText: string; setNoteText: (v: string) => void; orgName: string;
  savedNotes: MerchantNote[]; onSaveNote: () => void;
  onEditNote: (idx: number, text: string) => void;
  onDeleteNote: (idx: number) => void;
  taskCompletions: Record<number, boolean>; onToggleTask: (idx: number) => void;
  brdProgress?: PortalData["brd_progress"];
  onOpenBrd?: () => void;
}) {
  const stages = useMemo(() => buildStagesFromChecklist(data.checklist), [data.checklist]);
  const totalStages = stages.length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{project.merchant_name}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-300 mt-0.5">
              {project.brand_url || "—"} · {project.platform} · {project.integration_type || "Standard"}
            </p>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap border"
            style={{ background: BRAND.primarySoft, color: BRAND.primary, borderColor: `${BRAND.primary}30` }}>
            Stage {currentStage}: {stages[currentStage - 1]?.label}
          </span>
        </div>
        {brdProgress && brdProgress.total > 0 && (
          <button
            onClick={onOpenBrd}
            className="mt-4 w-full flex items-center justify-between gap-4 px-4 py-3 rounded-xl border-2 transition-all hover:shadow-md"
            style={{
              background: brdProgress.percent === 100 ? `${BRAND.greenLight}` : `${BRAND.amberLight}`,
              borderColor: brdProgress.percent === 100 ? BRAND.green : BRAND.amber,
            }}
          >
            <div className="flex items-center gap-3 text-left">
              <ClipboardList className="w-5 h-5 flex-shrink-0" style={{ color: brdProgress.percent === 100 ? BRAND.green : BRAND.amber }} />
              <div>
                <p className="text-sm font-bold" style={{ color: brdProgress.percent === 100 ? BRAND.green : BRAND.amber }}>
                  BRD Form · {brdProgress.percent}% complete
                </p>
                <p className="text-[11px] text-slate-600 dark:text-slate-700">
                  {brdProgress.answered}/{brdProgress.total} answered {brdProgress.status === "completed" ? "· Submitted" : "· Click to continue"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-32 h-2 bg-white/60 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${brdProgress.percent}%`, background: brdProgress.percent === 100 ? BRAND.green : BRAND.amber }} />
              </div>
              <ChevronRight className="w-4 h-4" style={{ color: brdProgress.percent === 100 ? BRAND.green : BRAND.amber }} />
            </div>
          </button>
        )}
      </div>

      {/* Integration Roadmap */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Integration Roadmap</h2>
            <p className="text-sm text-slate-500 dark:text-slate-300">Stage {currentStage} of {totalStages} — {stages[currentStage - 1]?.label}</p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-bold" style={{ color: BRAND.accent }}>{checklist_progress.percent}%</span>
            <p className="text-xs text-slate-400 dark:text-slate-400">Complete</p>
          </div>
        </div>
        <div className="h-2 bg-slate-100 dark:bg-[#1a2740] rounded-full overflow-hidden mb-6 mt-3">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${checklist_progress.percent}%`, background: `linear-gradient(90deg, ${BRAND.accent}, ${BRAND.primary})` }} />
        </div>
        <div className="flex items-center justify-between px-2 overflow-x-auto">
          {stages.map((stage, i) => {
            const isDone = data.checklist[i]?.completed;
            const isCurrent = stage.num === currentStage;
            const isFuture = !isDone && !isCurrent;
            return (
              <div key={stage.num} className="flex items-center">
                <div className="flex flex-col items-center min-w-[52px]">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all",
                    isFuture && "bg-slate-100 dark:bg-[#1a2740] text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-[#253553]"
                  )}
                    style={isDone ? { background: BRAND.green, color: "white" } : isCurrent ? { background: BRAND.accent, color: "white", boxShadow: `0 0 16px ${BRAND.accent}60` } : {}}
                  >
                    {isDone ? <CheckCircle2 className="w-5 h-5" /> : stage.num}
                  </div>
                  <span className={cn(
                    "mt-2 text-[10px] text-center leading-tight max-w-[60px]",
                    isFuture && "text-slate-400 dark:text-slate-500"
                  )}
                    style={isDone ? { color: BRAND.green } : isCurrent ? { color: BRAND.accent, fontWeight: 700 } : {}}>
                    {stage.label.replace(/^\s*\d+\.\s*/, "")}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <div className={cn("w-6 lg:w-10 h-0.5 mx-0.5 mt-[-20px]")}
                    style={{ background: isDone ? BRAND.green : darkMode_bg() }} />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Full checklist with due dates */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Checklist</h2>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">
            {checklist_progress.completed} of {checklist_progress.total} complete
          </span>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-[#253553]">
          {data.checklist.map((item, i) => {
            const overdue = !item.completed && item.due_date ? new Date(item.due_date) < new Date() : false;
            return (
              <div key={`${item.title}-${i}`} className="flex items-center justify-between gap-4 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0"
                    style={{ color: item.completed ? BRAND.green : "#cbd5e1" }} />
                  <span className={cn("text-sm truncate", item.completed
                    ? "text-slate-500 dark:text-slate-400"
                    : "text-slate-800 dark:text-slate-100 font-medium")}>
                    {item.title}
                  </span>
                </div>
                <span className={cn("text-xs whitespace-nowrap font-semibold",
                  overdue ? "text-red-600 dark:text-red-400" : "text-slate-400 dark:text-slate-400")}>
                  {item.due_date ? `Due ${formatDate(item.due_date)}` : "No due date"}
                </span>
              </div>
            );
          })}
          {data.checklist.length === 0 && (
            <p className="text-sm text-slate-400 py-3">No checklist items yet.</p>
          )}
        </div>
      </Card>

      {/* Project Overview + Notes side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

        <Card className="p-5">
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Project Overview</h3>
          <div className="divide-y divide-slate-100 dark:divide-[#253553]">
            <OverviewRow label="Platform" value={project.platform || "—"} />
            {data.custom_fields.filter(f => f.key === "arr" || f.label.toLowerCase() === "arr").map(f => (
              <OverviewRow key={f.key} label="ARR" value={f.value || "—"} />
            ))}
            <OverviewRow label="Customer Engineer (POC)" value={owner?.name || "—"} />
            <OverviewRow label="Expected Go-Live Date" value={formatDate(project.expected_go_live_date || project.go_live_date)} />
            {data.custom_fields
              .filter(f => {
                const lbl = f.label.toLowerCase();
                return lbl !== "om name" && lbl !== "om" && lbl !== "arr" && f.value;
              })
              .map(f => (
                <OverviewRow key={f.key} label={f.label} value={f.value || "—"} />
              ))
            }
          </div>
        </Card>

        {/* Notes & Updates with timestamps */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Notes & Updates</h3>
            <button onClick={onSaveNote} disabled={!noteText.trim()}
              className="text-xs font-bold text-white px-4 py-1.5 rounded transition-colors disabled:opacity-40"
              style={{ background: BRAND.primary }}>Save</button>
          </div>
          <textarea
            value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note for your SE..."
            className="w-full bg-slate-50 dark:bg-[#1a2740] border border-slate-200 dark:border-[#253553] rounded-lg p-3 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-400 resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-blue-400/30"
          />
          {savedNotes.length > 0 && (
            <div className="mt-4 space-y-2 max-h-[260px] overflow-y-auto">
              {savedNotes.map((note, i) => (
                <NoteRow key={i} note={note} onEdit={(text) => onEditNote(i, text)} onDelete={() => onDeleteNote(i)} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="px-5 py-3 flex items-center gap-3" style={{ borderLeft: `3px solid ${BRAND.accent}` }}>
        <Zap className="w-4 h-4 flex-shrink-0" style={{ color: BRAND.accent }} />
        <p className="text-sm text-slate-500 dark:text-slate-300">
          Your {orgName} SE will advance your stage once milestones are complete. Use <span className="font-bold text-slate-700 dark:text-white">Handover Assist</span> for help.
        </p>
      </Card>
    </div>
  );
}

function darkMode_bg() { return "#253553"; }

function NoteRow({ note, onEdit, onDelete }: { note: MerchantNote; onEdit: (text: string) => void; onDelete: () => void }) {
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
    <div className="bg-slate-50 dark:bg-[#1a2740] border border-slate-100 dark:border-[#253553] rounded-lg px-3 py-2 group">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-white dark:bg-[#0c1220] border border-slate-200 dark:border-[#253553] rounded-md p-2 text-sm text-slate-700 dark:text-slate-200 resize-y min-h-[60px] focus:outline-none focus:ring-2 focus:ring-blue-400/30"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button onClick={save} className="text-[11px] font-bold text-white px-3 py-1 rounded" style={{ background: BRAND.primary }}>Save</button>
            <button onClick={() => { setDraft(note.text); setEditing(false); }} className="text-[11px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white px-2 py-1">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <p className="text-sm text-slate-700 dark:text-slate-200 flex-1 whitespace-pre-wrap break-words">{note.text}</p>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#253553] text-slate-500 dark:text-slate-300" title="Edit">
                <Pencil className="w-3 h-3" />
              </button>
              <button onClick={() => { if (confirm("Delete this note?")) onDelete(); }} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-500/20 text-slate-500 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-300" title="Delete">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-400 mt-1">
            {d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
          </p>
        </>
      )}
    </div>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-slate-500 dark:text-slate-300">{label}</span>
      <span className="text-sm font-semibold text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

/* ===================== CREDENTIALS PAGE ===================== */
function CredentialsPage({ project, credentials }: { project: PortalData["project"]; credentials: PortalData["credentials"] }) {
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");
  const creds = env === "sandbox" ? credentials?.sandbox : credentials?.production;
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Credentials</h1>
        <p className="text-sm text-slate-500 dark:text-slate-300">Keep your App Secret secure. Do not share it publicly.</p>
      </div>

      <div className="flex gap-2">
        {(["sandbox", "production"] as const).map(e => (
          <button key={e} onClick={() => setEnv(e)}
            className={cn("px-5 py-2 rounded-lg text-sm font-semibold transition-all capitalize",
              env === e ? "text-white shadow-md" : "bg-slate-100 dark:bg-[#1a2740] text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#253553]"
            )}
            style={env === e ? { background: BRAND.primary } : {}}
          >{e}</button>
        ))}
      </div>

      <Card className="p-6 space-y-5">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          {env === "sandbox" ? "Sandbox" : "Production"} Credentials
        </h3>
        <CredentialField label="MERCHANT ID (MID)" value={creds?.mid || project.mid || "NA"} />
        <CredentialField label="APP ID" value={creds?.app_id || "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"} masked sensitive={!!creds?.app_id} />
        <CredentialField label="APP SECRET" value={creds?.app_secret || "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"} masked sensitive={!!creds?.app_secret} />
        <CredentialField label="BASE URL"
          value={creds?.base_url || (env === "sandbox" ? "https://sandbox.api.gokwik.co" : "https://api.gokwik.co")} />
        <CredentialField label="CONFIG ID (MERCHANT VALIDATOR)"
          value={project.config_id || credentials?.sandbox?.config_id || credentials?.production?.config_id || "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
          masked sensitive={!!(project.config_id || credentials?.sandbox?.config_id || credentials?.production?.config_id)} />
        <CredentialField label="KWIKPASS JWE KEY"
          value={env === "sandbox" ? (project.kp_sandbox_jwe_key || "zH4NRP1HMALxxCFnRZABFA7GOJtzU_gIj02alfL1lvI") : (creds?.kwikpass_jwe_key || project.kp_prod_jwe_key || "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022")}
          masked sensitive={env === "sandbox" ? true : !!(creds?.kwikpass_jwe_key || project.kp_prod_jwe_key)} />
      </Card>
    </div>
  );
}

function CredentialField({ label, value, masked, sensitive }: { label: string; value: string; masked?: boolean; sensitive?: boolean }) {
  // `masked` = field can be hidden behind dots. `sensitive` = true when value is real (not the placeholder dots).
  // Default: if masked AND sensitive (real value present), hide it; user clicks eye to reveal.
  // If masked but no real value (placeholder), just show the placeholder with no toggle.
  const hasRealValue = sensitive ?? !value.startsWith("\u2022\u2022\u2022");
  const [visible, setVisible] = useState(false);
  const showToggle = masked && hasRealValue;
  const displayVal = showToggle && !visible ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : value;
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1.5">{label}</p>
      <div className="bg-slate-50 dark:bg-[#1a2740] border border-slate-200 dark:border-[#253553] rounded-lg px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-slate-700 dark:text-slate-200 font-mono">{displayVal}</span>
        <div className="flex items-center gap-2">
          {showToggle && (
            <button onClick={() => setVisible(!visible)} className="text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors" title={visible ? "Hide" : "Reveal"}>
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
function DocumentsPage({ data, setActivePage }: { data: PortalData; setActivePage: (p: NavPage) => void }) {
  const docs: { icon: React.ReactNode; title: string; desc: string; badge: string; link?: string | null; onClick?: () => void; badgeColor?: string }[] = [];

  if (data.project.brd_link) {
    docs.push({ icon: <FileText className="w-5 h-5" style={{ color: BRAND.primary }} />, title: "BRD Document", desc: "Business Requirements Document", badge: "Available", link: data.project.brd_link });
  }

  if (data.project.sow_link) {
    docs.push({ icon: <BookOpen className="w-5 h-5" style={{ color: BRAND.primary }} />, title: "SOW / Merchant Playbook", desc: "Statement of Work & Integration Playbook", badge: "Available", link: data.project.sow_link });
  }

  const mandatoryCount = (data.project.mandatory_apis ?? []).length;
  docs.push({
    icon: <FileCode className="w-5 h-5 text-orange-500" />,
    title: "Mandatory APIs & Postman Collection",
    desc: mandatoryCount > 0
      ? `${mandatoryCount} mandatory API${mandatoryCount === 1 ? "" : "s"} marked by your CE — click to view the list & Postman collection`
      : "Handover API Postman workspace and collections — click to view",
    badge: "View List",
    onClick: () => setActivePage("mandatoryApis"),
    badgeColor: "blue",
  });

  if (data.project.enable_mcp_document) {
    docs.push({
      icon: <Code className="w-5 h-5" style={{ color: BRAND.primary }} />,
      title: "MCP Server Setup Guide",
      desc: "Setup guide for connecting Handover MCP Server to Claude Desktop / Code",
      badge: "Setup Guide",
      onClick: () => setActivePage("mcp"),
      badgeColor: "blue",
    });
  }

  if (data.project.enable_kp) {
    docs.push({
      icon: <KeyRound className="w-5 h-5" style={{ color: BRAND.primary }} />,
      title: "KwikPass (KP) — Setup Guide & Documentation",
      desc: "Step-by-step KP integration walkthrough with the official Postman docs link",
      badge: "Setup Guide",
      onClick: () => setActivePage("kwikpass"),
      badgeColor: "blue",
    });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Documents & Resources</h1>
        <p className="text-sm text-slate-500 dark:text-slate-300">Access your integration documents and resources.</p>
      </div>
      <div className="space-y-3">
        {docs.map((doc, i) => {
          const inner = (
            <Card className="p-5 flex items-center gap-4 hover:border-slate-300 dark:hover:border-[#354565] transition-colors cursor-pointer">
              <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-[#1a2740] flex items-center justify-center flex-shrink-0">
                {doc.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white">{doc.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{doc.desc}</p>
              </div>
              <span className={cn(
                "text-[10px] font-bold px-2.5 py-1 rounded",
                doc.badgeColor === "blue" ? "bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300" :
                "bg-green-50 dark:bg-green-500/20 text-green-600 dark:text-green-300"
              )}>{doc.badge}</span>
              <ExternalLink className="w-4 h-4 text-slate-400 dark:text-slate-400" />
            </Card>
          );
          return doc.onClick ? (
            <button key={i} type="button" onClick={doc.onClick} className="block w-full text-left">{inner}</button>
          ) : (
            <a key={i} href={doc.link || "#"} target="_blank" rel="noopener noreferrer" className="block">{inner}</a>
          );
        })}
      </div>

      {docs.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-slate-400 dark:text-slate-400">No documents shared yet</p>
        </Card>
      )}
    </div>
  );
}

/* ===================== KWIKPASS PAGE ===================== */
function KwikPassPage({ project, credentials, onBack }: { project: PortalData["project"]; credentials: PortalData["credentials"]; onBack?: () => void }) {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      title: "1. Add Merchant Info",
      badge: "Must go first",
      badgeColor: "red",
      desc: "Identifies your store to KwikPass. Without it the SDK cannot authenticate your account. Must load on every page before any other KwikPass script.",
      note: "Add to your page — ideally in the <head> or very top of your script.",
      code: `window.merchantInfo = {
  ...window.merchantInfo,
  environment: "sandbox",
  mid: "${project.mid || '<your_merchant_id>'}",
  type: "merchantInfo",
  integrationType: 'CUSTOM_HEADLESS'
}`,
      envChanges: [
        { field: "environment", sandbox: '"sandbox"', production: '"production"' },
        { field: "mid", sandbox: "Sandbox MID (from Credentials tab)", production: "Production MID (from Credentials tab)" },
      ],
      critical: "This MUST appear before Step 2 on every single page of your website.",
    },
    {
      title: "2. Load JavaScript SDK",
      desc: "Downloads the KwikPass SDK. Handles OTP delivery, SSO session detection, KP token generation, and SSO button rendering — all automatically in the background.",
      note: "Add inside the <body> tag:",
      code: `<script>
(function () {
  window.__KP_LOGIN_SDK_INSTANCE__ = window.__KP_LOGIN_SDK_INSTANCE__ || {};
  window.__KP_LOGIN_SDK_INSTANCE__.logEvents =
    window.__KP_LOGIN_SDK_INSTANCE__.logEvents ||
    function(event) {
      window.kpqueue = window.kpqueue || [];
      window.kpqueue.push(event);
    };
  var s = document.createElement('script');
  s.type = 'text/javascript';
  s.defer = true;
  // Sandbox:
  s.src = 'https://sandbox.pdp.gokwik.co/kwikpass/plugin/build/kp-custom-merchant.js';
  // Production: replace sandbox.pdp.gokwik.co with pdp.gokwik.co
  s.onload = function() { console.log("KwikPass SDK loaded!"); };
  var x = document.getElementsByTagName('script')[0];
  x.parentNode.insertBefore(s, x);
})();
</script>`,
      envChanges: [
        { field: "s.src (SDK URL)", sandbox: "sandbox.pdp.gokwik.co/kwikpass/plugin/build/kp-custom-merchant.js", production: "pdp.gokwik.co/kwikpass/plugin/build/kp-custom-merchant.js" },
      ],
    },
    {
      title: "3. Send OTP",
      desc: "When a user enters a valid 10-digit phone number, call kpSendOTP() to trigger a 4-digit OTP via SMS.",
      code: `// Send OTP to user's phone number
const result = await __KP_LOGIN_SDK_INSTANCE__.kpSendOTP(phone);

// Success response:
// { status: 200, body: {}, message: "OTP sent successfully" }

// Failure response:
// { status: 400, message: "OTP expired! Please click on resend OTP" }`,
    },
    {
      title: "4. Verify OTP",
      desc: "After the user enters the OTP, call kpVerifyOTP() to verify and get the authentication token.",
      code: `const result = await __KP_LOGIN_SDK_INSTANCE__.kpVerifyOTP({
  phone: "8755512345",
  otp: 1234
});

// Success: { status: 200, body: { email, token, coreToken, kpToken } }
// kpToken is a signed JWE — decrypt it server-side with your secret key`,
    },
    {
      title: "5. Handle Logout",
      desc: "Call handleKPLogout() on any logout operation to clear the KwikPass session. Without this, sendOTP won't work when user returns.",
      code: `// On user logout — MUST be called
__KP_LOGIN_SDK_INSTANCE__.handleKPLogout();

// Note: Without proper logout handling,
// sendOTP won't work when user returns`,
    },
    {
      title: "6. SSO Button (Optional)",
      desc: "Add the KwikPass SSO container for one-click login for returning users who have shopped at any Handover merchant before.",
      code: `<!-- 6a — Add the SSO container where the button should appear -->
<div
  id="kwikpass-sso-container"
  logo="https://pdp.gokwik.co/kwikpass/assets/icons/kwik_pass_logo.svg">
</div>

<!-- 6b — For late-rendered components (React useEffect): -->
if (window.__KP_LOGIN_SDK_INSTANCE__ &&
    window.__KP_LOGIN_SDK_INSTANCE__.handleKpSSOButton) {
  window.__KP_LOGIN_SDK_INSTANCE__.handleKpSSOButton();
}

<!-- 6c — Listen for SSO login event to get the kpToken: -->
window.addEventListener("kwikpass-sso", function(event) {
  if (event.detail.kpToken) {
    // Decrypt kpToken with your secret key
    // Then log the user into your system
    console.log(event.detail.kpToken);
  } else {
    // SSO not available / session expired
    // Show OTP login flow instead
  }
});`,
      ssoNote: true,
    },
    {
      title: "7. Decrypt KP Token",
      desc: "The kpToken from Step 4 (verifyOTP) and Step 6 (SSO) is a signed JWE. Decrypt it server-side with your secret key to get the user's phone and email.",
      code: `// Node.js — using jose library
const jose = require('jose');
const secret = jose.base64url.decode('${project.kp_sandbox_jwe_key || "zH4NRP1HMALxxCFnRZABFA7GOJtzU_gIj02alfL1lvI"}');
const jwt = ''; // kpToken from verifyOTP or SSO event

const { payload, protectedHeader } = await jose.jwtDecrypt(jwt, secret);
console.log(payload);
// payload contains: { phone, email, ... }`,
      envChanges: [
        { field: "JWE Key", sandbox: "Sandbox JWE Key (from Credentials tab)", production: "Production JWE Key (from Credentials tab)" },
      ],
    },
  ];

  const sandboxJweKey = project.kp_sandbox_jwe_key || "zH4NRP1HMALxxCFnRZABFA7GOJtzU_gIj02alfL1lvI";
  const prodJweKey = project.kp_prod_jwe_key;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {onBack && (
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to Documents
        </button>
      )}
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <KeyRound className="w-6 h-6" style={{ color: BRAND.primary }} />
            KwikPass Integration
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-300 mt-1">
            Follow the steps below, or open the full KP API reference for advanced details. Both stay in sync.
          </p>
        </div>
        <a
          href="https://documenter.getpostman.com/view/50602298/2sBXiomAJs#802a85ed-097f-40ae-a29b-dd05740b5e2c"
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white shadow-sm transition-colors"
          style={{ background: BRAND.primary }}
        >
          <ExternalLink className="w-3.5 h-3.5" /> View Official KP Documentation
        </a>
      </div>

      {/* Overview Card with features */}
      <div className="rounded-xl p-6" style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryLight})` }}>
        <h2 className="text-lg font-bold text-white mb-2">KwikPass Integration Guide</h2>
        <p className="text-sm text-white/80 mb-4">
          KwikPass enables user authentication, SSO, page-view event tracking, and retargeting via KwikChat.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Phone OTP Login", desc: "Users log in via phone number with 4-digit OTP — no email/password", icon: "🔐" },
            { label: "Single Sign-On (SSO)", desc: "Auto-login for users who shopped at any Handover merchant before", icon: "🔑" },
            { label: "PageView Tracking", desc: "Capture Product/Collection IDs for logged-in user retargeting", icon: "📊" },
            { label: "User Cohorts", desc: "Via KwikChat based on captured events — boosts repeat purchase rate", icon: "🎯" },
          ].map((f, i) => (
            <div key={i} className="bg-white/10 rounded-lg p-3 text-center">
              <span className="text-xl">{f.icon}</span>
              <p className="text-xs text-white font-medium mt-1">{f.label}</p>
              <p className="text-[10px] text-white/60 mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* JWE Keys */}
      <Card className="p-5 space-y-4">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Your JWE Decryption Keys</h3>
        <CredentialField label="SANDBOX JWE KEY" value={sandboxJweKey} masked sensitive />
        <CredentialField label="PRODUCTION JWE KEY" value={prodJweKey || "••••••••••••••••"} masked sensitive={!!prodJweKey} />
      </Card>

      {/* Step-by-step Guide */}
      <Card className="p-5">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Integration Steps</h3>
        <div className="flex gap-2 flex-wrap mb-5">
          {steps.map((s, i) => (
            <button key={i} onClick={() => setActiveStep(i)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                activeStep === i
                  ? "text-white shadow-md"
                  : "bg-slate-100 dark:bg-[#1a2740] text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#253553]"
              )}
              style={activeStep === i ? { background: BRAND.primary } : {}}
            >
              Step {i + 1}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h4 className="text-base font-bold text-slate-900 dark:text-white">{steps[activeStep].title}</h4>
            {(steps[activeStep] as any).badge && (
              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded border",
                (steps[activeStep] as any).badgeColor === "red"
                  ? "bg-red-50 dark:bg-red-500/20 text-red-600 dark:text-red-300 border-red-200 dark:border-red-500/30"
                  : "bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-500/30"
              )}>
                {(steps[activeStep] as any).badge}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-300">{steps[activeStep].desc}</p>
          {(steps[activeStep] as any).note && (
            <p className="text-xs text-slate-400 dark:text-slate-400 italic">{(steps[activeStep] as any).note}</p>
          )}
          <div className="relative">
            <pre className="bg-slate-900 dark:bg-[#0c1220] text-green-400 dark:text-green-300 rounded-lg p-4 text-xs overflow-x-auto font-mono leading-relaxed border border-slate-700 dark:border-[#253553]">
              {steps[activeStep].code}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={steps[activeStep].code} />
            </div>
          </div>

          {/* Environment-specific changes table */}
          {(steps[activeStep] as any).envChanges && (
            <div className="mt-3">
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Sandbox vs Production Changes</p>
              <div className="border border-slate-200 dark:border-[#253553] rounded-lg overflow-hidden text-xs">
                <div className="grid grid-cols-3 bg-slate-50 dark:bg-[#1a2740] font-bold">
                  <div className="px-3 py-2 text-slate-600 dark:text-slate-300">Field</div>
                  <div className="px-3 py-2 text-green-600 dark:text-green-400">Sandbox</div>
                  <div className="px-3 py-2 text-amber-600 dark:text-amber-400">Production</div>
                </div>
                {(steps[activeStep] as any).envChanges.map((c: any, j: number) => (
                  <div key={j} className="grid grid-cols-3 border-t border-slate-200 dark:border-[#253553]">
                    <div className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{c.field}</div>
                    <div className="px-3 py-2 text-green-600 dark:text-green-400 font-mono break-all">{c.sandbox}</div>
                    <div className="px-3 py-2 text-amber-600 dark:text-amber-400 font-mono break-all">{c.production}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Critical warning */}
          {(steps[activeStep] as any).critical && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2 mt-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                ⚠ Critical: {(steps[activeStep] as any).critical}
              </p>
            </div>
          )}

          {/* SSO customization note */}
          {(steps[activeStep] as any).ssoNote && (
            <Card className="p-4 mt-2" style={{ borderLeft: `3px solid ${BRAND.accent}` }}>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">SSO Button — What can & cannot be changed</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase mb-1">✅ Can Customise</p>
                  <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                    <li>✓ Button colour</li>
                    <li>✓ Button size & shape</li>
                    <li>✓ Button edges (border-radius)</li>
                    <li>✓ Button text colour</li>
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase mb-1">✕ Cannot Change</p>
                  <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                    <li>✕ Text "Login with 98xxxxxxx34" (fetched dynamically)</li>
                    <li>✕ "Powered by KwikPass" logo (mandatory)</li>
                    <li>✕ Button opacity = 0 or display = none</li>
                    <li>✕ Any visibility modification</li>
                  </ul>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100 dark:border-[#253553]">
          <button
            onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
            disabled={activeStep === 0}
            className="flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-xs text-slate-400">Step {activeStep + 1} of {steps.length}</span>
          <button
            onClick={() => setActiveStep(Math.min(steps.length - 1, activeStep + 1))}
            disabled={activeStep === steps.length - 1}
            className="flex items-center gap-1 text-sm font-medium hover:text-slate-700 dark:hover:text-white disabled:opacity-30 transition-colors"
            style={{ color: BRAND.primary }}
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </Card>

      {/* Do's & Don'ts */}
      <Card className="p-5">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Do's & Don'ts</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-green-600 dark:text-green-400 uppercase">✅ Do's</p>
            {[
              "Load merchantInfo BEFORE the SDK script on every page",
              "Call handleKPLogout() on every logout event",
              "Decrypt kpToken server-side only — never expose JWE key to frontend",
              "Use the Sandbox environment for all testing before going to Production",
              "Handle both SSO and OTP flows — SSO may not be available for all users",
              "Check SDK loaded successfully before calling kpSendOTP",
            ].map((d, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded bg-green-50 dark:bg-green-500/10">
                <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-700 dark:text-slate-200">{d}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-red-600 dark:text-red-400 uppercase">✕ Don'ts</p>
            {[
              "Don't expose JWE secret key in client-side / frontend code",
              "Don't skip handleKPLogout() — sendOTP will break on next login",
              "Don't load SDK before merchantInfo — authentication will fail",
              "Don't mix Sandbox and Production credentials in the same environment",
              "Don't hide or modify SSO button visibility (opacity:0, display:none)",
              "Don't hardcode phone numbers — always use user input",
            ].map((d, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded bg-red-50 dark:bg-red-500/10">
                <X className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-700 dark:text-slate-200">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Production vs Sandbox — all changes */}
      <Card className="p-5">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Production vs Sandbox — Full Change Reference</h3>
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            When moving from Sandbox → Production, update <strong>all</strong> values below. Mixing environments will cause authentication failures.
          </p>
        </div>
        <div className="border border-slate-200 dark:border-[#253553] rounded-lg overflow-hidden text-xs">
          <div className="grid grid-cols-3 bg-slate-50 dark:bg-[#1a2740] font-bold">
            <div className="px-3 py-2.5 text-slate-600 dark:text-slate-300">Configuration</div>
            <div className="px-3 py-2.5 text-green-600 dark:text-green-400">Sandbox</div>
            <div className="px-3 py-2.5 text-amber-600 dark:text-amber-400">Production</div>
          </div>
          {[
            { field: "merchantInfo.environment", sandbox: '"sandbox"', production: '"production"' },
            { field: "merchantInfo.mid", sandbox: "Sandbox MID", production: "Production MID" },
            { field: "SDK URL (s.src)", sandbox: "sandbox.pdp.gokwik.co/…", production: "pdp.gokwik.co/…" },
            { field: "JWE Decryption Key", sandbox: sandboxJweKey.substring(0, 20) + "…", production: "Production Key (from Credentials)" },
            { field: "Base URL (APIs)", sandbox: "sandbox.api.gokwik.co", production: "api.gokwik.co" },
          ].map((row, i) => (
            <div key={i} className="grid grid-cols-3 border-t border-slate-200 dark:border-[#253553]">
              <div className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{row.field}</div>
              <div className="px-3 py-2 text-green-600 dark:text-green-400 font-mono break-all">{row.sandbox}</div>
              <div className="px-3 py-2 text-amber-600 dark:text-amber-400 font-mono break-all">{row.production}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Testing Guide */}
      <Card className="p-5">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Testing Guide</h3>
        <div className="space-y-3">
          {[
            { title: "Test OTP Flow", desc: "Go to profile/account section → Enter mobile number → Receive Handover OTP → Verify OTP → You're logged in!", icon: "📱" },
            { title: "Test SSO Flow", desc: "Login to Handover test environment → Visit your store → SSO button appears with masked number → Click to login", icon: "⚡" },
            { title: "Test Token Decryption", desc: "Use the JWE secret key to decrypt kpToken → Verify phone number and email in payload", icon: "🔑" },
            { title: "Test Logout", desc: "Logout → Verify handleKPLogout() clears session → Login again via OTP to confirm flow resets", icon: "🔄" },
          ].map((t, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-[#1a2740]">
              <span className="text-lg">{t.icon}</span>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-white">{t.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ===================== PAYMENT SIMULATOR PAGE ===================== */
function PaymentSimulatorPage({ link }: { link: string }) {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Payment Simulator</h1>
        <p className="text-sm text-slate-500 dark:text-slate-300">Run end-to-end test transactions on a sandbox payment flow.</p>
      </div>

      <div className="rounded-xl p-6" style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryLight})` }}>
        <div className="flex items-center gap-3 mb-1">
          <Zap className="w-5 h-5 text-white" />
          <h2 className="text-lg font-bold text-white">Sandbox Payment Simulator</h2>
        </div>
        <p className="text-sm text-white/70">Validate your checkout integration with simulated success, failure and pending scenarios — no real charges are made.</p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: BRAND.primarySoft }}>
            <Zap className="w-5 h-5" style={{ color: BRAND.primary }} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">About the Simulator</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
              The Payment Simulator lets you trigger end-to-end sandbox payment flows tied to your merchant configuration. Use it to verify webhooks, order status updates and the full checkout experience before going live.
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
  const defaultFaqs: { q: string; a: string }[] = [
    { q: "What is a BRD and why is a sign-off required?", a: "The Business Requirement Document (BRD) outlines all essential business requirements for the Kwik Checkout integration. Sign-off is crucial to ensure alignment between Handover and the merchant on expectations and deliverables before commencing integration." },
    { q: "Why is pre-Handover data and GA access required?", a: "Pre-Handover data is essential for benchmarking value delivery (VD) metrics, while Google Analytics (GA) access enables progress tracking from Day 0." },
    { q: "What integrations must be completed on the merchant's end alongside Handover integration?", a: "The merchant must integrate the Handover SDK, Update Order API (including automatic refund handling), and mandatory frontend events critical to the functionality of Kwik Checkout." },
    { q: "What parameters must be passed in the Handover SDK to invoke Kwik Checkout?", a: "• merchant_id: Provided by Handover for sandbox and production environments\n• phone_number: For logged-in user flow (optional for guest users)\n• merchant_checkout_id: Cart ID of the current transaction\n• customer_token: Access/Bearer token for registered users (optional)\n• utm_params: For lead source-level analysis (optional)" },
    { q: "Why is it necessary to share UAT test cases with Handover?", a: "Sharing test cases ensures comprehensive validation of user flows and merchant-specific scenarios prior to sandbox readiness." },
    { q: "What is the recommended method for conducting production testing without going live?", a: "Switching from sandbox MID/API URL to production MID/API URL while pointing the sandbox store to Handover's production environment." },
    { q: "How can a manual refund be initiated?", a: "Manual refunds can be initiated through the Merchant Dashboard with admin-level access." },
    { q: "What distinguishes Sandbox UAT from Production UAT?", a: "Sandbox UAT involves full integration testing across all flows. Production UAT primarily verifies payment method functionality, dashboard data reflection, and refund/return workflows." },
    { q: "What is the acceptable API response time for merchants?", a: "Response time under 250ms is considered acceptable; exceeding this indicates suboptimal performance." },
    { q: "Why does the error \"Merchant Data Not Found\" occur?", a: "This error typically results from misconfigured credentials, such as an incorrect MID or API URL on either Handover or merchant side." },
    { q: "What are the mandatory frontend events for Go Live?", a: "• order-complete: Redirect from Handover's \"Congratulations\" page to Merchant's \"Thank You\" page\n• checkout-close: Return to source if checkout is closed\n• checkout-initiation-failure: Fallback to native checkout if the Handover Checkout fails to load." },
    { q: "How is wallet functionality handled on Kwik Checkout?", a: "Wallet functionality is supported via merchant-provided APIs for wallet balance, apply, and remove actions. Details are available in the integration document." },
    { q: "How is \"Out of Stock\" condition managed during checkout?", a: "The handling mechanism must be implemented using merchant APIs and event triggers; refer to Handover's documentation for integration steps." },
    { q: "Can an order be created before payment and updated post confirmation?", a: "Yes, merchants can create an order on initiation and update it post successful payment. Handover supports retries and provides webhook support for transaction failures." },
    { q: "Can Handover SDK be integrated in a local environment?", a: "No, Kwik Checkout must be deployed on a server; local integration is not supported." },
    { q: "What causes the error \"Cart is Inactive\" during multiple tab access?", a: "This error arises from parallel checkout attempts. Use the \"checkout-close\" event to gracefully handle this scenario." },
    { q: "Why can't merchants place orders using card/net banking on sandbox?", a: "Only Freecharge is enabled for prepaid simulation in the sandbox. Full payment gateway options are available in the production environment." },
    { q: "What payment methods are available in the Handover sandbox?", a: "Cash on Delivery and Wallet-Freecharge (simulation only for prepaid flow)." },
    { q: "Why do card transactions below INR 5 fail on a sandbox?", a: "Most banks reject low-value transactions. Use a cart value above INR 5 to test successfully." },
    { q: "Can customers edit wallet amounts on checkout?", a: "Currently, wallet amounts cannot be manually edited by customers." },
    { q: "Why does the cart page refresh when the Handover popup is triggered?", a: "The cart page refreshes to fetch updated details from all active carts." },
    { q: "What payment methods are supported by Handover?", a: "• Cash On Delivery\n• UPI (e.g., Google Pay, PhonePe)\n• Credit/Debit Cards\n• Net Banking\n• Wallets (e.g., Amazon Pay, Airtel Money)\n• NCEMI" },
    { q: "Do we offer no cost EMI? How does it work?", a: "Yes we offer no cost EMI. We allow creation of payment offers on EMI which allows merchants to offer instant discounts equivalent to interest charged by the bank, thereby making the effective interest 0.\n\nFor example, if the cart value is 100 and interest charged is 10 then an upfront discount of 10 is given to cover the interest charged. The bank would continue to charge the interest on each EMI but interest + principal would be equal to the cart value.\n\nNote: Any additional charges like EMI processing fee/GST are not covered by this discount. For more details reach out to your Program Manager/Customer Success Manager." },
    { q: "Does the address list show duplicates?", a: "Yes, if duplicate checks aren't implemented by the merchant. Use a unique `address_id` to avoid this." },
    { q: "Does the checkout show only the shipping address?", a: "Yes, only the shipping address is shown during checkout." },
    { q: "Can users change countries in the shipping address?", a: "No, Handover currently supports only domestic checkouts within India." },
    { q: "Can customers select existing shipping addresses during checkout?", a: "Yes, users can switch between existing addresses or add new ones." },
    { q: "Is the 'Deliver To' option visible on the payment page?", a: "It depends on the chosen flow:\n• Regular Flow: Address verification before payment (no 'Deliver To' option)\n• Click to Payment Flow: 'Deliver To' shown on payment page for verification" },
    { q: "Does Handover send refund webhook responses?", a: "Yes, for successful, failed, and initiated refunds, upon merchant request." },
    { q: "Does Handover send webhook responses for transactions?", a: "Yes, for both successful and failed transactions, on merchant request." },
    { q: "What validations are in place for addresses?", a: "• Gibberish content is flagged\n• First names are mandatory; last names default to '.' if absent\n• Minimum 12 characters required\n• Warnings issued for poor input before proceeding\n• Mandatory fields are enforced\n• Email id is mandatory\n• Language should be English" },
    { q: "Are house number and area fields mandatory in addresses?", a: "Yes, to prevent invalid or insufficient address entries that could lead to high RTO rates." },
    { q: "Are UPI options visible on the Instagram browser?", a: "Yes, UPI methods are accessible even via Instagram in-app browsers." },
    { q: "When does Truecaller trigger during checkout?", a: "If Truecaller is active, it will auto-fill the mobile number during checkout." },
    { q: "What is the role of the 'Order Complete' event?", a: "It redirects users to the Thank You page after successful payment completion." },
    { q: "Can Handover access addresses tied to merchant platform login numbers?", a: "No, address visibility is limited to the number used for Handover login." },
    { q: "What is the field that merchants can use for the authentication of the Payment details?", a: "The \"hmac\" field is the one you can use for the authentication of the payment details. Please find the code for decrypting the hmac and verifying:\n\nexport const generateHMACForTransactionWebhook = (payload: IComputeTransactionWebhookHMACPayload): string => {\n  const hashPayload = `${payload.merchantReferenceId}|${payload.paymentId}|${payload.amount}`;\n  const hashGen = createHash('sha512');\n  return hashGen.update(hashPayload).digest('hex');\n};" },
  ];
  const managed = managedFaqs
    .filter(f => f.question.trim() && f.answer.trim())
    .map(f => ({ q: f.question, a: f.answer }));
  const faqs = [...managed, ...defaultFaqs];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">FAQ & Help</h1>
        <p className="text-sm text-slate-500 dark:text-slate-300">Common questions about Handover API integration.</p>
      </div>
      <div className="space-y-2">
        {faqs.map((faq, i) => (
          <Card key={i} className="overflow-hidden">
            <button
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-[#1a2740] transition-colors"
            >
              <span className="text-sm text-slate-700 dark:text-slate-200">{faq.q}</span>
              <ChevronRight className={cn("w-4 h-4 text-slate-400 dark:text-slate-400 transition-transform", openIdx === i && "rotate-90")} />
            </button>
            {openIdx === i && (
              <div className="px-5 pb-4">
                <p className="text-sm text-slate-500 dark:text-slate-300 whitespace-pre-line">{faq.a}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ===================== MCP SERVER PAGE ===================== */
function MCPPage({ project, credentials, onBack }: { project: PortalData["project"]; credentials: PortalData["credentials"]; onBack?: () => void }) {
  const [activeStep, setActiveStep] = useState(0);
  // X-API-KEY uses the same mapped field as the Validator's Config ID
  const apiKey =
    (project as any).config_id ||
    (project as any).mcp_config_id ||
    (credentials as any)?.sandbox?.config_id ||
    (credentials as any)?.production?.config_id ||
    "<USER_API_KEY>";
  const serverUrl = "https://api-gw-v4.dev.gokwik.io/sandbox/v1/checkout-mcp/mcp";

  const steps = [
    {
      title: "1. Get your API Key",
      desc: "You'll need an X-API-Key to authenticate with the Handover MCP server. Find it in the Credentials tab — App Secret value.",
      code: `# Your X-API-Key (from Credentials tab):
${apiKey}

# Server URL:
${serverUrl}

# Auth header format (no space after colon):
X-API-Key:${apiKey}`,
      critical: "Never commit your API key to version control. Treat it like a password.",
    },
    {
      title: "2. Detect your environment",
      desc: "Run diagnostic commands to identify your OS, Node.js version, and existing Claude config files.",
      note: "Run these one at a time — do not skip any.",
      code: `# Check OS
uname -s

# Locate Claude configs
CLAUDE_CODE_CONFIG="$HOME/.claude.json"
for path in "$HOME/Library/Application Support/Claude/claude_desktop_config.json" \\
    "$APPDATA/Claude/claude_desktop_config.json" \\
    "$HOME/.config/Claude/claude_desktop_config.json"; do
  [ -f "$path" ] && echo "DESKTOP: $path" && break
done
[ -f "$CLAUDE_CODE_CONFIG" ] && echo "CODE: $CLAUDE_CODE_CONFIG"

# Find Node.js installations
which node && node -v
which npm && npm -v
ls -d "$HOME/.nvm/versions/node"/v*/bin/node 2>/dev/null

# Check mcp-remote
npm list -g mcp-remote 2>/dev/null || echo "mcp-remote NOT installed"`,
    },
    {
      title: "3. Install mcp-remote",
      desc: "Install the mcp-remote bridge globally using Node >= 18. This is required because the server uses API key auth (native HTTP transport forces OAuth).",
      code: `# Use the FULL path to npm under Node >= 18
/full/path/to/npm install -g mcp-remote

# If npm fails (cross-contaminated nvm versions), use:
/full/path/to/node /full/path/to/lib/node_modules/npm/bin/npm-cli.js install -g mcp-remote

# Verify entry point exists
ls -la $(npm root -g)/mcp-remote/dist/proxy.js`,
      critical: "Node.js >= 18 is required. Earlier versions will fail with 'node:fs/promises does not provide constants'.",
    },
    {
      title: "4. Write the MCP config",
      desc: "Add the gokwik-custom-mcp-server entry to your Claude config. Update BOTH Claude Code and Claude Desktop if both exist.",
      note: "Replace /full/path/to/ with actual paths from Step 2. Always back up the config first: cp config.json config.json.backup",
      code: `{
  "mcpServers": {
    "gokwik-custom-mcp-server": {
      "command": "/full/path/to/node",
      "args": [
        "/full/path/to/mcp-remote/dist/proxy.js",
        "${serverUrl}",
        "--header",
        "X-API-Key:${apiKey}"
      ],
      "env": {
        "PATH": "/full/path/to/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
      }
    }
  }
}`,
      envChanges: [
        { field: "Config location", sandbox: "~/.claude.json (Claude Code) — root-level mcpServers", production: "Claude Desktop config (per-OS path)" },
        { field: "URL suffix", sandbox: "Must end with /mcp", production: "Must end with /mcp" },
        { field: "Header format", sandbox: "X-API-Key:<value> (no space)", production: "X-API-Key:<value> (no space)" },
      ],
      critical: "NEVER use bare 'npx' as the command — always the full path to node. ALWAYS set env.PATH so the correct Node comes first.",
    },
    {
      title: "5. Verify the setup",
      desc: "Validate JSON syntax, confirm the binary paths, and test server connectivity.",
      code: `# Validate JSON
python3 -m json.tool "$HOME/.claude.json" > /dev/null && echo "JSON valid"

# Verify Node binary
/full/path/to/node -v   # must be >= 18

# Verify mcp-remote
ls -la /full/path/to/mcp-remote/dist/proxy.js
/full/path/to/node /full/path/to/mcp-remote/dist/proxy.js --help

# Test server connectivity
curl -s -o /dev/null -w "HTTP %{http_code}" -X POST \\
  "${serverUrl}" \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'`,
    },
    {
      title: "6. Restart & test",
      desc: "After writing the config, restart your Claude client. The gokwik-custom-mcp-server tools will become available.",
      code: `# Claude Desktop:
# - Fully Quit (Cmd+Q on Mac) and reopen
# - The server tools appear in your conversation

# Claude Code:
# - Start a new session
# - Run /mcp to verify the server is connected`,
    },
  ];

  const troubleshooting = [
    { error: "MCP error -32001: Invalid API key", fix: "Get correct key from Credentials tab — copy the App Secret value." },
    { error: "node:fs/promises does not provide export 'constants'", fix: "mcp-remote running under Node < 18. Use full path to Node >= 18, set env.PATH." },
    { error: "npm is known not to run on Node.js v14", fix: "Don't use npx. Use node + proxy.js directly with full paths." },
    { error: "HTTP 404: Route Not Found", fix: "URL must end with /mcp — not /checkout-mcp." },
    { error: "HTTP 404: Invalid OAuth error", fix: "Native HTTP transport tried OAuth. Use the mcp-remote bridge instead of \"type\": \"http\"." },
    { error: "Auth: not authenticated in /mcp", fix: "Switch to mcp-remote stdio bridge — native HTTP transport forces OAuth." },
    { error: "Server doesn't appear after config", fix: "Restart Claude Desktop or start a new Claude Code session." },
    { error: "Server under projects.* in claude.json", fix: "Move to root-level mcpServers for global access." },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {onBack && (
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to Documents
        </button>
      )}
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Code className="w-6 h-6" style={{ color: BRAND.primary }} />
            MCP Server Setup
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-300 mt-1">
            Hand the steps below to your AI assistant — it will set up the MCP server end-to-end. Or download the full prompt.
          </p>
        </div>
        <a
          href="/Handover_MCP_Setup_Prompt.docx"
          download
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white shadow-sm transition-colors"
          style={{ background: BRAND.primary }}
        >
          <Download className="w-3.5 h-3.5" /> Download MCP Doc
        </a>
      </div>

      {/* API Key */}
      <Card className="p-5 space-y-3">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Your API Key</h3>
        <CredentialField label="X-API-KEY" value={apiKey} masked sensitive={apiKey !== "<USER_API_KEY>"} />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Same value as the Validator's <span className="font-semibold">Config ID</span>. If empty, request it from your Handover onboarding manager.
        </p>
      </Card>

      {/* Steps */}
      <Card className="p-5">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Setup Steps</h3>
        <div className="flex gap-2 flex-wrap mb-5">
          {steps.map((s, i) => (
            <button key={i} onClick={() => setActiveStep(i)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                activeStep === i
                  ? "text-white shadow-md"
                  : "bg-slate-100 dark:bg-[#1a2740] text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#253553]"
              )}
              style={activeStep === i ? { background: BRAND.primary } : {}}
            >
              Step {i + 1}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <h4 className="text-base font-bold text-slate-900 dark:text-white">{steps[activeStep].title}</h4>
          <p className="text-sm text-slate-500 dark:text-slate-300">{steps[activeStep].desc}</p>
          {(steps[activeStep] as any).note && (
            <p className="text-xs text-slate-400 dark:text-slate-400 italic">{(steps[activeStep] as any).note}</p>
          )}
          <div className="relative">
            <pre className="bg-slate-900 dark:bg-[#0c1220] text-green-400 dark:text-green-300 rounded-lg p-4 text-xs overflow-x-auto font-mono leading-relaxed border border-slate-700 dark:border-[#253553]">
              {steps[activeStep].code}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={steps[activeStep].code} />
            </div>
          </div>

          {(steps[activeStep] as any).envChanges && (
            <div className="mt-3">
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Environment-Specific Configuration</p>
              <div className="border border-slate-200 dark:border-[#253553] rounded-lg overflow-hidden text-xs">
                <div className="grid grid-cols-3 bg-slate-50 dark:bg-[#1a2740] font-bold">
                  <div className="px-3 py-2 text-slate-600 dark:text-slate-300">Field</div>
                  <div className="px-3 py-2 text-green-600 dark:text-green-400">Sandbox / Code</div>
                  <div className="px-3 py-2 text-amber-600 dark:text-amber-400">Production / Desktop</div>
                </div>
                {(steps[activeStep] as any).envChanges.map((c: any, j: number) => (
                  <div key={j} className="grid grid-cols-3 border-t border-slate-200 dark:border-[#253553]">
                    <div className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{c.field}</div>
                    <div className="px-3 py-2 text-green-600 dark:text-green-400 font-mono break-all">{c.sandbox}</div>
                    <div className="px-3 py-2 text-amber-600 dark:text-amber-400 font-mono break-all">{c.production}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(steps[activeStep] as any).critical && (
            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2 mt-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                ⚠ Critical: {(steps[activeStep] as any).critical}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100 dark:border-[#253553]">
          <button onClick={() => setActiveStep(Math.max(0, activeStep - 1))} disabled={activeStep === 0}
            className="flex items-center gap-1 text-sm font-medium text-slate-500 dark:text-slate-300 hover:text-slate-700 dark:hover:text-white disabled:opacity-30 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-xs text-slate-400">Step {activeStep + 1} of {steps.length}</span>
          <button onClick={() => setActiveStep(Math.min(steps.length - 1, activeStep + 1))} disabled={activeStep === steps.length - 1}
            className="flex items-center gap-1 text-sm font-medium hover:text-slate-700 dark:hover:text-white disabled:opacity-30 transition-colors"
            style={{ color: BRAND.primary }}>
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </Card>

      {/* Do's & Don'ts */}
      <Card className="p-5">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Do's & Don'ts</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold text-green-600 dark:text-green-400 uppercase">✅ Do's</p>
            {[
              "Use full path to node binary (>= v18) — never bare npx",
              "Set env.PATH so the correct Node comes first",
              "Back up each config before writing (cp config.json config.json.backup)",
              "Add the entry under root-level mcpServers in ~/.claude.json",
              "Ensure URL ends with /mcp",
              "Use header format X-API-Key:<value> (no space after colon)",
            ].map((d, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded bg-green-50 dark:bg-green-500/10">
                <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-slate-700 dark:text-slate-200">{d}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-red-600 dark:text-red-400 uppercase">❌ Don'ts</p>
            {[
              "Don't use bare npx — it can resolve to the wrong Node",
              "Don't overwrite existing mcpServers entries — merge only",
              "Don't add the entry under projects.* — must be root level",
              "Don't commit the API key to version control",
              "Don't omit the /mcp suffix from the URL (returns 404)",
              "Don't skip restarting Claude after writing the config",
            ].map((d, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded bg-red-50 dark:bg-red-500/10">
                <X className="w-3.5 h-3.5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-slate-700 dark:text-slate-200">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Troubleshooting */}
      <Card className="p-5">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Troubleshooting</h3>
        <div className="border border-slate-200 dark:border-[#253553] rounded-lg overflow-hidden text-xs">
          <div className="grid grid-cols-2 bg-slate-50 dark:bg-[#1a2740] font-bold">
            <div className="px-3 py-2 text-slate-600 dark:text-slate-300">Error</div>
            <div className="px-3 py-2 text-slate-600 dark:text-slate-300">Fix</div>
          </div>
          {troubleshooting.map((t, i) => (
            <div key={i} className="grid grid-cols-2 border-t border-slate-200 dark:border-[#253553]">
              <div className="px-3 py-2 font-mono text-red-600 dark:text-red-400 break-all">{t.error}</div>
              <div className="px-3 py-2 text-slate-700 dark:text-slate-200">{t.fix}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ===================== MANDATORY APIS PAGE ===================== */
const MANDATORY_API_DOC_LINKS: Record<string, string> = {
  "Get Cart": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#ce6c02b2-57bc-4f71-86b9-6967a2dcd0cf",
  "Set Shipping Address": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#3e16f54e-cf77-4fd5-ac46-8058e10a1965",
  "Set Shipping Option": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#10f41fa4-e17f-4009-94ad-773e3e5d0575",
  "Get Available Coupon": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#b2419dfa-27e8-4ac7-b6c8-1e53a7922a1b",
  "Apply Discount": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#5769ba9e-f594-4352-916c-c3c01e8c5463",
  "Remove Discount": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#39df3e59-8304-49ba-9ab9-e03472b4982a",
  "Create Order": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#a1d00cfa-265e-43c3-9bac-4d3aca2e21dc",
  "Place Order": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#1cca8fbf-b36d-4aed-a121-08a1c46bd91a",
  "Update Order": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#2eb04ba6-291b-4603-90ea-f58712acce2a",
  "Split Order": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#5f27d842-a665-4867-a653-89377c221c45",
  "Get Merchant User": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#f4299835-b476-4528-83ae-632e311460a1",
  "Apply Wallet Credit": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#8a701213-8715-4f8f-891f-6ad3878d0b9a",
  "Remove Wallet Credit": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#f589f863-42f2-4be5-a35f-7e428fa03678",
  "Get Available Membership Item": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#5a208267-7d29-469e-bf77-a14850a58726",
  "Add Membership": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#602697ea-a5a6-44b6-88cb-bddf22c4b623",
  "Remove Membership": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#16ba6240-78fc-42ad-9189-218c7e2f70a4",
  "Remove Out of Stock Products": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#9a44aa3f-9765-4417-9259-626431712d46",
  "Check Order Status": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#3adc769c-b933-4fe8-8fb2-3360c72eecc1",
  "Get Redirection URL": "https://documenter.getpostman.com/view/50602298/2sBXiomAJs#977ab78c-a343-4584-a9d2-16af5b3a47fc",
  "Sync Product": "https://documenter.getpostman.com/view/53067515/2sBXqQFxdo#a6ca9856-bcd6-4153-82a9-840de2ccb557",
  "Sync Collection": "https://documenter.getpostman.com/view/53067515/2sBXqQFxdo#0b4716a8-09b2-495d-afe4-fc701e5370be",
};

function MandatoryApisPage({ project, onBack }: { project: PortalData["project"]; onBack: () => void }) {
  const apis = project.mandatory_apis ?? [];
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
        <ChevronLeft className="w-4 h-4" /> Back to Documents
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileCode className="w-6 h-6 text-orange-500" />
            Mandatory APIs & Postman Collection
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-300 mt-1">
            {apis.length > 0
              ? `${apis.length} API${apis.length === 1 ? "" : "s"} marked mandatory by your CE for integration.`
              : "Your CE has not marked any APIs as mandatory yet — refer to the Postman collection below."}
          </p>
        </div>
        <a
          href={POSTMAN_COLLECTION_URL}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white shadow-sm transition-colors"
          style={{ background: BRAND.primary }}
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open Postman Collection
        </a>
      </div>

      {apis.length > 0 && (
        <Card className="p-5">
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-4">Mandatory API List</h3>
          <ol className="space-y-2">
            {apis.map((api, i) => {
              const href = MANDATORY_API_DOC_LINKS[api] || POSTMAN_COLLECTION_URL;
              return (
                <li key={api}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 p-3 rounded-lg bg-slate-50 dark:bg-[#1a2740] border border-slate-200 dark:border-[#253553] hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-[#1f2b48] transition-colors"
                  >
                    <div
                      className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: BRAND.primary }}
                    >
                      {i + 1}
                    </div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white flex-1">{api}</p>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                  </a>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}

/* ===================== SIDE EXPLAINER PANEL ===================== */
function IntroOnePagerModal({ merchantName, onClose }: { merchantName: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-white dark:bg-[#141e30] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-[#253553]">
        <div className="px-7 py-6 border-b border-slate-100 dark:border-[#253553] flex items-start justify-between gap-4" style={{ background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.primaryLight})` }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-5 h-5 text-white" fill="white" />
              <h2 className="text-xl font-bold text-white">Welcome to Handover Assist</h2>
            </div>
            <p className="text-sm text-white/80">Hi <strong>{merchantName}</strong> — here's how this portal helps you go live faster.</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-7 py-6 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">🎯 What problem does this solve?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Merchant integrations often stall because credentials, documents, status updates, and validations live across emails, Jira, Slack, and spreadsheets. <strong>Handover Assist consolidates everything you need to go live into one secure workspace</strong> — eliminating back-and-forth and accelerating time-to-launch.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">⚡ How are we solving it?</h3>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <li className="flex gap-2"><span className="text-blue-500">1.</span><span><strong>Single source of truth</strong> — Live integration status, owner, and next steps, always in sync with your Handover CE.</span></li>
              <li className="flex gap-2"><span className="text-blue-500">2.</span><span><strong>Secure credentials vault</strong> — Sandbox & production keys hidden by default, with copy + reveal controls.</span></li>
              <li className="flex gap-2"><span className="text-blue-500">3.</span><span><strong>Self-service validation</strong> — Run the Merchant Validator and Payment Simulator without waiting on CE bandwidth.</span></li>
              <li className="flex gap-2"><span className="text-blue-500">4.</span><span><strong>Documents on demand</strong> — BRD, SOW, mandatory APIs, KwikPass & MCP guides, all linked from one place.</span></li>
              <li className="flex gap-2"><span className="text-blue-500">5.</span><span><strong>AI assistant</strong> — Ask anything about your integration; trained on your project's context.</span></li>
            </ul>
          </div>
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              💡 <strong>Tip:</strong> Use the side panel on the right of each page for quick guidance. Ping your CE through the in-app chat if you get stuck.
            </p>
          </div>
        </div>
        <div className="px-7 py-4 border-t border-slate-100 dark:border-[#253553] flex justify-end">
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: BRAND.primary }}>
            Get Started →
          </button>
        </div>
      </div>
    </div>
  );
}
