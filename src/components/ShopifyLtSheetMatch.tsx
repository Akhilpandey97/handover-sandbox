import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { FileSpreadsheet, Upload, Download, Loader2, Sparkles, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

const FN_URL = `/api/public/shopify-lt-email-comms`;

interface ThreadRow {
  threadId: string;
  isLive?: boolean;
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

interface MatchResult {
  account: string;
  matched: string; // merchant name or ""
  confidence: "Exact" | "High" | "AI" | "None";
  row: ThreadRow | null;
}

const cleanFrom = (from: string) => {
  const m = from?.match(/^(.*?)\s*<(.+)>$/);
  if (m) return { name: m[1].replace(/"/g, "").trim() || m[2].trim(), email: m[2].trim() };
  return { name: from || "—", email: from || "" };
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const compact = (s: string) => norm(s).replace(/\s+/g, "");
const tokens = (s: string) =>
  new Set(
    norm(s)
      .split(" ")
      .filter((t) => t && !["pvt", "ltd", "llp", "private", "limited", "the", "inc", "co", "com", "www", "in", "net", "org", "io", "shop", "store"].includes(t)),
  );

// Domain-style account names: "lumuk.com" / "www.lumuk.co.in" / "https://lumuk.com" → "lumuk"
const domainSlug = (s: string): string => {
  const m = s.trim().toLowerCase().match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]*)\.(?:com|co|in|net|org|io|shop|store|co\.in)(?:[/?#].*)?$/);
  return m ? m[1].replace(/-/g, "") : "";
};

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((t) => b.has(t) && inter++);
  return inter / (a.size + b.size - inter);
};

// True when every word of `small` appears in `big` (token subset match)
const isTokenSubset = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
};

// Fuzzy word similarity: handles reordering, missing/extra words, typos
const wordSim = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let hits = 0;
  for (const t of small) {
    if (big.has(t)) { hits++; continue; }
    // prefix/partial word match (e.g. "organics" vs "organic")
    for (const u of big) {
      if (u.length >= 4 && t.length >= 4 && (u.startsWith(t) || t.startsWith(u))) { hits++; break; }
    }
  }
  return hits / small.size;
};

interface Props {
  rows: ThreadRow[];
  statusOf: (r: ThreadRow) => string;
  summaryOf: (r: ThreadRow) => string;
}

const buildMerchants = (source: ThreadRow[]) => {
  const list: { name: string; row: ThreadRow }[] = [];
  for (const r of source) {
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
    let name = r.merchantName || "";
    if (!name) {
      for (const pattern of patterns) {
        const match = s.match(pattern);
        if (match?.[1]) { name = clean(match[1]); break; }
      }
    }
    // Keep EVERY thread in the pool — even when no merchant name could be parsed.
    // Matching also runs against the full subject line, so unparsed threads
    // are still findable. Fallback label = cleaned subject.
    list.push({ name: name || s, row: r });
  }
  return list;
};

export const ShopifyLtSheetMatch = ({ rows, statusOf, summaryOf }: Props) => {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const [accountCol, setAccountCol] = useState<number>(-1);
  const [matching, setMatching] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Full matching pool: the ENTIRE inbox (no days bucket), merged with the 30-day
  // window as a fallback in case the all-time scan gets truncated
  const [poolRows, setPoolRows] = useState<ThreadRow[] | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolFailed, setPoolFailed] = useState(false);
  const [extraSummaries, setExtraSummaries] = useState<Record<string, string>>({});
  const poolPromise = useRef<Promise<ThreadRow[]> | null>(null);

  // Fetch the entire inbox (days = 0) plus the 30-day window as a safety net, deduped by threadId
  const ensurePool = (): Promise<ThreadRow[]> => {
    if (poolRows) return Promise.resolve(poolRows);
    if (poolPromise.current) return poolPromise.current;
    setPoolLoading(true);
    const p = (async () => {
      const fetchWindow = async (d: number): Promise<ThreadRow[]> => {
        try {
          const res = await fetch(FN_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            // includeLive: already-live accounts stay in the pool and map to "Live"
            // light: metadata-only scan — cheap enough to cover the entire inbox
            body: JSON.stringify({ days: d, includeLive: true, light: true }),
          });
          const json = await res.json().catch(() => null);
          if (!res.ok || !Array.isArray(json?.threads)) return [];
          return json.threads as ThreadRow[];
        } catch {
          return [];
        }
      };
      const [all, w30] = await Promise.all([fetchWindow(0), fetchWindow(30)]);
      const byId = new Map<string, ThreadRow>();
      // Entire inbox first so the 30-day window never overwrites its copy
      for (const list of [all, w30]) {
        for (const r of list) if (!byId.has(r.threadId)) byId.set(r.threadId, r);
      }
      const merged = byId.size ? Array.from(byId.values()) : rows;
      if (!byId.size) {
        setPoolFailed(true);
        toast({
          title: "Full inbox scan unavailable",
          description: "Fell back to the threads loaded in the table. Retry in a moment for complete coverage.",
          variant: "destructive",
        });
      }
      setPoolRows(merged);
      setPoolLoading(false);
      return merged;
    })();
    poolPromise.current = p;
    return p;
  };

  // Preload the full pool in the background as soon as the dialog opens
  useEffect(() => {
    if (open) ensurePool().catch(() => setPoolLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const summaryText = (r: ThreadRow) => summaryOf(r) || extraSummaries[r.threadId] || "";
  // Already-live threads always report the canonical "Live" status
  const statusText = (r: ThreadRow) => (r.isLive ? "CE - Merchant Live" : statusOf(r));

  const reset = () => {
    setFileName("");
    setHeaders([]);
    setSheetRows([]);
    setAccountCol(-1);
    setResults(null);
    setAiUsed(false);
    setExtraSummaries({});
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (f: File) => {
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
      if (!aoa.length) {
        toast({ title: "Empty sheet", description: "No rows found in the first sheet.", variant: "destructive" });
        return;
      }
      const hdrs = (aoa[0] as string[]).map((h) => String(h ?? "").trim());
      const body = aoa.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
      setFileName(f.name);
      setHeaders(hdrs);
      setSheetRows(body as string[][]);
      setResults(null);
      // Auto-detect the Account Name column
      const idx = hdrs.findIndex((h) => /account\s*name/i.test(h));
      const alt = hdrs.findIndex((h) => /merchant|brand|account|name/i.test(h));
      setAccountCol(idx > -1 ? idx : alt > -1 ? alt : 0);
    } catch (e: any) {
      toast({ title: "Could not read file", description: e?.message, variant: "destructive" });
    }
  };

  const clientMatch = (account: string, list: { name: string; row: ThreadRow }[]): MatchResult => {
    const c = compact(account);
    const accTok = tokens(account);
    // Brand slug when the account name is a domain ("lumuk.com" → "lumuk")
    const slug = domainSlug(account);
    let best: { name: string; row: ThreadRow } | null = null;
    let bestScore = 0;
    let exact: { name: string; row: ThreadRow } | null = null;

    for (const m of list) {
      const mc = compact(m.name);
      // Full subject line (re/fwd stripped) — the account keyword is searched
      // ANYWHERE in the subject, not only in the parsed merchant-name patterns
      const subject = (m.row.subject || "").replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "");
      const sc = compact(subject);
      const subTok = tokens(subject);
      if (!mc && !sc) continue;
      // Exact after stripping ALL symbols/spaces (case-insensitive)
      if (mc && mc === c) { exact = m; break; }
      const mTok = tokens(m.name);
      let score = 0;
      // One name fully contains the other (ignoring symbols/spaces)
      if (c && mc && (c.includes(mc) || mc.includes(c))) score = Math.max(score, 0.9);
      // Account keyword appears anywhere inside the full subject line
      if (c && c.length >= 3 && sc && sc.includes(c)) score = Math.max(score, 0.9);
      // Domain slug matches the parsed merchant name or appears in the subject
      // (e.g. account "lumuk.com" vs subject "…Onboarding Journey (Lumuk)")
      if (slug && slug.length >= 3) {
        if (mc && (mc === slug || mc.includes(slug) || slug.includes(mc))) score = Math.max(score, 0.92);
        if (sc && sc.includes(slug)) score = Math.max(score, 0.9);
      }
      // All words of the shorter name appear in the other (e.g. "Adagio" vs "Adagio Aunita Trades")
      if (isTokenSubset(accTok, mTok)) score = Math.max(score, 0.85);
      // Every account word appears somewhere in the subject words
      if (isTokenSubset(accTok, subTok)) score = Math.max(score, 0.85);
      // Word-overlap similarity with prefix tolerance (reordered/partial words)
      score = Math.max(score, wordSim(accTok, mTok) * 0.8);
      score = Math.max(score, wordSim(accTok, subTok) * 0.75);
      score = Math.max(score, jaccard(accTok, mTok));
      if (score > bestScore) { bestScore = score; best = m; }
    }

    if (exact) return { account, matched: exact.name, confidence: "Exact", row: exact.row };
    if (best && bestScore >= 0.5) return { account, matched: best.name, confidence: "High", row: best.row };
    return { account, matched: "", confidence: "None", row: null };
  };

  const runMatching = async () => {
    if (accountCol < 0 || !sheetRows.length) return;
    setMatching(true);
    setAiUsed(false);
    try {
      // 0) Make sure the full 7/14/30-day pool is loaded before matching
      const pool = await ensurePool();
      const list = buildMerchants(pool.length ? pool : rows);

      // 1) Fast client-side pass
      const initial = sheetRows.map((r) => clientMatch(String(r[accountCol] ?? "").trim(), list));
      const unresolved = initial.filter((x) => !x.matched && x.account);

      // 2) AI pass for the unresolved ones
      if (unresolved.length && list.length) {
        const res = await fetch(FN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            action: "match",
            accountNames: unresolved.map((u) => u.account),
            merchantNames: Array.from(new Set(list.map((m) => m.name))),
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "AI matching failed");
        const map: Record<string, string | null> = json?.matches || {};
        for (const u of unresolved) {
          const hit = map[u.account];
          if (hit) {
            const m = list.find((x) => x.name === hit);
            if (m) { u.matched = m.name; u.confidence = "AI"; u.row = m.row; }
          }
        }
        setAiUsed(true);
      }

      setResults(initial);
      const matchedCount = initial.filter((x) => x.matched).length;
      toast({ title: "Matching complete", description: `${matchedCount}/${initial.length} accounts matched.` });

      // 3) Fill AI summaries for matched threads that don't have one yet
      const missing = initial.filter((x) => x.row && !summaryOf(x.row) && !extraSummaries[x.row.threadId]);
      const ids = Array.from(new Set(missing.map((x) => x.row!.threadId))).slice(0, 40);
      for (let i = 0; i < ids.length; i += 8) {
        try {
          const res = await fetch(FN_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ action: "summarize", threadIds: ids.slice(i, i + 8) }),
          });
          const json = await res.json().catch(() => null);
          if (res.ok && Array.isArray(json?.summaries)) {
            const fresh = Object.fromEntries(
              (json.summaries as { threadId: string; summary: string }[])
                .filter((s) => s.threadId && s.summary?.trim())
                .map((s) => [s.threadId, s.summary.trim()]),
            );
            if (Object.keys(fresh).length) setExtraSummaries((prev) => ({ ...prev, ...fresh }));
          }
        } catch {
          // summaries are best-effort; the sheet still downloads without them
        }
      }
    } catch (e: any) {
      toast({ title: "Matching failed", description: e?.message, variant: "destructive" });
      if (!results) {
        const list = buildMerchants(poolRows?.length ? poolRows : rows);
        setResults(sheetRows.map((r) => clientMatch(String(r[accountCol] ?? "").trim(), list)));
      }
    } finally {
      setMatching(false);
    }
  };

  const download = () => {
    if (!results) return;
    const outHeaders = [
      ...headers,
      "Matched Merchant", "Match Confidence", "Merchant Status", "Latest Summary (AI)",
      "Messages", "Onboarding Manager", "Onboarding Manager Email",
      "Last Reply By", "Last Reply Email", "Last Reply Role", "Last Reply On",
      "Ageing (days)", "Awaiting Merchant Reply", "Thread URL",
    ];
    const outRows = sheetRows.map((orig, i) => {
      const res = results[i];
      if (!res?.row) {
        return [...orig, res?.matched || "", res?.confidence === "None" ? "No match" : res?.confidence, ...Array(13).fill("")];
      }
      const r = res.row;
      const sender = cleanFrom(r.lastReplyFrom);
      return [
        ...orig,
        res.matched,
        res.confidence,
        statusText(r),
        summaryText(r),
        r.messageCount,
        r.onboardingManager || "",
        r.onboardingManagerEmail || "",
        sender.name,
        sender.email,
        r.lastReplyRole || (r.lastReplyIsInternal ? "GoKwik (Other)" : "Merchant"),
        r.lastReplyAt ? format(new Date(r.lastReplyAt), "dd MMM yyyy HH:mm") : "",
        r.ageingDays ?? "",
        r.lastReplyIsInternal ? "Yes" : "No",
        r.url,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([outHeaders, ...outRows]);
    // Reasonable column widths
    ws["!cols"] = outHeaders.map((h) => ({ wch: Math.min(Math.max(h.length + 2, 14), 50) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Matched");
    const base = fileName.replace(/\.(csv|xlsx|xls)$/i, "") || "accounts";
    XLSX.writeFile(wb, `${base}-shopify-lt-matched-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const matchedCount = results?.filter((r) => r.matched).length ?? 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => {
        reset();
        // Allow a fresh inbox scan on each open so a previous failed/truncated scan can be retried
        poolPromise.current = null;
        setPoolRows(null);
        setPoolFailed(false);
        setOpen(true);
      }}>
        <FileSpreadsheet className="h-4 w-4 mr-2" />
        Match Sheet (AI)
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Map Your Sheet to Email Comms Data
            </DialogTitle>
            <DialogDescription>
              Upload a sheet with an <b>Account Name</b> column. Each account is matched against every
              thread in the entire inbox (no days bucket, already-live accounts included and mapped to <b>Live</b>)
              {poolFailed ? " (full inbox scan unavailable — using the threads loaded in the table; close and reopen to retry)" : poolRows ? ` (${poolRows.length} threads loaded)` : poolLoading ? " (loading all threads…)" : ""},
              and the sheet is returned with all comms columns filled in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 min-h-0">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={matching}>
                <Upload className="h-4 w-4 mr-2" />
                {fileName ? "Change file" : "Upload sheet (.xlsx / .csv)"}
              </Button>
              {fileName && <span className="text-sm text-muted-foreground truncate max-w-[240px]">{fileName}</span>}
              {headers.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">Account column:</span>
                  <Select value={String(accountCol)} onValueChange={(v) => { setAccountCol(Number(v)); setResults(null); }}>
                    <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>{h || `Column ${i + 1}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {!fileName && (
              <div
                className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <FileSpreadsheet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to upload your tracker sheet</p>
                <p className="text-xs text-muted-foreground mt-1">Must contain an "Account Name" column</p>
              </div>
            )}

            {fileName && !results && !matching && (
              <p className="text-sm text-muted-foreground">
                {sheetRows.length} data rows found. Click <b>Run AI Match</b> below to map accounts.
              </p>
            )}

            {matching && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Matching accounts with AI…</p>
              </div>
            )}

            {results && !matching && (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <Badge variant="secondary">{matchedCount}/{results.length} matched</Badge>
                  {aiUsed && <Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" /> AI matching used</Badge>}
                </div>
                <ScrollArea className="h-[40vh] max-h-[420px] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead>Matched Merchant</TableHead>
                        <TableHead>Match</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ageing</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((res, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm font-medium">{res.account || "—"}</TableCell>
                          <TableCell className="text-sm">{res.matched || "—"}</TableCell>
                          <TableCell>
                            {res.matched ? (
                              <Badge variant="outline" className="gap-1 text-success-strong border-success/30">
                                <CheckCircle2 className="h-3 w-3" /> {res.confidence}
                              </Badge>
                            ) : res.account ? (
                              <Badge variant="outline" className="gap-1 text-muted-foreground">
                                <XCircle className="h-3 w-3" /> No match
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-warning-strong border-warning/30">
                                <AlertCircle className="h-3 w-3" /> Blank
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                            {res.row ? (
                              res.row.isLive ? (
                                <Badge variant="outline" className="text-success-strong border-success/30">Live</Badge>
                              ) : (
                                statusText(res.row)
                              )
                            ) : ""}
                          </TableCell>
                          <TableCell className="text-xs">{res.row?.ageingDays ?? ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            {fileName && !results && (
              <Button onClick={runMatching} disabled={matching || accountCol < 0}>
                <Sparkles className="h-4 w-4 mr-2" />
                Run AI Match
              </Button>
            )}
            {results && (
              <>
                <Button variant="secondary" onClick={() => { setResults(null); runMatching(); }} disabled={matching}>
                  Re-run
                </Button>
                <Button onClick={download} disabled={matching}>
                  <Download className="h-4 w-4 mr-2" />
                  Download Matched Sheet
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
