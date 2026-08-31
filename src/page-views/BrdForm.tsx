import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, ChevronRight, Loader2, FileText, Send, MessageCircle, Sparkles, ArrowRight, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

const API_URL = `/api/public/brd-form-api`;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface FormField {
  id: string;
  question: string;
  field_type: string;
  options: string[];
  is_required: boolean;
  category: string;
  sort_order: number;
}

interface SessionData {
  id: string;
  status: string;
  merchantName: string;
  mid: string;
  completed_at: string | null;
}

interface FormInfo {
  name: string;
  description: string;
}

// Extract abbreviation from category like "Merchant Identifiers (MI)" → "MI"
const getAbbreviation = (category: string) => {
  const match = category.match(/\(([^)]+)\)/);
  if (match) return match[1];
  // fallback: first letters of each word
  return category.split(/[\s-]+/).map(w => w[0]).join("").substring(0, 4).toUpperCase();
};

// Group categories into broader groups by abbreviation prefix
const groupSections = (fields: FormField[]) => {
  const catOrder: string[] = [];
  const catFields: Record<string, FormField[]> = {};
  fields.forEach(f => {
    const cat = f.category || "General";
    if (!catFields[cat]) {
      catFields[cat] = [];
      catOrder.push(cat);
    }
    catFields[cat].push(f);
  });

  // Group by abbreviation (e.g. all "FD" categories together)
  const broadGroups: { abbr: string; label: string; categories: { name: string; fields: FormField[] }[] }[] = [];
  const abbrMap: Record<string, typeof broadGroups[0]> = {};

  catOrder.forEach(cat => {
    const abbr = getAbbreviation(cat);
    if (!abbrMap[abbr]) {
      // Get a clean label: text before the parenthesis or the abbreviation itself
      const labelMatch = cat.match(/^([^(]+)/);
      const label = labelMatch ? labelMatch[1].trim() : abbr;
      abbrMap[abbr] = { abbr, label, categories: [] };
      broadGroups.push(abbrMap[abbr]);
    }
    abbrMap[abbr].categories.push({ name: cat, fields: catFields[cat] });
  });

  return broadGroups;
};

const MOTIVATIONAL_MESSAGES = [
  { emoji: "🚀", text: "Great start! You're on a roll!" },
  { emoji: "💪", text: "Keep going! Every answer brings you closer." },
  { emoji: "⭐", text: "Awesome progress! You're doing great." },
  { emoji: "🎯", text: "Halfway there! The finish line is in sight." },
  { emoji: "🔥", text: "You're on fire! Almost done." },
  { emoji: "🏆", text: "Final stretch! Just a few more to go." },
];

const getMotivation = (progress: number) => {
  const idx = Math.min(Math.floor(progress / 20), MOTIVATIONAL_MESSAGES.length - 1);
  return MOTIVATIONAL_MESSAGES[idx];
};

const BrdForm = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);
  const [form, setForm] = useState<FormInfo | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [csvUrl, setCsvUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showMotivation, setShowMotivation] = useState(false);
  const [lastSectionCompleted, setLastSectionCompleted] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!token) { setError("No BRD token provided"); setLoading(false); return; }
    fetchData();
  }, [token]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, [currentIndex]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentIndex]);

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_URL}?token=${token}`, {
        headers: { apikey: API_KEY },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to load form");
      }
      const data = await res.json();
      setSession(data.session);
      setForm(data.form);
      setFields(data.fields || []);
      setResponses(data.responses || {});
      setCsvUrl(data.session.csv_url || null);
      if (data.session.status === "completed") setCompleted(true);
      const firstUnanswered = (data.fields || []).findIndex(
        (f: FormField) => !data.responses?.[f.id]
      );
      if (firstUnanswered > 0) setCurrentIndex(firstUnanswered);
      // Expand the group of the current question
      if (data.fields?.length) {
        const firstCat = data.fields[firstUnanswered > 0 ? firstUnanswered : 0]?.category || "";
        setExpandedGroup(getAbbreviation(firstCat));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load form");
    } finally {
      setLoading(false);
    }
  };

  const saveResponse = useCallback(async (fieldId: string, value: string) => {
    if (!value?.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: API_KEY },
        body: JSON.stringify({ responses: { [fieldId]: value } }),
      });
      const data = await res.json();
      if (data.csv_url) setCsvUrl(data.csv_url);
    } catch (e) {
      console.error("Auto-save failed:", e);
    } finally {
      setSaving(false);
    }
  }, [token]);

  const broadGroups = groupSections(fields);
  const currentField = fields[currentIndex];
  const currentSection = currentField?.category || "";
  const currentAbbr = currentSection ? getAbbreviation(currentSection) : "";
  const answeredCount = Object.keys(responses).filter((k) => responses[k]?.trim()).length;
  const progress = fields.length > 0 ? (answeredCount / fields.length) * 100 : 0;
  const isLastQuestion = currentIndex === fields.length - 1;
  const canSubmit = fields.filter((f) => f.is_required).every((f) => responses[f.id]?.trim());

  // Auto-expand current group when question changes
  useEffect(() => {
    if (currentAbbr) setExpandedGroup(currentAbbr);
  }, [currentAbbr]);

  const checkSectionTransition = (prevIdx: number, newIdx: number) => {
    if (prevIdx < 0 || newIdx >= fields.length) return;
    const prevSection = fields[prevIdx]?.category;
    const newSection = fields[newIdx]?.category;
    if (prevSection && newSection && prevSection !== newSection) {
      setLastSectionCompleted(prevSection);
      setShowMotivation(true);
      setTimeout(() => setShowMotivation(false), 3000);
    }
  };

  const handleNext = async () => {
    if (!currentField) return;
    const value = responses[currentField.id];
    if (value?.trim()) {
      await saveResponse(currentField.id, value);
    }
    if (currentIndex < fields.length - 1) {
      checkSectionTransition(currentIndex, currentIndex + 1);
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleSkip = () => {
    if (currentIndex < fields.length - 1) {
      checkSectionTransition(currentIndex, currentIndex + 1);
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const jumpToField = (fieldIndex: number) => {
    setCurrentIndex(fieldIndex);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (currentField && responses[currentField.id]?.trim()) {
        await saveResponse(currentField.id, responses[currentField.id]);
      }
      const res = await fetch(`${API_URL}?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: API_KEY },
        body: JSON.stringify({ responses, complete: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      setCompleted(true);
      setCsvUrl(data.csv_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const getGroupProgress = (group: typeof broadGroups[0]) => {
    let answered = 0, total = 0;
    group.categories.forEach(c => {
      c.fields.forEach(f => {
        total++;
        if (responses[f.id]?.trim()) answered++;
      });
    });
    return { answered, total };
  };

  const motivation = getMotivation(progress);

  // Build chat history: all answered questions up to currentIndex + current question
  const chatHistory = fields.slice(0, currentIndex).filter(f => responses[f.id]?.trim());

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto" />
          <p className="text-muted-foreground animate-pulse">Loading your BRD form...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-red-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <FileText className="h-7 w-7 text-red-500" />
          </div>
          <h2 className="text-xl font-bold mb-2">Unable to Load Form</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 p-4">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl p-10 text-center">
          <div className="relative mx-auto w-20 h-20 mb-6">
            <div className="absolute inset-0 bg-green-400/20 rounded-full animate-ping" />
            <div className="relative h-20 w-20 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2">🎉 BRD Completed!</h2>
          <p className="text-muted-foreground mb-6">
            Thank you for completing the BRD for <strong>{session?.merchantName}</strong>.
            Your responses have been saved successfully.
          </p>
          {csvUrl && (
            <Button size="lg" className="bg-green-600 hover:bg-green-700" asChild>
              <a href={csvUrl} target="_blank" rel="noopener noreferrer">
                📥 Download Excel Report
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  const renderInputForField = (field: FormField, isActive: boolean) => {
    if (!isActive) return null;

    if (field.field_type === "select" && field.options?.length > 0) {
      return (
        <div className="space-y-2 max-w-sm ml-auto">
          {field.options.map((opt) => (
            <button
              key={opt}
              onClick={() => {
                setResponses((prev) => ({ ...prev, [field.id]: opt }));
                setTimeout(async () => {
                  await saveResponse(field.id, opt);
                  if (!isLastQuestion) {
                    checkSectionTransition(currentIndex, currentIndex + 1);
                    setCurrentIndex((i) => i + 1);
                  }
                }, 300);
              }}
              className={cn(
                "w-full text-left px-4 py-2.5 rounded-xl border-2 transition-all text-sm",
                responses[field.id] === opt
                  ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                  : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      );
    }

    if (field.field_type === "boolean") {
      return (
        <div className="flex gap-3 max-w-xs ml-auto">
          {["Yes", "No"].map((opt) => (
            <button
              key={opt}
              onClick={() => {
                setResponses((prev) => ({ ...prev, [field.id]: opt }));
                setTimeout(async () => {
                  await saveResponse(field.id, opt);
                  if (!isLastQuestion) {
                    checkSectionTransition(currentIndex, currentIndex + 1);
                    setCurrentIndex((i) => i + 1);
                  }
                }, 300);
              }}
              className={cn(
                "flex-1 px-5 py-3 rounded-xl border-2 transition-all text-sm font-medium",
                responses[field.id] === opt
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white hover:border-blue-300"
              )}
            >
              {opt === "Yes" ? "👍 Yes" : "👎 No"}
            </button>
          ))}
        </div>
      );
    }

    const isTextarea = field.field_type === "textarea" || field.field_type === "long_text";
    const inputType = field.field_type === "number" ? "number"
      : field.field_type === "date" ? "date"
      : field.field_type === "url" ? "url"
      : "text";

    if (isTextarea) {
      return (
        <div className="bg-white rounded-2xl rounded-tr-sm shadow-sm border border-gray-100 p-1 max-w-md ml-auto">
          <Textarea
            ref={inputRef as any}
            value={responses[field.id] || ""}
            onChange={(e) => setResponses((prev) => ({ ...prev, [field.id]: e.target.value }))}
            placeholder="Type your answer..."
            rows={3}
            className="border-0 focus-visible:ring-0 resize-none text-sm bg-transparent"
          />
        </div>
      );
    }

    return (
      <div className="bg-white rounded-2xl rounded-tr-sm shadow-sm border border-gray-100 p-1 max-w-md ml-auto">
        <Input
          ref={inputRef as any}
          type={inputType}
          value={responses[field.id] || ""}
          onChange={(e) => setResponses((prev) => ({ ...prev, [field.id]: e.target.value }))}
          placeholder={inputType === "url" ? "https://..." : inputType === "number" ? "Enter a number..." : "Type your answer..."}
          className="border-0 focus-visible:ring-0 text-sm bg-transparent"
          onKeyDown={(e) => { if (e.key === "Enter") handleNext(); }}
        />
      </div>
    );
  };

  return (
    <div className="h-screen flex bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 overflow-hidden">
      {/* Sidebar - Broad groups */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-foreground">{form?.name || "BRD Form"}</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">{session?.merchantName} • MID: {session?.mid}</p>
          <div className="mt-3 p-2 bg-blue-50 rounded-lg">
            <div className="flex justify-between text-[10px] font-medium mb-1">
              <span className="text-blue-700">{answeredCount}/{fields.length}</span>
              <span className="text-blue-600">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5 scrollbar-thin">
          {broadGroups.map((group) => {
            const { answered, total } = getGroupProgress(group);
            const isActive = currentAbbr === group.abbr;
            const isExpanded = expandedGroup === group.abbr;
            const isDone = answered === total;
            return (
              <div key={group.abbr}>
                <button
                  onClick={() => {
                    const firstField = group.categories[0]?.fields[0];
                    const idx = firstField ? fields.findIndex(f => f.id === firstField.id) : -1;
                    if (idx >= 0) jumpToField(idx);
                    setExpandedGroup(isExpanded ? null : group.abbr);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between",
                    isActive
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : isDone
                      ? "text-green-700 hover:bg-green-50"
                      : "text-muted-foreground hover:bg-gray-50"
                  )}
                >
                  <span className="flex items-center gap-2 truncate">
                    {isDone && <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />}
                    <span className="font-bold">{group.abbr}</span>
                    {group.categories.length === 1 && (
                      <span className="truncate opacity-70">{group.label}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] opacity-60">{answered}/{total}</span>
                    <ChevronRight className={cn("h-3 w-3 transition-transform", isExpanded && group.categories.length > 1 && "rotate-90")} />
                  </span>
                </button>
                {isExpanded && group.categories.length > 1 && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-blue-100 pl-2">
                    {group.categories.map(cat => {
                      const catAnswered = cat.fields.filter(f => responses[f.id]?.trim()).length;
                      const catActive = currentSection === cat.name;
                      const catDone = catAnswered === cat.fields.length;
                      // Extract sub-label after the dash e.g. "Feature Discovery (FD) - PDP" → "PDP"
                      const subMatch = cat.name.match(/-\s*(.+)/);
                      const subLabel = subMatch ? subMatch[1].trim() : cat.name;
                      return (
                        <button
                          key={cat.name}
                          onClick={() => {
                            const idx = fields.findIndex(f => f.category === cat.name);
                            if (idx >= 0) jumpToField(idx);
                          }}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded text-[11px] transition-all truncate",
                            catActive
                              ? "bg-blue-100 text-blue-800 font-medium"
                              : catDone
                              ? "text-green-600"
                              : "text-muted-foreground hover:bg-gray-50"
                          )}
                        >
                          {catDone && <CheckCircle2 className="h-2.5 w-2.5 inline mr-1" />}
                          {subLabel}
                          <span className="ml-1 opacity-50">{catAnswered}/{cat.fields.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-100 text-[10px] text-center text-muted-foreground">
          {saving ? (
            <span className="flex items-center justify-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" /> Auto-saved
            </span>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <div className="lg:hidden bg-white/90 backdrop-blur border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-bold">{form?.name || "BRD Form"}</h1>
              <p className="text-[10px] text-muted-foreground">{session?.merchantName}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">{answeredCount}/{fields.length}</Badge>
          </div>
          <Progress value={progress} className="h-1.5 mt-2" />
        </div>

        {/* WhatsApp-like chat header */}
        <div className="bg-white border-b border-gray-200 px-4 py-2.5 hidden lg:flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center">
            <MessageCircle className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">BRD Assistant</p>
            <p className="text-[10px] text-muted-foreground">
              {currentSection} • Q{currentIndex + 1}/{fields.length}
            </p>
          </div>
          {saving && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving...
            </span>
          )}
        </div>

        {/* Chat messages - WhatsApp style */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#e5ddd5]/30 scrollbar-thin" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}>
          {/* Previous answered messages (history) */}
          {chatHistory.map((field, idx) => {
            const prevField = idx > 0 ? chatHistory[idx - 1] : null;
            const showSectionDivider = !prevField || prevField.category !== field.category;
            return (
              <div key={field.id}>
                {showSectionDivider && (
                  <div className="flex justify-center my-2">
                    <span className="bg-white/80 text-[10px] text-muted-foreground px-3 py-1 rounded-full shadow-sm">
                      {getAbbreviation(field.category)} — {field.category}
                    </span>
                  </div>
                )}
                {/* Bot question bubble */}
                <div className="flex items-start gap-2 max-w-[80%]">
                  <div className="bg-white rounded-xl rounded-tl-sm shadow-sm px-3 py-2 text-xs text-foreground">
                    {field.question}
                  </div>
                </div>
                {/* User answer bubble */}
                <div className="flex justify-end mt-1">
                  <div
                    className="bg-blue-500 text-white rounded-xl rounded-tr-sm shadow-sm px-3 py-2 text-xs max-w-[70%] cursor-pointer hover:bg-blue-600 transition-colors"
                    onClick={() => jumpToField(fields.indexOf(field))}
                    title="Click to edit"
                  >
                    {responses[field.id]}
                    <span className="text-[8px] opacity-60 ml-2">✓✓</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Section divider for current question if new section */}
          {currentField && (
            (() => {
              const lastHistoryField = chatHistory[chatHistory.length - 1];
              const showDivider = !lastHistoryField || lastHistoryField.category !== currentField.category;
              return showDivider ? (
                <div className="flex justify-center my-2">
                  <span className="bg-white/80 text-[10px] text-muted-foreground px-3 py-1 rounded-full shadow-sm">
                    {getAbbreviation(currentField.category)} — {currentField.category}
                  </span>
                </div>
              ) : null;
            })()
          )}

          {/* Current question bubble */}
          {currentField && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300" key={`q-${currentField.id}`}>
              <div className="flex items-start gap-2 max-w-[80%]">
                <div className="bg-white rounded-xl rounded-tl-sm shadow-md px-4 py-3 text-sm text-foreground">
                  <p className="font-medium leading-relaxed">
                    {currentField.question}
                    {currentField.is_required && <span className="text-red-500 ml-1">*</span>}
                  </p>
                </div>
              </div>
              {/* Active input */}
              <div className="mt-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
                {renderInputForField(currentField, true)}
              </div>
            </div>
          )}

          {/* Motivational toast */}
          {showMotivation && (
            <div className="flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-full px-4 py-2 shadow-sm">
                <p className="text-xs font-medium text-amber-800">
                  {motivation.emoji} {motivation.text} — "{lastSectionCompleted}" done!
                </p>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Bottom action bar */}
        <div className="bg-white border-t border-gray-200 px-4 py-2.5">
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handlePrev} disabled={currentIndex === 0} className="text-xs h-8">
                ← Back
              </Button>
              {!currentField?.is_required && (
                <Button variant="ghost" size="sm" onClick={handleSkip} disabled={isLastQuestion} className="text-xs text-muted-foreground h-8">
                  <SkipForward className="h-3 w-3 mr-1" /> Skip
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isLastQuestion ? (
                <Button onClick={handleSubmit} disabled={submitting || !canSubmit} className="bg-green-600 hover:bg-green-700 text-xs px-5 h-8">
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  Submit BRD
                </Button>
              ) : (
                <Button onClick={handleNext} className="text-xs px-5 h-8">
                  Next <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-[9px] text-center text-muted-foreground mt-1 hidden md:block">
            Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[8px] font-mono">Enter</kbd> to continue • Click any answer to edit
          </p>
        </div>
      </main>
    </div>
  );
};

export default BrdForm;
