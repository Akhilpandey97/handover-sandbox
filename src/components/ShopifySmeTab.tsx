import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { tenantScope } from "@/lib/tenant-scope";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShoppingBag, RefreshCw, Eye, X, Loader2, Inbox, UserPlus } from "lucide-react";
import { format } from "date-fns";
import { apiAuthHeaders } from "@/lib/api-invoke";

interface SmeRow {
  id: string;
  gmail_message_id: string;
  subject: string;
  sender: string;
  received_at: string;
  brand_name: string | null;
  merchant_poc_name: string | null;
  merchant_email: string | null;
  merchant_contact: string | null;
  shopify_url: string | null;
  website_url: string | null;
  platform: string | null;
  sub_platform: string | null;
  expected_arr: number | null;
  category: string | null;
  txns_per_day: number | null;
  aov: number | null;
  merchant_size: string | null;
  city: string | null;
  rto_refund_amount: number | null;
  rto_coverage_pct: number | null;
  mg_sheet_link: string | null;
  commercials: Record<string, string | number> | null;
  notes: string | null;
  merchant_id_ext: string | null;
  merchant_id_text: string | null;
  parsed_fields: Record<string, string> | null;
  status: string;
  created_at: string;
  assigned_owner_email: string | null;
}

const OWNER_OPTIONS = [
  "ankit@gokwik.co",
  "rohit.singh@gokwik.co",
  "deepak.sharma@gokwik.co",
];

const statusColors: Record<string, string> = {
  new: "bg-info/10 text-info-strong border-info/30",
  reviewed: "bg-warning/10 text-warning-strong border-warning/30",
  dismissed: "bg-muted text-muted-foreground border-muted",
};

export const ShopifySmeTab = () => {
  const { currentUser } = useAuth();
  const [rows, setRows] = useState<SmeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [selected, setSelected] = useState<SmeRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("shopify_sme_merchants")
      .select("*")
      .eq("tenant_id", tenantScope(currentUser?.tenantId))
      .order("received_at", { ascending: false });
    if (!error && data) setRows(data as unknown as SmeRow[]);
    setLoading(false);
  }, [currentUser?.tenantId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handlePoll = async () => {
    if (!currentUser?.tenantId) { toast.error("No tenant context available"); return; }
    setPolling(true);
    try {
      const url = `/api/public/poll-shopify-sme-emails`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await apiAuthHeaders()),
        },
        body: JSON.stringify({ tenant_id: currentUser.tenantId }),
      });
      const data = await res.json();
      if (res.ok) { toast.success(data.message || "Poll complete"); await fetchRows(); }
      else toast.error(data.error || "Failed to poll");
    } catch (err: any) {
      toast.error(err.message || "Failed to poll");
    } finally { setPolling(false); }
  };

  const handleDismiss = async (id: string) => {
    await supabase.from("shopify_sme_merchants").update({ status: "dismissed" }).eq("id", id);
    toast.info("Merchant dismissed");
    fetchRows();
  };

  const handleAssign = async (id: string, owner_email: string) => {
    setAssigningId(id);
    try {
      const url = `/api/public/assign-shopify-sme-owner`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await apiAuthHeaders()),
        },
        body: JSON.stringify({ id, owner_email }),
      });
      const data = await res.json();
      if (res.ok) { toast.success(data.message || "Owner assigned"); await fetchRows(); }
      else toast.error(data.error || "Failed to assign");
    } catch (err: any) {
      toast.error(err.message || "Failed to assign");
    } finally { setAssigningId(null); }
  };

  const newCount = rows.filter(r => r.status === "new").length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5" />
                Shopify SME and Ent Merchants
                {newCount > 0 && <Badge variant="destructive" className="ml-2">{newCount} new</Badge>}
              </CardTitle>
              <CardDescription>
                Merchants ingested from "New Brand On Board – &lt;Merchant&gt; – Store Front" emails where Merchant Size = SME. Stored separately from projects.
              </CardDescription>
            </div>
            <Button onClick={handlePoll} disabled={polling} size="sm" className="gap-1.5">
              {polling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {polling ? "Polling..." : "Poll Gmail"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Inbox className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">No merchants yet.</p>
              <p className="text-sm text-muted-foreground/70">Click "Poll Gmail" to fetch matching onboarding emails.</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">Status</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Merchant POC</TableHead>
                    <TableHead>Shopify URL</TableHead>
                    <TableHead className="text-right">ARR</TableHead>
                    <TableHead className="text-right">Txns/Day</TableHead>
                    <TableHead className="text-right">AOV</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead className="w-[200px]">Owner</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id} className={r.status === "new" ? "bg-info/5" : ""}>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[r.status] || ""}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {r.brand_name || "—"}
                        {r.city && <span className="text-xs text-muted-foreground ml-1">({r.city})</span>}
                      </TableCell>
                      <TableCell>
                        {r.merchant_size ? (
                          <Badge variant="outline" className="text-xs">{r.merchant_size}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.merchant_poc_name || "—"}</div>
                        {r.merchant_email && <div className="text-xs text-muted-foreground">{r.merchant_email}</div>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.shopify_url ? (
                          <a href={`https://${r.shopify_url.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            {r.shopify_url}
                          </a>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.expected_arr ? `₹${(r.expected_arr / 100000).toFixed(1)}L` : "—"}
                      </TableCell>
                      <TableCell className="text-right">{r.txns_per_day || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.aov ? `₹${Number(r.aov).toFixed(0)}` : "—"}
                      </TableCell>
                      <TableCell>{r.category || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(r.received_at), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={r.assigned_owner_email || ""}
                          onValueChange={(v) => handleAssign(r.id, v)}
                          disabled={assigningId === r.id}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            {assigningId === r.id ? (
                              <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Assigning...</span>
                            ) : (
                              <SelectValue placeholder="Assign owner" />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {OWNER_OPTIONS.map((email) => (
                              <SelectItem key={email} value={email} className="text-xs">{email}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => { setSelected(r); setDetailOpen(true); }}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {r.status === "new" && (
                            <Button variant="ghost" size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDismiss(r.id)} title="Dismiss">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              {selected?.brand_name || "Merchant Details"}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <ScrollArea className="max-h-[70vh] pr-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Merchant POC" value={selected.merchant_poc_name} />
                  <Field label="Email" value={selected.merchant_email} />
                  <Field label="Contact" value={selected.merchant_contact} />
                  <Field label="City" value={selected.city} />
                  <Field label="Shopify URL" value={selected.shopify_url} />
                  <Field label="Website" value={selected.website_url} />
                  <Field label="Platform" value={selected.platform} />
                  <Field label="Sub Platform" value={selected.sub_platform} />
                  <Field label="Expected ARR" value={selected.expected_arr ? `₹${selected.expected_arr.toLocaleString()}` : null} />
                  <Field label="Category" value={selected.category} />
                  <Field label="Txns/Day" value={selected.txns_per_day} />
                  <Field label="AOV" value={selected.aov ? `₹${Number(selected.aov).toFixed(0)}` : null} />
                  <Field label="RTO Refund Amount" value={selected.rto_refund_amount} />
                  <Field label="RTO Coverage %" value={selected.rto_coverage_pct} />
                  <Field label="Merchant Size" value={selected.merchant_size} />
                  <Field label="Merchant ID" value={selected.merchant_id_ext} />
                  <Field label="Merchant Id Text" value={selected.merchant_id_text} />
                  <Field label="MG Sheet" value={selected.mg_sheet_link} link />
                </div>

                {selected.commercials && Object.keys(selected.commercials).length > 0 && (
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-2">Commercials</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(selected.commercials).map(([k, v]) => (
                        <div key={k} className="bg-muted/50 rounded-md p-2">
                          <p className="text-xs text-muted-foreground">{k}</p>
                          <p className="text-sm font-mono">{String(v)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.notes && (
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-2">Notes</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">{selected.notes}</p>
                  </div>
                )}

                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-2">All Parsed Fields</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selected.parsed_fields && Object.entries(selected.parsed_fields).map(([k, v]) => (
                      <div key={k} className="bg-muted/30 rounded-md p-2">
                        <p className="text-xs text-muted-foreground">{k}</p>
                        <p className="text-sm">{v || "—"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Field = ({ label, value, link }: { label: string; value: any; link?: boolean }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    {value ? (
      link ? (
        <a href={String(value)} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline break-all">
          {String(value)}
        </a>
      ) : (
        <p className="text-sm break-all">{String(value)}</p>
      )
    ) : (
      <p className="text-sm text-muted-foreground">—</p>
    )}
  </div>
);
