import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tenantScope } from "@/lib/tenant-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Search, Eye } from "lucide-react";

interface VisitRow {
  id: string;
  project_id: string;
  email: string;
  page: string;
  visited_at: string;
  user_agent: string | null;
}

interface ProjectMini { id: string; merchant_name: string; mid: string | null }

const PAGE_LABEL: Record<string, string> = {
  login: "Login",
  integration: "My Integration",
  credentials: "Credentials",
  documents: "Documents",
  kwikpass: "KwikPass",
  faq: "FAQ & Help",
  validator: "Merchant Validator",
};

export function PortalVisitsReport() {
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [projects, setProjects] = useState<Record<string, ProjectMini>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");

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

  const filtered = useMemo(() => {
    return visits.filter(v => {
      if (projectFilter !== "all" && v.project_id !== projectFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const merchant = projects[v.project_id]?.merchant_name?.toLowerCase() || "";
        if (!v.email.toLowerCase().includes(s) && !merchant.includes(s) && !v.page.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [visits, search, projectFilter, projects]);

  const projectOptions = useMemo(() => {
    const ids = Array.from(new Set(visits.map(v => v.project_id)));
    return ids.map(id => ({ id, name: projects[id]?.merchant_name || id.slice(0, 8) }));
  }, [visits, projects]);

  const exportCsv = () => {
    const header = ["Visited At", "Email", "Merchant", "MID", "Page"];
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
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="portal-heading flex items-center gap-2"><Eye className="w-4 h-4" /> Merchant Portal Visits</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email, merchant, page..." className="pl-8 h-9 w-64" />
            </div>
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="all">All projects</option>
              {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-3.5 h-3.5 mr-1" /> Export</Button>
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
                    <th className="px-3 py-2 font-medium">Merchant</th>
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
