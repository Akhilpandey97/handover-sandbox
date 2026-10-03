import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { tenantScope } from "@/lib/tenant-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Search, Eye, CalendarRange } from "lucide-react";

interface VisitRow {
  id: string;
  project_id: string;
  email: string;
  page: string;
  visited_at: string;
  user_agent: string | null;
}

interface ProjectMini { id: string; merchant_name: string; mid: string | null }

type RangeKey = "7" | "30" | "90" | "all" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const PAGE_LABEL: Record<string, string> = {
  login: "Login",
  integration: "My Integration",
  credentials: "Credentials",
  documents: "Documents",
  kwikpass: "KwikPass",
  faq: "FAQ & Help",
  validator: "Validator",
};

export function PortalVisitsReport() {
  const { currentUser } = useAuth();
  const { getLabel } = useLabels();
  const merchantLabel = getLabel("field_merchant_name");
  const tenantId = tenantScope(currentUser?.tenantId);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [projects, setProjects] = useState<Record<string, ProjectMini>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<RangeKey>("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pageFilter, setPageFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: v } = await supabase
        .from("merchant_portal_visits")
        .select("id, project_id, email, page, visited_at, user_agent")
        .eq("tenant_id", tenantId)
        .order("visited_at", { ascending: false })
        .limit(2000);
      const rows = (v || []) as VisitRow[];
      setVisits(rows);
      const ids = Array.from(new Set(rows.map(r => r.project_id)));
      if (ids.length) {
        const { data: p } = await supabase
          .from("projects").select("id, merchant_name, mid").in("id", ids);
        const map: Record<string, ProjectMini> = {};
        (p || []).forEach((x: any) => { map[x.id] = x; });
        setProjects(map);
      }
      setLoading(false);
    })();
  }, [tenantId]);

  // The window the range picker describes, as [start, end) in epoch ms.
  const bounds = useMemo(() => {
    if (range === "custom") {
      return {
        start: from ? new Date(`${from}T00:00:00`).getTime() : null,
        end: to ? new Date(`${to}T23:59:59.999`).getTime() : null,
      };
    }
    if (range === "all") return { start: null, end: null };
    const days = Number(range);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    return { start: start.getTime(), end: null };
  }, [range, from, to]);

  const filtered = useMemo(() => {
    return visits.filter(v => {
      const at = new Date(v.visited_at).getTime();
      if (bounds.start !== null && at < bounds.start) return false;
      if (bounds.end !== null && at > bounds.end) return false;
      if (pageFilter !== "all" && v.page !== pageFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const merchant = projects[v.project_id]?.merchant_name?.toLowerCase() || "";
        if (!v.email.toLowerCase().includes(s) && !merchant.includes(s) && !v.page.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [visits, search, pageFilter, bounds, projects]);

  const pageOptions = useMemo(
    () => Array.from(new Set(visits.map(v => v.page))).sort(),
    [visits],
  );

  // What the numbers under the filters describe: how much of the traffic in this
  // window came from distinct people and distinct merchants.
  const summary = useMemo(() => ({
    visits: filtered.length,
    people: new Set(filtered.map(v => v.email.toLowerCase())).size,
    merchants: new Set(filtered.map(v => v.project_id)).size,
  }), [filtered]);

  const exportCsv = () => {
    const header = ["Visited At", "Email", merchantLabel, getLabel("field_mid"), "Page"];
    const rows = filtered.map(v => [
      new Date(v.visited_at).toISOString(),
      v.email,
      projects[v.project_id]?.merchant_name || "",
      projects[v.project_id]?.mid || "",
      PAGE_LABEL[v.page] || v.page,
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `portal-visits-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="portal-heading flex items-center gap-2"><Eye className="w-4 h-4" /> {merchantLabel} Portal Visits</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email, merchant, page..." className="pl-8 h-9 w-64" />
              </div>
              <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-3.5 h-3.5 mr-1" /> Export</Button>
            </div>
          </div>

          {/* When, and which page — the two questions this report gets asked. */}
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="flex items-center gap-1" role="group" aria-label="Date range">
              {RANGES.map(({ key, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={range === key ? "default" : "outline"}
                  className="h-8 px-2.5 text-xs"
                  onClick={() => setRange(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {range === "custom" && (
              <div className="flex items-center gap-1.5">
                <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36 text-xs" aria-label="From date" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-36 text-xs" aria-label="To date" />
              </div>
            )}
            <select
              value={pageFilter}
              onChange={(e) => setPageFilter(e.target.value)}
              aria-label="Page"
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="all">All pages</option>
              {pageOptions.map(p => <option key={p} value={p}>{PAGE_LABEL[p] || p}</option>)}
            </select>
            <span className="ml-auto text-xs text-muted-foreground">
              {summary.visits} visits · {summary.people} people · {summary.merchants} {merchantLabel.toLowerCase()}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No portal visits recorded yet.</div>
          ) : (
            <div className="overflow-auto max-h-[600px] border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Visited At</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">{merchantLabel}</th>
                    <th className="px-3 py-2 font-medium">Page</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(v => (
                    <tr key={v.id} className="border-t hover:bg-muted/40">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(v.visited_at).toLocaleString()}</td>
                      <td className="px-3 py-2 font-medium">{v.email}</td>
                      <td className="px-3 py-2">{projects[v.project_id]?.merchant_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2"><Badge variant="secondary">{PAGE_LABEL[v.page] || v.page}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
