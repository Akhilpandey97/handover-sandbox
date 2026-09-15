import { useEffect, useState, useCallback } from "react";
import { apiAuthHeaders } from "@/lib/api-invoke";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tenantScope } from "@/lib/tenant-scope";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { X, Plus, Trash2, Send, Loader2, Clock, Calendar } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultGranularity?: "monthly" | "quarterly";
}

interface Schedule {
  id: string;
  name: string;
  granularity: "monthly" | "quarterly";
  days: string[];
  time_ist: string;
  recipients: string[];
  subject_prefix: string | null;
  enabled: boolean;
  last_sent_at: string | null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export const ScheduleTATReportDialog = ({ open, onOpenChange, defaultGranularity = "monthly" }: Props) => {
  const { currentUser } = useAuth();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("TAT Report");
  const [granularity, setGranularity] = useState<"monthly" | "quarterly">(defaultGranularity);
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<string[]>(["Mon"]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [subjectPrefix, setSubjectPrefix] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("tat_report_schedules")
      .select("*")
      .eq("tenant_id", tenantScope(currentUser?.tenantId))
      .order("created_at", { ascending: false });
    setSchedules((data as Schedule[]) || []);
    setLoading(false);
  }, [currentUser?.tenantId]);

  useEffect(() => {
    if (open) {
      load();
      setGranularity(defaultGranularity);
      setName(defaultGranularity === "monthly" ? "Monthly TAT Report" : "Quarterly TAT Report");
    }
  }, [open, defaultGranularity, load]);

  const addEmail = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const p of parts) {
      if (isValidEmail(p) && !recipients.includes(p)) valid.push(p);
      else if (!isValidEmail(p)) invalid.push(p);
    }
    if (valid.length) setRecipients((prev) => [...prev, ...valid]);
    if (invalid.length) toast.error(`Invalid: ${invalid.join(", ")}`);
    setEmailInput("");
  };

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const handleCreate = async () => {
    if (!currentUser?.tenantId) return toast.error("Missing tenant");
    if (recipients.length === 0) return toast.error("Add at least one recipient");
    if (days.length === 0) return toast.error("Pick at least one day");
    setSaving(true);
    const { error } = await (supabase as any).from("tat_report_schedules").insert({
      tenant_id: currentUser.tenantId,
      name,
      granularity,
      days,
      time_ist: time,
      recipients,
      subject_prefix: subjectPrefix || null,
      enabled: true,
      created_by: currentUser.id,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("TAT report schedule saved");
    setRecipients([]);
    setSubjectPrefix("");
    await load();
  };

  const toggleEnabled = async (s: Schedule) => {
    await (supabase as any).from("tat_report_schedules").update({ enabled: !s.enabled }).eq("id", s.id);
    await load();
  };

  const remove = async (id: string) => {
    await (supabase as any).from("tat_report_schedules").delete().eq("id", id);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    toast.success("Schedule removed");
  };

  const sendNow = async (s: Schedule) => {
    setBusyId(s.id);
    try {
      const res = await fetch(
        `/api/public/send-scheduled-tat-report`,
        {
          method: "POST",
          headers: await apiAuthHeaders(),
          body: JSON.stringify({ schedule_id: s.id }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Send failed");
      toast.success(`Sent to ${s.recipients.length} recipient(s)`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Failed to send");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Save & Schedule TAT Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-normal text-muted-foreground">
            Saved schedules ({schedules.length})
          </p>
          {loading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            </div>
          ) : schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No saved schedules yet.</p>
          ) : (
            <div className="space-y-2">
              {schedules.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3 border rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{s.name}</span>
                      <Badge variant="outline" className="text-2xs capitalize">{s.granularity}</Badge>
                      <Badge variant="secondary" className="text-2xs">
                        <Clock className="h-3 w-3 mr-0.5 inline" />
                        {s.days.join(", ")} @ {s.time_ist} IST
                      </Badge>
                      {!s.enabled && <Badge variant="outline" className="text-2xs">Paused</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      To: {s.recipients.join(", ")}
                    </p>
                    {s.last_sent_at && (
                      <p className="text-2xs text-muted-foreground mt-0.5">
                        Last sent: {new Date(s.last_sent_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch checked={s.enabled} onCheckedChange={() => toggleEnabled(s)} />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => sendNow(s)}
                      disabled={busyId === s.id}
                    >
                      {busyId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Send now
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => remove(s.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-normal text-muted-foreground">New schedule</p>
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Granularity</Label>
              <ToggleGroup
                type="single"
                value={granularity}
                onValueChange={(v) => v && setGranularity(v as "monthly" | "quarterly")}
                className="justify-start mt-1"
                size="sm"
              >
                <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
                <ToggleGroupItem value="quarterly">Quarterly</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div>
              <Label>Time (IST)</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Subject prefix (optional)</Label>
            <Input value={subjectPrefix} onChange={(e) => setSubjectPrefix(e.target.value)} placeholder="[MINT]" />
          </div>
          <div>
            <Label>Days</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`px-2.5 py-1 text-xs rounded-md border ${
                    days.includes(d)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Recipients</Label>
            <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[42px]">
              {recipients.map((e) => (
                <Badge key={e} variant="secondary" className="gap-1">
                  {e}
                  <button onClick={() => setRecipients((prev) => prev.filter((x) => x !== e))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addEmail(emailInput);
                  }
                }}
                onBlur={() => emailInput && addEmail(emailInput)}
                placeholder={recipients.length ? "" : "Enter emails, Enter or comma to add"}
                className="flex-1 min-w-[160px] bg-transparent outline-none text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleCreate} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Save schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
