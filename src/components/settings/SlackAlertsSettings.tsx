import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Bell, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const KEYS = [
  "slack_alerts_enabled",
  "slack_channel_email",
  "slack_alert_tag",
  "slack_alert_hours",
] as const;

type CfgKey = (typeof KEYS)[number];

const DEFAULTS: Record<CfgKey, string> = {
  slack_alerts_enabled: "false",
  slack_channel_email: "",
  slack_alert_tag: "#awaiting-merchant",
  slack_alert_hours: "24",
};

export const SlackAlertsSettings = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  const [cfg, setCfg] = useState<Record<CfgKey, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("key, value")
        .eq("tenant_id", tenantId)
        .in("key", KEYS as unknown as string[]);
      const next = { ...DEFAULTS };
      (data || []).forEach((r: any) => {
        if (KEYS.includes(r.key)) next[r.key as CfgKey] = r.value;
      });
      setCfg(next);
      setLoading(false);
    })();
  }, [tenantId]);

  const update = (k: CfgKey, v: string) => setCfg((c) => ({ ...c, [k]: v }));

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const rows = KEYS.map((key) => ({
        tenant_id: tenantId,
        key,
        value: cfg[key],
        category: "slack-alerts",
      }));
      const { error } = await supabase
        .from("app_settings")
        .upsert(rows, { onConflict: "key,tenant_id" });
      if (error) throw error;
      toast({ title: "Saved", description: "Slack alert settings updated." });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!tenantId) return;
    if (!cfg.slack_channel_email) {
      toast({ title: "Add channel email first", variant: "destructive" });
      return;
    }
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/slack-stuck-merchants-digest?test=true&tenant_id=${tenantId}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      const out = await res.json();
      if (!res.ok || !out.success) throw new Error(JSON.stringify(out));
      const r = out.results?.[0];
      toast({
        title: "Test digest sent",
        description: r?.sent
          ? `Posted to channel (${r.count} merchant${r.count === 1 ? "" : "s"}).`
          : `No stuck merchants — sent empty test card.`,
      });
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />Slack Stuck-Merchant Alerts
        </CardTitle>
        <CardDescription>
          Daily 12:00 PM IST digest posted to a Slack channel listing merchants where a
          checklist note tagged with your keyword (default <code>#awaiting-merchant</code>)
          is older than the threshold and the item is still open. Delivered via channel email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between border rounded-md p-3">
          <div>
            <div className="text-sm font-medium">Enable daily digest</div>
            <div className="text-xs text-muted-foreground">When off, the daily cron skips this tenant.</div>
          </div>
          <Switch
            checked={cfg.slack_alerts_enabled === "true"}
            onCheckedChange={(v) => update("slack_alerts_enabled", v ? "true" : "false")}
          />
        </div>

        <div>
          <Label htmlFor="ch-email">Slack channel email</Label>
          <Input
            id="ch-email"
            type="email"
            placeholder="customteam-xxxxx@yourworkspace.slack.com"
            value={cfg.slack_channel_email}
            onChange={(e) => update("slack_channel_email", e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            In Slack: channel name → <strong>Integrations</strong> → <strong>Send emails to this channel</strong> → Get Email Address.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="tag">Tag keyword</Label>
            <Input
              id="tag"
              value={cfg.slack_alert_tag}
              onChange={(e) => update("slack_alert_tag", e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Mention this anywhere in a checklist comment to flag.
            </p>
          </div>
          <div>
            <Label htmlFor="hrs">Hours threshold</Label>
            <Input
              id="hrs"
              type="number"
              min={1}
              value={cfg.slack_alert_hours}
              onChange={(e) => update("slack_alert_hours", e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Min hours since the tagged comment before it surfaces.
            </p>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          <Button variant="outline" onClick={sendTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Send test digest now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
