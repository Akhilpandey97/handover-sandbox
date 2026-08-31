import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FlaskConical, Send, Upload, Download, CheckCircle2, XCircle,
  SkipForward, Loader2, Bot, User, AlertTriangle, FileSpreadsheet,
  Globe, Smartphone, Layers, RotateCcw, ChevronRight, Key,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { invokeApi } from "@/lib/api-invoke";

declare const XLSX: any;

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "assistant" | "user";
type ResultStatus = "pass" | "fail" | "skip" | "running";

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  timestamp: Date;
}

interface SandboxConfig {
  websiteUrl: string;
  otpIdentifier: string;
  otpMethod: string;
  merchantId: string;
  environment: string;
  additionalContext: string;
}

interface ChecklistRow {
  id: number;
  testCase: string;
  category: string;
  steps: string;
  expectedResult: string;
  status: ResultStatus | "pending";
  notes: string;
  raw: Record<string, string>;
}

// ─── Onboarding steps (no API key needed — uses Lovable AI) ──────────────────

const STEPS = [
  { key: "websiteUrl",        question: "What is the **website/staging URL** you'd like to test GoKwik checkout on?", icon: <Globe className="h-4 w-4" />, placeholder: "https://staging.yourstore.com" },
  { key: "otpIdentifier",     question: "What **phone number or email** should be used for OTP login inside the GoKwik widget?", icon: <Smartphone className="h-4 w-4" />, placeholder: "+91 9999999999" },
  { key: "otpMethod",         question: "How is the OTP delivered? (SMS / Email / WhatsApp / Authenticator)", icon: <Smartphone className="h-4 w-4" />, placeholder: "SMS", options: ["SMS", "Email", "WhatsApp", "Authenticator"] },
  { key: "merchantId",        question: "Enter your **GoKwik Merchant ID or API Key** (leave blank if not accessible).", icon: <Key className="h-4 w-4" />, placeholder: "gk_mid_xxxxx or leave blank" },
  { key: "environment",       question: "Which environment are you testing? (staging / sandbox / UAT)", icon: <Layers className="h-4 w-4" />, placeholder: "sandbox", options: ["staging", "sandbox", "UAT"] },
  { key: "checklist",         question: "Upload your test checklist (.xlsx / .xls). Each row should have columns: **Test Case**, **Category**, **Steps**, **Expected Result**.", icon: <FileSpreadsheet className="h-4 w-4" />, isFile: true },
  { key: "additionalContext", question: "Any **additional context** to share with the testing agent? (optional — press Enter to skip)", icon: <Bot className="h-4 w-4" />, placeholder: "e.g. COD is disabled, only Razorpay active…" },
];

// ─── Default test suite ─────────────────────────────────────────────────────

const DEFAULT_TESTS: Omit<ChecklistRow, "status" | "notes">[] = [
  { id: 1, testCase: "Page Load & SDK Init", category: "Core", steps: "Navigate to checkout URL", expectedResult: "GoKwik widget loads within 3s, no console errors", raw: {} },
  { id: 2, testCase: "OTP Login", category: "Auth", steps: "Enter phone/email, receive OTP, submit", expectedResult: "User logged into GoKwik widget, address pre-filled", raw: {} },
  { id: 3, testCase: "Saved Address Auto-fill", category: "Address", steps: "Login as returning user", expectedResult: "Saved address appears, correct pincode & city", raw: {} },
  { id: 4, testCase: "COD Payment Option", category: "Payments", steps: "Proceed to payment step", expectedResult: "COD option visible and selectable", raw: {} },
  { id: 5, testCase: "Prepaid Payment Option", category: "Payments", steps: "Select prepaid, choose gateway", expectedResult: "Razorpay/CCAvenue/PayU redirect works", raw: {} },
  { id: 6, testCase: "Coupon Application", category: "Discounts", steps: "Apply valid coupon code", expectedResult: "Discount reflected in order summary", raw: {} },
  { id: 7, testCase: "Invalid Coupon Handling", category: "Discounts", steps: "Apply expired/invalid coupon", expectedResult: "Error message shown, total unchanged", raw: {} },
  { id: 8, testCase: "Order Summary Accuracy", category: "Order", steps: "Review items, qty, tax", expectedResult: "Price matches cart, GST calculated correctly", raw: {} },
  { id: 9, testCase: "Payment Gateway Redirect", category: "Payments", steps: "Complete payment in gateway", expectedResult: "Return URL called, order confirmed", raw: {} },
  { id: 10, testCase: "Order Confirmation", category: "Order", steps: "After successful payment", expectedResult: "Order ID shown, confirmation email/SMS triggered", raw: {} },
  { id: 11, testCase: "Mobile Responsiveness", category: "UX", steps: "Open checkout on 375px viewport", expectedResult: "Widget renders correctly, no overflow", raw: {} },
  { id: 12, testCase: "RTO Intelligence Flags", category: "Intelligence", steps: "Use high-RTO address/profile", expectedResult: "RTO flag shown or COD restricted appropriately", raw: {} },
];

// ─── Edge function call ──────────────────────────────────────────────────────

async function runTestWithAI(config: SandboxConfig, test: ChecklistRow): Promise<{ status: ResultStatus; notes: string; recommendation: string }> {
  const { data, error } = await invokeApi("sandbox-test", {
    body: { config, test },
  });

  if (error) throw new Error(error.message || "Edge function error");
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

function parseExcel(file: File): Promise<ChecklistRow[]> {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === "undefined") {
      reject(new Error("Excel library not loaded. Please refresh and try again."));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        const items: ChecklistRow[] = rows.map((row, i) => {
          const keys = Object.keys(row).map(k => k.toLowerCase());
          const get = (variants: string[]) => {
            for (const v of variants) {
              const k = keys.find(k => k.includes(v));
              if (k) return String((row as any)[Object.keys(row)[keys.indexOf(k)]] || "");
            }
            return "";
          };
          return {
            id: i + 1,
            testCase: get(["test case", "test name", "title", "name"]) || `Test ${i + 1}`,
            category: get(["category", "type", "area"]) || "General",
            steps: get(["steps", "action", "procedure"]),
            expectedResult: get(["expected", "result", "outcome"]),
            status: "pending",
            notes: "",
            raw: row,
          };
        });
        resolve(items);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function exportResults(items: ChecklistRow[], config: SandboxConfig) {
  if (typeof XLSX === "undefined") return;
  const rows = items.map(item => ({
    "Test Case": item.testCase,
    "Category": item.category,
    "Steps": item.steps,
    "Expected Result": item.expectedResult,
    "Status": item.status.toUpperCase(),
    "Notes": item.notes,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Test Results");
  XLSX.writeFile(wb, `gokwik_sandbox_results_${config.environment}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

const STATUS_COLORS: Record<string, string> = {
  pass: "text-emerald-600 bg-emerald-50 border-emerald-200",
  fail: "text-red-600 bg-red-50 border-red-200",
  skip: "text-amber-600 bg-amber-50 border-amber-200",
  running: "text-blue-600 bg-blue-50 border-blue-200",
  pending: "text-muted-foreground bg-muted border-border",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  fail: <XCircle className="h-4 w-4 text-red-500" />,
  skip: <SkipForward className="h-4 w-4 text-amber-500" />,
  running: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
  pending: <ChevronRight className="h-4 w-4 text-muted-foreground" />,
};

// ─── Component ────────────────────────────────────────────────────────────────

export const SandboxTesting = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [step, setStep] = useState(0);
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<Partial<SandboxConfig>>({});
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [view, setView] = useState<"chat" | "results">("chat");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addMessage = useCallback((role: Role, text: string) => {
    setMessages(prev => [...prev, { id: uid(), role, text, timestamp: new Date() }]);
  }, []);

  // Greet on mount
  useEffect(() => {
    setTimeout(() => {
      addMessage("assistant", "Hi! I'm your **GoKwik QA Agent**. I'll guide you through setting up and running a full sandbox test of the GoKwik checkout flow.\n\nLet's collect a few details first.");
      setTimeout(() => addMessage("assistant", STEPS[0].question), 600);
    }, 300);
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileUpload = async (file: File) => {
    addMessage("user", `Uploaded: ${file.name}`);
    try {
      const rows = await parseExcel(file);
      setChecklist(rows);
      addMessage("assistant", `Parsed **${rows.length} test cases** from your Excel file.\n\n${rows.slice(0, 3).map(r => `• ${r.testCase}`).join("\n")}${rows.length > 3 ? `\n• …and ${rows.length - 3} more` : ""}`);
      advanceStep({});
    } catch {
      addMessage("assistant", "I couldn't parse that file. Please make sure it's a valid .xlsx with columns like: Test Case, Category, Steps, Expected Result.");
    }
  };

  const advanceStep = (patch: Partial<SandboxConfig>) => {
    const next = step + 1;
    setConfig(prev => ({ ...prev, ...patch }));
    setStep(next);
    if (next < STEPS.length) {
      setTimeout(() => addMessage("assistant", STEPS[next].question), 400);
    } else {
      setTimeout(() => {
        addMessage("assistant", "Everything's set! I'll now run the GoKwik checkout tests using AI analysis.\n\nClick **Run Tests** to begin.");
      }, 400);
    }
  };

  const handleSend = () => {
    const val = input.trim();
    if (!val && STEPS[step]?.key !== "additionalContext") return;
    const currentStep = STEPS[step];
    if (!currentStep) return;
    addMessage("user", val || "(skipped)");
    setInput("");
    advanceStep({ [currentStep.key]: val } as Partial<SandboxConfig>);
  };

  const handleRunTests = async () => {
    const fullConfig = config as SandboxConfig;
    const tests = checklist.length > 0 ? checklist : DEFAULT_TESTS.map(t => ({ ...t, status: "pending" as const, notes: "" }));
    if (checklist.length === 0) setChecklist(tests);
    setIsRunning(true);
    setView("results");
    addMessage("assistant", `Starting **${tests.length} tests** against \`${fullConfig.environment}\` environment…`);

    let passed = 0, failed = 0, skipped = 0;

    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      setChecklist(prev => prev.map((t, idx) => idx === i ? { ...t, status: "running" } : t));
      setProgress(Math.round(((i) / tests.length) * 100));

      try {
        const result = await runTestWithAI(fullConfig, test);
        if (result.status === "pass") passed++;
        else if (result.status === "fail") failed++;
        else skipped++;

        setChecklist(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: result.status, notes: result.notes + (result.recommendation ? ` → ${result.recommendation}` : "") } : t
        ));
      } catch (err: unknown) {
        setChecklist(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: "skip", notes: `Error: ${(err as Error).message}` } : t
        ));
        skipped++;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    setProgress(100);
    setIsRunning(false);
    setIsDone(true);
    const passRate = Math.round((passed / tests.length) * 100);
    addMessage("assistant", `**Test run complete!**\n\n✅ Passed: ${passed}  ❌ Failed: ${failed}  ⏭ Skipped: ${skipped}\n\nPass Rate: **${passRate}%**\n\n${failed > 0 ? "⚠️ Review the failed tests and address critical payment/auth issues before going live." : "🎉 All tests passed! The checkout flow looks healthy."}`);
  };

  const currentStep = STEPS[step];
  const allConfigured = step >= STEPS.length;
  const passCount = checklist.filter(t => t.status === "pass").length;
  const failCount = checklist.filter(t => t.status === "fail").length;
  const skipCount = checklist.filter(t => t.status === "skip").length;
  const total = checklist.length || DEFAULT_TESTS.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-3 pt-4 px-5 border-b bg-muted/20">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="portal-heading flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-primary" />
              GoKwik Sandbox Testing Agent
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant={view === "chat" ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setView("chat")}>
                Chat
              </Button>
              <Button variant={view === "results" ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setView("results")} disabled={checklist.length === 0 && !isRunning}>
                Results {checklist.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1">{checklist.length}</Badge>}
              </Button>
              {allConfigured && !isRunning && !isDone && (
                <Button size="sm" className="text-xs h-7 gap-1" onClick={handleRunTests}>
                  <FlaskConical className="h-3 w-3" />
                  Run Tests ({total})
                </Button>
              )}
              {isDone && (
                <Button size="sm" className="text-xs h-7 gap-1" onClick={() => exportResults(checklist, config as SandboxConfig)}>
                  <Download className="h-3 w-3" />
                  Export Excel
                </Button>
              )}
              {isDone && (
                <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => {
                  setMessages([]); setStep(0); setConfig({}); setChecklist([]); setIsRunning(false);
                  setIsDone(false); setProgress(0); setView("chat");
                  setTimeout(() => { addMessage("assistant", "Ready for a new run! " + STEPS[0].question); }, 300);
                }}>
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Chat pane ────────────────────────────────── */}
        <Card className={cn("border-border/50 shadow-sm flex flex-col", view === "chat" ? "lg:col-span-3" : "lg:col-span-2 hidden lg:flex")}>
          <ScrollArea className="flex-1 h-[480px]">
            <div className="p-4 space-y-3">
              {messages.map(msg => (
                <div key={msg.id} className={cn("flex gap-2 items-start", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
                  <div className={cn("h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold shadow-sm mt-0.5", msg.role === "assistant" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>
                    {msg.role === "assistant" ? <Bot className="h-4 w-4" /> : <User className="h-3.5 w-3.5" />}
                  </div>
                  <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm", msg.role === "assistant" ? "bg-card border border-border/60 text-foreground" : "bg-primary text-primary-foreground")}>
                    {msg.text.split("**").map((part, i) =>
                      i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part.split("`").map((p2, j) => j % 2 === 1 ? <code key={j} className="bg-muted px-1 rounded text-xs font-mono">{p2}</code> : <span key={j}>{p2.split("\n").flatMap((line, li) => li > 0 ? [<br key={li} />, line] : [line])}</span>)}</span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Input area */}
          <div className="border-t p-3">
            {!allConfigured && currentStep ? (
              currentStep.isFile ? (
                <div className="space-y-2">
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} />
                  <Button variant="outline" className="w-full gap-2 text-sm h-9" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4" />
                    Upload Checklist (.xlsx / .xls)
                  </Button>
                  <Button variant="ghost" className="w-full text-xs text-muted-foreground h-7" onClick={() => advanceStep({})}>
                    Skip — use default GoKwik test suite
                  </Button>
                </div>
              ) : currentStep.options ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {currentStep.options.map(opt => (
                      <Button key={opt} variant="outline" size="sm" className="text-xs h-7" onClick={() => {
                        addMessage("user", opt);
                        advanceStep({ [currentStep.key]: opt } as Partial<SandboxConfig>);
                      }}>
                        {opt}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input ref={inputRef} placeholder={currentStep.placeholder} value={input} onChange={e => setInput(e.target.value)} className="text-sm h-9" onKeyDown={e => e.key === "Enter" && handleSend()} />
                    <Button size="sm" className="h-9 w-9 p-0 shrink-0" onClick={handleSend}><Send className="h-4 w-4" /></Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    placeholder={currentStep.placeholder}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    className="text-sm h-9"
                    onKeyDown={e => e.key === "Enter" && handleSend()}
                  />
                  <Button size="sm" className="h-9 w-9 p-0 shrink-0" onClick={handleSend}><Send className="h-4 w-4" /></Button>
                </div>
              )
            ) : isRunning ? (
              <div className="space-y-1.5">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">Running tests… {progress}%</p>
              </div>
            ) : isDone ? (
              <p className="text-xs text-center text-muted-foreground py-1">Test run complete. Use the export button above to download results.</p>
            ) : null}
          </div>
        </Card>

        {/* ── Results pane ─────────────────────────────── */}
        <div className={cn("space-y-3", view === "results" ? "lg:col-span-3" : "lg:col-span-3 hidden lg:block", view === "chat" ? "hidden lg:block" : "")}>
          {/* Summary card */}
          {(isRunning || isDone) && (
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="grid grid-cols-4 gap-3 text-center">
                  {[
                    { label: "Total", value: total, color: "text-foreground" },
                    { label: "Passed", value: passCount, color: "text-emerald-600" },
                    { label: "Failed", value: failCount, color: "text-red-600" },
                    { label: "Skipped", value: skipCount, color: "text-amber-600" },
                  ].map(s => (
                    <div key={s.label} className="space-y-0.5">
                      <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>
                {isDone && (
                  <>
                    <Separator className="my-3" />
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Pass Rate</span>
                        <span className="font-medium text-foreground">{total > 0 ? Math.round((passCount / total) * 100) : 0}%</span>
                      </div>
                      <Progress value={total > 0 ? (passCount / total) * 100 : 0} className="h-1.5" />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Test list */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-2 pt-3 px-4 border-b">
              <CardTitle className="text-sm text-muted-foreground font-medium">Test Cases</CardTitle>
            </CardHeader>
            <ScrollArea className="h-[400px]">
              <div className="divide-y divide-border/50">
                {(checklist.length > 0 ? checklist : DEFAULT_TESTS.map(t => ({ ...t, status: "pending" as const, notes: "" }))).map((test) => (
                  <div key={test.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="mt-0.5 shrink-0">{STATUS_ICON[test.status]}</div>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{test.testCase}</span>
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">{test.category}</Badge>
                        <Badge className={cn("text-[10px] h-4 px-1.5 border shrink-0", STATUS_COLORS[test.status])}>
                          {test.status}
                        </Badge>
                      </div>
                      {test.notes && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{test.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>
        </div>
      </div>

      {/* Config summary */}
      {allConfigured && (
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span>Tests are powered by AI analysis. Actual browser-level testing may produce different results.</span>
              <span className="mx-1">·</span>
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium text-foreground">{(config as SandboxConfig).websiteUrl}</span>
              <span className="mx-1">·</span>
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium text-foreground">{(config as SandboxConfig).environment}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
