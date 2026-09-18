import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { RefreshCw, ExternalLink, Mail, Search, Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { tenantScope } from "@/lib/tenant-scope";
import { toast } from "@/hooks/use-toast";
import { ShopifyLtSheetMatch } from "@/components/ShopifyLtSheetMatch";

const FN_URL = `/api/public/shopify-lt-email-comms`;

export const NEEDS_REVIEW = "Needs Review";

export const MERCHANT_STATUSES = [
  NEEDS_REVIEW,
  "CE - Merchant Live",
  "CE - Button Implementation",
  "CE - Preview link to be shared",
  "CE - Awaiting feedback from merchant",
  "CE - Merchant Dependency",
  "CE - QC in Progress",
  "CE - No Shopify Access",
  "CE - Dashboard Setup in progress",
  "CE - Awaiting Merchant Go ahead",
  "CE - Working on the Feedback",
  "TECH - Break-Fix Support",
  "OPS - Payment Gateway Pending",
  "Sales - Pre Kickoff",
  "Sales - Merchant Unresponsive",
  "Onhold",
];

interface ThreadRow {
  threadId: string;
  subject: string;
  merchantName?: string;
  firstSentAt: string | null;
  messageCount: number;
  lastReplyFrom: string;
  lastReplyAt: string | null;
  ageingDays: number | null;
  lastReplyIsInternal: boolean;
  lastReplyRole?: string;
  onboardingManager?: string;
  onboardingManagerEmail?: string;
  snippet: string;
  url: string;
}

const cleanFrom = (from: string) => {
  const m = from?.match(/^(.*?)\s*<(.+)>$/);
  if (m) return { name: m[1].replace(/"/g, "").trim() || m[2].trim(), email: m[2].trim() };
  return { name: from || "—", email: from || "" };
};

// Fallback merchant-name parse when the edge function didn't provide one.
const merchantOf = (r: ThreadRow) => {
  if (r.merchantName) return r.merchantName;
  const s = (r.subject || "").replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();
  const clean = (value: string) => value.replace(/^[\s|<>:\-–—]+|[\s|<>:\-–—]+$/g, "").trim();
  const patterns = [
    /welcome\s+to\s+gokwik\s*\(([^)]+)\)/i,
    /let(?:'|’)?s\s+begin\s+your\s+onboarding\s+journey\s*\(([^)]+)\)/i,
    /^(.+?)\s*(?:\||<>|<->)\s*welcome\s+to\s+gokwik\b/i,
    /^(.+?)\s*(?:<>|<->)\s*gokwik\b/i,
    /welcome\s+to\s+gokwik\s*(?:\||:|\-|–|—)\s*(?!let(?:'|’)?s\s+begin)(.+?)(?=\s*(?:\||<>|\-|–|—)\s*let(?:'|’)?s\s+begin|$)/i,
    /^(.+?)\s*(?:\||:|\-|–|—)\s*welcome\s+to\s+gokwik\b/i,
    /let(?:'|’)?s\s+begin\s+your\s+onboarding\s+journey\s*(?:\||:|\-|–|—)\s*(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = s.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
};

interface SavedThreadInfo {
  status: string | null;
  ai_summary: string | null;
  ai_summary_at: string | null;
  ai_status?: string | null;
  ai_confidence?: string | null;
  ai_evidence?: string | null;
}

// Status is never guessed from subject/snippet keywords any more: it is either
// set manually or derived by the AI from the thread itself with quoted evidence.
// Anything without evidence stays "Needs Review" instead of being fabricated.
const derivedStatus = (info?: SavedThreadInfo): string => {
  if (info?.status) return info.status;
  if (info?.ai_status && MERCHANT_STATUSES.includes(info.ai_status)) return info.ai_status;
  return NEEDS_REVIEW;
};

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const ageingTone = (d: number | null) => {
  if (d === null) return "bg-muted text-muted-foreground";
  if (d <= 2) return "bg-success-soft text-success-strong";
  if (d <= 7) return "bg-warning-soft text-warning-strong";
  return "bg-destructive-soft text-destructive-strong";
};

export const ShopifyLtEmailComms = () => {
  const { getLabel, responsibilityLabels } = useLabels();
  const merchantLabel = getLabel("field_merchant_name");
  const internalLabel = responsibilityLabels.gokwik;
  /** Stored roles keep their original values; only what's shown follows the workspace's names. */
  const roleLabel = (role: string) =>
    role === "Merchant" ? responsibilityLabels.merchant : role === "GoKwik (Other)" ? `Someone else (${internalLabel})` : role;
  const [days, setDays] = useState("7");
  const [search, setSearch] = useState("");
  const [omFilter, setOmFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ageingSort, setAgeingSort] = useState<"none" | "asc" | "desc">("none");
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();



  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["shopify-lt-email-comms", days],
    queryFn: async () => {
      const res = await fetch(FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ days: Number(days) }),
      });
      const raw = await res.text();
      let json: any = null;
      try { json = JSON.parse(raw); } catch { /* non-JSON upstream error */ }
      if (!res.ok || !json) {
        throw new Error(
          json?.details || json?.error ||
          (raw.includes("upstream")
            ? "The email service timed out. Try a shorter range (7 days) and refresh."
            : raw.slice(0, 200) || "Failed to load emails"),
        );
      }
      return json.threads as ThreadRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: savedStatuses } = useQuery({
    queryKey: ["shopify-lt-thread-status", currentUser?.tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shopify_lt_thread_status")
        .select("thread_id, status, ai_summary, ai_summary_at, ai_status, ai_confidence, ai_evidence")
        .eq("tenant_id", tenantScope(currentUser?.tenantId));
      if (error) throw error;
      return Object.fromEntries(
        (data || []).map((r: any) => [
          r.thread_id,
          {
            status: r.status,
            ai_summary: r.ai_summary,
            ai_summary_at: r.ai_summary_at,
            ai_status: r.ai_status,
            ai_confidence: r.ai_confidence,
            ai_evidence: r.ai_evidence,
          },
        ]),
      ) as Record<string, SavedThreadInfo>;
    },
    staleTime: 60 * 1000,
  });

  const saveStatus = useMutation({
    mutationFn: async ({ row, status }: { row: ThreadRow; status: string }) => {
      const { error } = await supabase.from("shopify_lt_thread_status").upsert(
        {
          thread_id: row.threadId,
          status,
          subject: row.subject,
          tenant_id: currentUser?.tenantId ?? null,
          updated_by: currentUser?.id ?? null,
        },
        { onConflict: "tenant_id,thread_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shopify-lt-thread-status"] }),
    onError: (e: any) => toast({ title: "Could not save status", description: e.message, variant: "destructive" }),
  });

  const infoOf = (r: ThreadRow) => savedStatuses?.[r.threadId];
  const statusOf = (r: ThreadRow) => derivedStatus(infoOf(r));
  const summaryOf = (r: ThreadRow) => infoOf(r)?.ai_summary || "";

  // ---- AI summaries for the very latest message of each thread ----
  // Summaries persist in shopify_lt_thread_status; only threads with no summary
  // (or a newer last reply than the summary) get regenerated.
  const summarizeRequested = useRef(new Set<string>());
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    if (!data || !savedStatuses || !currentUser) return;
    const need = data.filter((r) => {
      if (summarizeRequested.current.has(r.threadId)) return false;
      const s = savedStatuses[r.threadId];
      if (!s?.ai_summary) return true;
      // Legacy rows summarized before evidence-based classification existed.
      if (!s.ai_status) return true;
      if (r.lastReplyAt && s.ai_summary_at && new Date(r.lastReplyAt) > new Date(s.ai_summary_at)) return true;
      return false;
    });
    if (!need.length) return;

    const batches: ThreadRow[][] = [];
    for (let i = 0; i < need.length; i += 8) batches.push(need.slice(i, i + 8));
    batches.forEach((b) => b.forEach((r) => summarizeRequested.current.add(r.threadId)));

    setSummarizing(true);
    let idx = 0;
    const worker = async () => {
      while (idx < batches.length) {
        const batch = batches[idx++];
        try {
          const res = await fetch(FN_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ action: "summarize", threadIds: batch.map((r) => r.threadId) }),
          });
          const json = await res.json().catch(() => null);
          if (!res.ok || !json?.summaries?.length) continue;
          const nowIso = new Date().toISOString();
          const upRows = (json.summaries as any[])
            .filter((s) => s.threadId && s.summary?.trim())
            .map((s) => ({
              thread_id: s.threadId,
              tenant_id: currentUser.tenantId ?? null,
              subject: batch.find((b) => b.threadId === s.threadId)?.subject || "",
              ai_summary: s.summary.trim(),
              ai_summary_at: nowIso,
              ai_status: MERCHANT_STATUSES.includes(s.status) ? s.status : NEEDS_REVIEW,
              ai_confidence: s.confidence || "low",
              ai_evidence: s.evidence || "",
              ai_merchant_name: s.merchantName || "",
            }));
          if (!upRows.length) continue;
          await supabase
            .from("shopify_lt_thread_status")
            .upsert(upRows, { onConflict: "tenant_id,thread_id" });
          queryClient.setQueryData(
            ["shopify-lt-thread-status"],
            (old: Record<string, SavedThreadInfo> | undefined) => ({
              ...(old || {}),
              ...Object.fromEntries(
                upRows.map((u) => [
                  u.thread_id,
                  {
                    ...(old?.[u.thread_id] || { status: null }),
                    ai_summary: u.ai_summary,
                    ai_summary_at: u.ai_summary_at,
                    ai_status: u.ai_status,
                    ai_confidence: u.ai_confidence,
                    ai_evidence: u.ai_evidence,
                  },
                ]),
              ),
            }),
          );
        } catch {
          // skip failed batch — it stays unsummarized until next load
        }
      }
    };
    Promise.all([worker(), worker()]).finally(() => setSummarizing(false));
  }, [data, savedStatuses, currentUser, queryClient]);

  const managers = Array.from(
    new Set((data || []).map((r) => r.onboardingManager).filter(Boolean) as string[]),
  ).sort();

  const filtered = (data || []).filter((r) => {
    if (omFilter !== "all") {
      if (omFilter === "__none") {
        if (r.onboardingManager) return false;
      } else if (r.onboardingManager !== omFilter) return false;
    }
    if (roleFilter !== "all" && (r.lastReplyRole || "") !== roleFilter) return false;
    if (statusFilter !== "all" && statusOf(r) !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.subject?.toLowerCase().includes(q) ||
      merchantOf(r).toLowerCase().includes(q) ||
      summaryOf(r).toLowerCase().includes(q) ||
      r.lastReplyFrom?.toLowerCase().includes(q) ||
      r.onboardingManager?.toLowerCase().includes(q)
    );
  });


  const rows = [...filtered].sort((a, b) => {
    if (ageingSort === "none") return 0;
    const aDays = a.ageingDays ?? -1;
    const bDays = b.ageingDays ?? -1;
    if (aDays === bDays) return 0;
    if (aDays === -1) return ageingSort === "asc" ? 1 : -1;
    if (bDays === -1) return ageingSort === "asc" ? -1 : 1;
    return ageingSort === "asc" ? aDays - bDays : bDays - aDays;
  });

  const awaiting = rows.filter((r) => r.lastReplyIsInternal).length;
  const stale = rows.filter((r) => (r.ageingDays ?? 0) > 1).length;

  const exportCsv = () => {
    const headers = [
      "Merchant Name", "Subject", "Latest Summary", "Merchant Status", "Status Source", "Status Confidence",
      "Status Evidence", "Messages", "Onboarding Manager", "Onboarding Manager Email",
      "Last Reply By", "Last Reply Email", "Last Reply Role", "First Sent At", "Last Reply On",
      "Ageing (days)", "Awaiting Merchant Reply", "Snippet", "Thread URL", "Thread ID",
    ];
    const lines = rows.map((r) => {
      const sender = cleanFrom(r.lastReplyFrom);
      const info = infoOf(r);
      return [
        merchantOf(r), r.subject, summaryOf(r), statusOf(r),
        info?.status ? "Manual" : info?.ai_status ? "AI" : "Unclassified",
        info?.status ? "" : info?.ai_confidence || "",
        info?.status ? "" : info?.ai_evidence || "",
        r.messageCount, r.onboardingManager || "", r.onboardingManagerEmail || "",
        sender.name, sender.email, r.lastReplyRole || (r.lastReplyIsInternal ? "GoKwik (Other)" : "Merchant"),
        r.firstSentAt ? format(new Date(r.firstSentAt), "dd MMM yyyy HH:mm") : "",
        r.lastReplyAt ? format(new Date(r.lastReplyAt), "dd MMM yyyy HH:mm") : "",
        r.ageingDays ?? "", r.lastReplyIsInternal ? "Yes" : "No", r.snippet, r.url, r.threadId,
      ].map(csvCell).join(",");
    });
    const blob = new Blob(["\ufeff" + [headers.map(csvCell).join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shopify-lt-email-comms-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="heading-section">Shopify LT Integration Email Communication</h2>
          <p className="text-sm text-muted-foreground">
            Threads on integration@gokwik.co with "Welcome to GoKwik" or "Let's Begin Your Onboarding Journey"
            {summarizing && (
              <span className="ml-2 inline-flex items-center gap-1 text-primary">
                <Sparkles className="h-3 w-3 animate-pulse" /> Generating AI summaries…
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <ShopifyLtSheetMatch rows={rows} statusOf={statusOf} summaryOf={summaryOf} />
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>


      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Threads</p>
          <p className="text-2xl font-semibold">{rows.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Awaiting merchant reply</p>
          <p className="text-2xl font-semibold">{awaiting}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">No reply &gt; 1 day</p>
          <p className="text-2xl font-semibold">{stale}</p>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search subject, sender or manager..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={omFilter} onValueChange={setOmFilter}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Onboarding Manager" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Onboarding Managers</SelectItem>
            <SelectItem value="__none">Not identified</SelectItem>
            {managers.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Last reply by" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Last reply: anyone</SelectItem>
            <SelectItem value="Onboarding Manager">Onboarding Manager</SelectItem>
            <SelectItem value="Merchant">{merchantLabel}</SelectItem>
            <SelectItem value="GoKwik (Other)">Someone else ({internalLabel})</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[240px]"><SelectValue placeholder={`${merchantLabel} status`} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All merchant statuses</SelectItem>
            {MERCHANT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ageingSort} onValueChange={(v) => setAgeingSort(v as any)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Sort by ageing" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Default order</SelectItem>
            <SelectItem value="desc">Ageing: highest first</SelectItem>
            <SelectItem value="asc">Ageing: lowest first</SelectItem>
          </SelectContent>
        </Select>
      </div>


      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{merchantLabel}</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Latest Summary</TableHead>
              <TableHead>{merchantLabel} Status</TableHead>
              <TableHead>Msgs</TableHead>
              <TableHead>Onboarding Manager</TableHead>
              <TableHead>Last reply by</TableHead>
              <TableHead>Last reply on</TableHead>
              <TableHead>Ageing</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isFetching && !data && (
              <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">Loading emails…</TableCell></TableRow>
            )}
            {!isFetching && rows.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                <Mail className="h-4 w-4 inline mr-2" />No matching email threads found
              </TableCell></TableRow>
            )}

            {rows.map((r) => {
              const sender = cleanFrom(r.lastReplyFrom);
              const role = r.lastReplyRole || (r.lastReplyIsInternal ? "GoKwik (Other)" : "Merchant");
              return (
                <TableRow key={r.threadId}>
                  <TableCell className="max-w-[160px]">
                    <p className="text-sm font-semibold truncate">{merchantOf(r) || "—"}</p>
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <p className="text-sm font-medium truncate">{r.subject || "(no subject)"}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.snippet}</p>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    {summaryOf(r) ? (
                      <p className="text-xs text-muted-foreground line-clamp-3">{summaryOf(r)}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60 italic flex items-center gap-1">
                        <Sparkles className={`h-3 w-3 ${summarizing ? "animate-pulse" : ""}`} />
                        {summarizing ? "Summarizing…" : "—"}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={statusOf(r)}
                      onValueChange={(v) => saveStatus.mutate({ row: r, status: v })}
                    >
                      <SelectTrigger className="w-[230px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MERCHANT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!infoOf(r)?.status && (
                      <p
                        className="mt-0.5 text-2xs text-muted-foreground truncate max-w-[230px]"
                        title={infoOf(r)?.ai_evidence || ""}
                      >
                        {infoOf(r)?.ai_status
                          ? `AI · ${infoOf(r)?.ai_confidence || "low"} confidence${
                              infoOf(r)?.ai_evidence ? ` · "${infoOf(r)?.ai_evidence}"` : ""
                            }`
                          : "Not classified yet — verify manually"}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{r.messageCount}</TableCell>
                  <TableCell className="max-w-[180px]">

                    <p className="text-sm truncate">{r.onboardingManager || "—"}</p>
                    {r.onboardingManagerEmail && (
                      <p className="text-xs text-muted-foreground truncate">{r.onboardingManagerEmail}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{sender.name}</p>
                    <Badge
                      variant="outline"
                      className={`mt-0.5 text-2xs ${
                        role === "Onboarding Manager"
                          ? "border-info/30 text-info-strong"
                          : role === "Merchant"
                            ? "border-warning/30 text-warning-strong"
                            : ""
                      }`}
                    >
                      {roleLabel(role)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {r.lastReplyAt ? format(new Date(r.lastReplyAt), "dd MMM yyyy, HH:mm") : "—"}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ageingTone(r.ageingDays)}`}>
                      {r.ageingDays === null ? "—" : r.ageingDays === 0 ? "Today" : `${r.ageingDays}d`}
                    </span>
                  </TableCell>
                  <TableCell>
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
