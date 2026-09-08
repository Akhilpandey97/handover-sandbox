import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Pencil, Server, Upload, Download, FileSpreadsheet, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { arrToCrore, arrCroreValue } from "@/lib/arr";

const PLATFORMS = ["Aasaan", "Zoho", "Shoppachino", "Shoopy", "Zen Zen", "Tradexa"] as const;
type Platform = typeof PLATFORMS[number];

const PLATFORM_ALIASES: Record<string, Platform> = {
  aasaan: "Aasaan",
  asaan: "Aasaan",
  zoho: "Zoho",
  shoppachino: "Shoppachino",
  shopachino: "Shoppachino",
  shoopy: "Shoopy",
  "zen zen": "Zen Zen",
  zenzen: "Zen Zen",
  tradexa: "Tradexa",
};

type Status = "live" | "inprogress" | "blocked";
const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "inprogress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
];

const statusStyles: Record<Status, string> = {
  live: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  inprogress: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  blocked: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
};

interface PlatformMerchant {
  id: string;
  tenant_id: string;
  platform: string;
  merchant_name: string;
  status: Status;
  arr: number | null;
  go_live_date: string | null;
  notes: string | null;
  owner_id: string | null;
  csm_id: string | null;
  brand_poc_name: string | null;
  brand_poc_emails: string[] | null;
  platform_poc_emails: string[] | null;
  login_email: string | null;
  temp_password: string | null;
  welcome_email_sent_at: string | null;
  created_at: string;
}

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

interface FormState {
  id?: string;
  platform: Platform;
  merchant_name: string;
  status: Status;
  arr: string;
  go_live_date: string;
  notes: string;
  owner_id: string;
  csm_id: string;
  brand_poc_name: string;
  brand_poc_emails: string[];
  platform_poc_emails: string[];
  login_email: string;
  temp_password: string;
  previousStatus?: Status;
}

const DEFAULT_TEMP_PASSWORD = "Please reset your password using : https://dashboard.gokwik.co/forgot-password";

const PLATFORM_DEFAULT_CC: Partial<Record<Platform, string[]>> = {
  Aasaan: [
    "pramod@aasaan.app",
    "murali@aasaan.app",
    "akhil.pandey@gokwik.co",
    "rishabh.jain1@gokwik.co",
    "nishant@gokwik.co",
    "lavpratap.singh@gokwik.co",
    "ritik.arora@gokwik.co",
  ],
  Shoopy: [
    "indar@shoopy.in",
    "akhil.pandey@gokwik.co",
    "nishant@gokwik.co",
    "ritik.arora@gokwik.co",
    "rahul.kumar1@gokwik.co",
    "animisha.parmar@gokwik.co",
  ],
};

// Default Owner / CSM per platform (auto-assigned)
const PLATFORM_TEAM: Partial<Record<Platform, { owner?: string; csm?: string }>> = {
  Aasaan: { owner: "rishabh.jain1@gokwik.co", csm: "lavpratap.singh@gokwik.co" },
  Zoho: { owner: "abhishek.yadav@gokwik.co", csm: "ritik.arora@gokwik.co" },
  Shoppachino: { owner: "piyush.shastri@gokwik.co", csm: "animisha.parmar@gokwik.co" },
  Shoopy: { owner: "rahul.kumar1@gokwik.co", csm: "animisha.parmar@gokwik.co" },
  "Zen Zen": { owner: "abhishek.yadav@gokwik.co", csm: "lavpratap.singh@gokwik.co" },
  Tradexa: { owner: "animisha.parmar@gokwik.co", csm: "animisha.parmar@gokwik.co" },
};

const mergeCC = (platform: Platform, existing: string[] = []): string[] => {
  const defaults = PLATFORM_DEFAULT_CC[platform] || [];
  return Array.from(new Set([...defaults, ...existing]));
};

const blankForm = (platform: Platform = "Aasaan"): FormState => ({
  platform,
  merchant_name: "",
  status: "inprogress",
  arr: "",
  go_live_date: "",
  notes: "",
  owner_id: "",
  csm_id: "",
  brand_poc_name: "",
  brand_poc_emails: [],
  platform_poc_emails: mergeCC(platform),
  login_email: "",
  temp_password: DEFAULT_TEMP_PASSWORD,
});


const EmailListInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) => {
  const [input, setInput] = useState("");
  const commit = () => {
    const parts = input
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    if (parts.length === 0) return;
    const next = Array.from(new Set([...value, ...parts]));
    onChange(next);
    setInput("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {value.map((email) => (
          <Badge key={email} variant="secondary" className="gap-1 pr-1">
            {email}
            <button
              type="button"
              className="ml-1 rounded hover:bg-muted-foreground/20 px-1"
              onClick={() => onChange(value.filter((e) => e !== email))}
            >
              ×
            </button>
          </Badge>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No emails added</span>
        )}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={placeholder || "email@example.com"}
      />
    </div>
  );
};

export const PlatformMerchants = () => {
  const { currentUser } = useAuth();
  const isReadOnly = currentUser?.team === "gokwik_general";

  const [merchants, setMerchants] = useState<PlatformMerchant[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePlatform, setActivePlatform] = useState<Platform | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const syncGoLiveEmails = async () => {
    setSyncing(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", currentUser?.id || "")
        .maybeSingle();
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/public/poll-platform-golive-emails`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sess?.session?.access_token}`,
            apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6c3BscnpmZXBlemNwZnZ1aXlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NzQyMDIsImV4cCI6MjA4NTA1MDIwMn0.bXy1DDXZ7IMu8gIxKlpjs0rF8QrKZ4bC2pEXkHapNTk",
          },
          body: JSON.stringify({ tenant_id: profile?.tenant_id, lookback_days: 7 }),
        }
      );
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Sync failed");
      toast.success(out.message || "Synced");
      fetchMerchants();
    } catch (e: any) {
      toast.error(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };


  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email")
      .order("name", { ascending: true });
    if (!error) {
      setUsers((data || []) as UserProfile[]);
    }
  };

  const fetchMerchants = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_merchants")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load platform merchants");
    } else {
      setMerchants((data || []) as PlatformMerchant[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMerchants();
    fetchUsers();
  }, []);

  const grouped = useMemo(() => {
    const g: Record<string, PlatformMerchant[]> = {};
    PLATFORMS.forEach(p => (g[p] = []));
    merchants.forEach(m => {
      if (!g[m.platform]) g[m.platform] = [];
      g[m.platform].push(m);
    });
    return g;
  }, [merchants]);

  const visibleMerchants = activePlatform === "all"
    ? merchants
    : merchants.filter(m => m.platform === activePlatform);

  const teamIdsFor = (platform: Platform) => {
    const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u.id]));
    const t = PLATFORM_TEAM[platform];
    if (!t) return { owner_id: "", csm_id: "" };
    return {
      owner_id: (t.owner && byEmail.get(t.owner)) || "",
      csm_id: (t.csm && byEmail.get(t.csm)) || "",
    };
  };

  const openAdd = (platform?: Platform) => {
    const plat = platform || (activePlatform !== "all" ? activePlatform : "Aasaan");
    setForm({ ...blankForm(plat), ...teamIdsFor(plat) });
    setDialogOpen(true);
  };

  const openEdit = (m: PlatformMerchant) => {
    setForm({
      id: m.id,
      platform: m.platform as Platform,
      merchant_name: m.merchant_name,
      status: m.status,
      arr: m.arr != null ? String(m.arr) : "",
      go_live_date: m.go_live_date || "",
      notes: m.notes || "",
      owner_id: m.owner_id || "",
      csm_id: m.csm_id || "",
      brand_poc_name: m.brand_poc_name || m.merchant_name || "",
      brand_poc_emails: m.brand_poc_emails || [],
      platform_poc_emails: mergeCC(m.platform as Platform, m.platform_poc_emails || []),
      login_email: m.login_email || "",
      temp_password: DEFAULT_TEMP_PASSWORD,
      previousStatus: m.status,

    });
    setDialogOpen(true);
  };

  const sendWelcomeEmail = async (merchantId: string, payload: any) => {
    if (!payload.brand_poc_emails?.length) {
      toast.warning("Marked Live, but no Brand POC email set — welcome email not sent.");
      return;
    }
    try {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess?.session?.access_token;
      const url = `/api/public/send-platform-welcome`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6c3BscnpmZXBlemNwZnZ1aXlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NzQyMDIsImV4cCI6MjA4NTA1MDIwMn0.bXy1DDXZ7IMu8gIxKlpjs0rF8QrKZ4bC2pEXkHapNTk",
        },
        body: JSON.stringify({
          brandName: payload.brand_name || payload.merchant_name,
          brandPocName: payload.brand_poc_name,
          brandPocEmails: payload.brand_poc_emails,
          platformPocEmails: payload.platform_poc_emails,
          csmEmail: payload.csm_email,
          loginEmail: payload.login_email,
          tempPassword: payload.temp_password,
          senderName: currentUser?.name,
          senderMobile: "",
        }),

      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Email send failed");
      }
      await supabase.from("platform_merchants").update({ welcome_email_sent_at: new Date().toISOString() }).eq("id", merchantId);
      toast.success(`Welcome email sent to ${payload.brand_poc_emails.join(", ")}`);
    } catch (e: any) {
      toast.error(`Welcome email failed: ${e.message}`);
    }
  };

  const save = async () => {
    if (!form.merchant_name.trim()) {
      toast.error("Merchant name is required");
      return;
    }
    setSaving(true);
    const payload = {
      platform: form.platform,
      merchant_name: form.merchant_name.trim(),
      status: form.status,
      arr: form.arr ? parseFloat(form.arr) : null,
      go_live_date: form.go_live_date || null,
      notes: form.notes.trim() || null,
      owner_id: form.owner_id || null,
      csm_id: form.csm_id || null,
      brand_poc_name: (form.brand_poc_name.trim() || form.merchant_name.trim()) || null,
      brand_poc_emails: form.brand_poc_emails,
      platform_poc_emails: form.platform_poc_emails,
      login_email: form.login_email.trim() || null,
      temp_password: form.temp_password.trim() || null,

    };
    let error;
    let savedId = form.id;
    if (form.id) {
      ({ error } = await supabase.from("platform_merchants").update(payload).eq("id", form.id));
    } else {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", currentUser?.id || "")
        .maybeSingle();
      const { data: inserted, error: insErr } = await supabase
        .from("platform_merchants")
        .insert({
          ...payload,
          tenant_id: profile?.tenant_id as string,
          created_by: currentUser?.id,
        })
        .select("id")
        .single();
      error = insErr;
      savedId = inserted?.id;
    }
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(form.id ? "Merchant updated" : "Merchant added");

    setDialogOpen(false);
    fetchMerchants();
  };


  const remove = async (id: string) => {
    if (!confirm("Delete this platform merchant?")) return;
    const { error } = await supabase.from("platform_merchants").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Merchant deleted");
    fetchMerchants();
  };

  const downloadSample = () => {
    const csv = "platform,merchant_name,status,arr,go_live_date,owner_email,csm_email,notes\nAasaan,Sample Merchant 1,inprogress,0.25,2026-07-15,owner@example.com,csm@example.com,Sample note\nZoho,Sample Merchant 2,live,0.50,2026-03-01,,,\nShoopy,Sample Merchant 3,blocked,0.10,,,,Blocked on integration\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "platform-merchants-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      toast.error("CSV is empty");
      return;
    }
    const parseRow = (line: string): string[] => {
      const out: string[] = [];
      let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
        else if (c === "," && !inQ) { out.push(cur); cur = ""; }
        else cur += c;
      }
      out.push(cur);
      return out;
    };
    const headers = parseRow(lines[0]).map(h => h.trim().toLowerCase());
    const idx = (k: string) => headers.indexOf(k);
    const iPlat = idx("platform"), iName = idx("merchant_name"), iStat = idx("status"),
      iArr = idx("arr"), iDate = idx("go_live_date"), iOwner = idx("owner_email"), iCsm = idx("csm_email"), iNotes = idx("notes");
    if (iPlat < 0 || iName < 0) {
      toast.error("Missing required columns: platform, merchant_name");
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", currentUser?.id || "").maybeSingle();
    const usersByEmail = new Map(users.map(u => [u.email.toLowerCase(), u.id]));
    const rows: any[] = [];
    const errors: string[] = [];
    for (let r = 1; r < lines.length; r++) {
      const cols = parseRow(lines[r]);
      const pRaw = (cols[iPlat] || "").trim();
      const platform = PLATFORM_ALIASES[pRaw.toLowerCase()] || (PLATFORMS as readonly string[]).find(p => p.toLowerCase() === pRaw.toLowerCase());
      const name = (cols[iName] || "").trim();
      if (!platform || !name) { errors.push(`Row ${r+1}: invalid platform/name`); continue; }
      const statRaw = (iStat >= 0 ? cols[iStat] : "").trim().toLowerCase().replace(/\s+/g, "");
      const status: Status = statRaw === "live" ? "live" : statRaw === "blocked" ? "blocked" : "inprogress";
      const arr = iArr >= 0 && cols[iArr]?.trim() ? parseFloat(cols[iArr]) : null;
      const ownerEmail = iOwner >= 0 ? (cols[iOwner] || "").trim().toLowerCase() : "";
      const owner_id = ownerEmail ? (usersByEmail.get(ownerEmail) || null) : null;
      const csmEmail = iCsm >= 0 ? (cols[iCsm] || "").trim().toLowerCase() : "";
      const csm_id = csmEmail ? (usersByEmail.get(csmEmail) || null) : null;
      rows.push({
        platform,
        merchant_name: name,
        status,
        arr: Number.isFinite(arr as number) ? arr : null,
        go_live_date: iDate >= 0 && cols[iDate]?.trim() ? cols[iDate].trim() : null,
        notes: iNotes >= 0 && cols[iNotes]?.trim() ? cols[iNotes].trim() : null,
        owner_id,
        csm_id,
        tenant_id: profile?.tenant_id,
        created_by: currentUser?.id,
      });
    }
    if (rows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }
    const { error } = await supabase.from("platform_merchants").insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success(`Imported ${rows.length} merchant(s)${errors.length ? `, ${errors.length} skipped` : ""}`);
    fetchMerchants();
  };

  const exportToExcel = () => {
    const data = visibleMerchants.map(m => ({
      "Merchant": m.merchant_name,
      "Platform": m.platform,
      "Status": STATUS_OPTIONS.find(s => s.value === m.status)?.label || m.status,
      "Owner": users.find(u => u.id === m.owner_id)?.name || "",
      "CSM": users.find(u => u.id === m.csm_id)?.name || "",
      "ARR (Cr)": m.arr != null ? arrCroreValue(m.arr) : "",
      "Go-Live Date": m.go_live_date || "",
      "Notes": m.notes || "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Platform Merchants");
    XLSX.writeFile(wb, "platform-merchants.xlsx");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" /> Platform Merchants
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tracked separately from main projects — across {PLATFORMS.join(", ")}.
          </p>
        </div>
        {!isReadOnly && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={syncGoLiveEmails} disabled={syncing}>
              <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} /> Sync Go-Live Emails
            </Button>
            <Button variant="outline" size="sm" onClick={exportToExcel}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Excel
            </Button>

            <Button variant="outline" size="sm" onClick={downloadSample}>
              <Download className="h-4 w-4 mr-2" /> Sample CSV
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="h-4 w-4 mr-2" /> Import
                <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
              </label>
            </Button>
            <Button onClick={() => openAdd()}>
              <Plus className="h-4 w-4 mr-2" /> Add Platform Merchant
            </Button>
          </div>
        )}
      </div>

      {/* Platform tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActivePlatform("all")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
            activePlatform === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted border-border"
          )}
        >
          All ({merchants.length})
        </button>
        {PLATFORMS.map(p => (
          <button
            key={p}
            onClick={() => setActivePlatform(p)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
              activePlatform === p ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted border-border"
            )}
          >
            {p} ({grouped[p]?.length || 0})
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {PLATFORMS.map(p => {
          const list = grouped[p] || [];
          const liveList = list.filter(m => m.status === "live");
          const liveArr = liveList.reduce((sum, m) => sum + arrToCrore(Number(m.arr) || 0), 0);
          return (
            <Card key={p} className="cursor-pointer hover:border-primary/40" onClick={() => setActivePlatform(p)}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{p}</p>
                <p className="text-2xl font-bold mt-1">{list.length}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{liveList.length} live</p>
                <p className="text-xs font-medium text-foreground mt-1">Live ARR: ₹{liveArr.toFixed(2)} Cr</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="portal-heading">
            {activePlatform === "all" ? "All Platform Merchants" : `${activePlatform} Merchants`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : visibleMerchants.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No platform merchants yet.</p>
              {!isReadOnly && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => openAdd()}>
                  <Plus className="h-4 w-4 mr-2" /> Add First Merchant
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>CSM</TableHead>
                  <TableHead>ARR (Cr)</TableHead>
                  <TableHead>Go-Live Date</TableHead>
                  <TableHead>Notes</TableHead>
                  {!isReadOnly && <TableHead className="w-24 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleMerchants.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.merchant_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.platform}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={cn("px-2 py-0.5 text-xs font-medium rounded-md border", statusStyles[m.status])}>
                        {STATUS_OPTIONS.find(s => s.value === m.status)?.label || m.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {users.find(u => u.id === m.owner_id)?.name || "—"}
                    </TableCell>
                    <TableCell>
                      {users.find(u => u.id === m.csm_id)?.name || "—"}
                    </TableCell>
                    <TableCell>{m.arr != null ? arrCroreValue(m.arr) : "—"}</TableCell>
                    <TableCell>{m.go_live_date || "—"}</TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">{m.notes || "—"}</TableCell>
                    {!isReadOnly && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={m.brand_poc_emails?.length ? "Send Go-Live Email" : "Add a Brand POC email first"}
                          disabled={!m.brand_poc_emails?.length}
                          onClick={() => sendWelcomeEmail(m.id, {
                            brand_name: m.merchant_name,
                            merchant_name: m.merchant_name,
                            brand_poc_name: m.brand_poc_name || m.merchant_name,
                            brand_poc_emails: m.brand_poc_emails || [],
                            platform_poc_emails: mergeCC(m.platform as Platform, m.platform_poc_emails || []),
                            csm_email: users.find(u => u.id === m.csm_id)?.email || "",
                            login_email: m.login_email,
                            temp_password: m.temp_password || DEFAULT_TEMP_PASSWORD,
                            platform: m.platform,
                          })}
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(m.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit" : "Add"} Platform Merchant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Platform</Label>
                <Select value={form.platform} onValueChange={(v) => {
                  const newPlat = v as Platform;
                  const defaults = PLATFORM_DEFAULT_CC[newPlat] || [];
                  const prevDefaults = PLATFORM_DEFAULT_CC[form.platform] || [];
                  // remove old platform's defaults, then merge new ones
                  const cleaned = form.platform_poc_emails.filter(e => !prevDefaults.includes(e));
                  setForm({ ...form, platform: newPlat, ...teamIdsFor(newPlat), platform_poc_emails: Array.from(new Set([...defaults, ...cleaned])) });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Status })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Merchant Name *</Label>
              <Input value={form.merchant_name} onChange={(e) => {
                const name = e.target.value;
                setForm(prev => ({
                  ...prev,
                  merchant_name: name,
                  // auto-fill brand POC name if it was empty or matched the previous merchant name
                  brand_poc_name: (!prev.brand_poc_name || prev.brand_poc_name === prev.merchant_name) ? name : prev.brand_poc_name,
                }));
              }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Owner</Label>
                <Select
                  value={form.owner_id || "__none__"}
                  onValueChange={(v) => setForm({ ...form, owner_id: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>CSM</Label>
                <Select
                  value={form.csm_id || "__none__"}
                  onValueChange={(v) => setForm({ ...form, csm_id: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select CSM" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>ARR (Cr)</Label>
                <Input type="number" step="0.01" value={form.arr} onChange={(e) => setForm({ ...form, arr: e.target.value })} placeholder="e.g. 0.50" />
              </div>
              <div>
                <Label>Go-Live Date</Label>
                <DatePickerField value={form.go_live_date} onChange={(v) => setForm({ ...form, go_live_date: v })} />
              </div>
            </div>
            <div>
              <Label>Brand POC Name</Label>
              <Input
                value={form.brand_poc_name}
                onChange={(e) => setForm({ ...form, brand_poc_name: e.target.value })}
                placeholder="e.g. Priya Sharma"
              />
            </div>
            <div>
              <Label>Brand POC Emails (To)</Label>
              <EmailListInput
                value={form.brand_poc_emails}
                onChange={(v) => setForm({ ...form, brand_poc_emails: v })}
                placeholder="brand-poc@example.com, press Enter"
              />
            </div>
            <div>
              <Label>Platform POC Emails (CC)</Label>
              <EmailListInput
                value={form.platform_poc_emails}
                onChange={(v) => setForm({ ...form, platform_poc_emails: v })}
                placeholder="platform-poc@example.com, press Enter"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Login Email</Label>
                <Input
                  type="email"
                  value={form.login_email}
                  onChange={(e) => setForm({ ...form, login_email: e.target.value })}
                  placeholder="merchant@brand.com"
                />
              </div>
              <div>
                <Label>Temporary Password</Label>
                <Input
                  type="text"
                  value={DEFAULT_TEMP_PASSWORD}
                  readOnly
                  className="bg-muted"
                />
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
