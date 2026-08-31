import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Save, Mail, Inbox, Bug, Bell, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Fields = Record<string, string>;

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  help?: string;
}

interface Group {
  title: string;
  icon: typeof Mail;
  description: string;
  fields: FieldDef[];
}

const GROUPS: Group[] = [
  {
    title: "Email (Resend)",
    icon: Mail,
    description: "Outbound notifications, scheduled reports and merchant portal magic links.",
    fields: [
      { key: "resend_api_key", label: "Resend API Key", placeholder: "re_xxxxxxxxxxxxxxxxxxxxxxxx", secret: true, help: "resend.com → API Keys" },
      { key: "from_email", label: "From Address", placeholder: "updates@notifications.yourdomain.com" },
      { key: "from_name", label: "From Name", placeholder: "MINT Updates" },
      { key: "reply_to", label: "Reply-To", placeholder: "onboarding@yourdomain.com" },
      { key: "app_base_url", label: "App Base URL", placeholder: "https://yourworkspace.lovable.app", help: "Used to build links inside emails" },
    ],
  },
  {
    title: "Gmail Polling",
    icon: Inbox,
    description: "Reads the shared mailbox to auto-create projects and sync project email threads.",
    fields: [
      { key: "google_mail_api_key", label: "Gmail Connector Key", placeholder: "gmail-connector-key", secret: true },
      { key: "gmail_monitor_address", label: "Mailbox to Monitor", placeholder: "integration@yourdomain.com" },
    ],
  },
  {
    title: "Jira",
    icon: Bug,
    description: "Pulls tickets for each project and powers the merchant portal ticket view.",
    fields: [
      { key: "jira_base_url", label: "Jira Base URL", placeholder: "https://yourcompany.atlassian.net" },
      { key: "jira_email", label: "Jira Account Email", placeholder: "automation@yourdomain.com" },
      { key: "jira_api_token", label: "Jira API Token", placeholder: "ATATT3xFfGF0...", secret: true, help: "id.atlassian.com → API tokens" },
    ],
  },
  {
    title: "Slack",
    icon: Bell,
    description: "Stuck-merchant digests and workflow alerts.",
    fields: [
      { key: "slack_webhook_url", label: "Incoming Webhook URL", placeholder: "https://hooks.slack.com/services/T000/B000/XXXX", secret: true },
      { key: "slack_bot_token", label: "Bot Token (optional)", placeholder: "xoxb-...", secret: true },
      { key: "slack_channel", label: "Default Channel", placeholder: "#merchant-onboarding" },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

export function IntegrationsSettings() {
  const [values, setValues] = useState<Fields>({});
  const [initial, setInitial] = useState<Fields>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const authedFetch = async (init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return fetch("/api/public/tenant-integrations", {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    });
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch();
        if (res.status === 403 || res.status === 401) {
          setForbidden(true);
          return;
        }
        const body = await res.json();
        const next: Fields = {};
        ALL_KEYS.forEach((k) => (next[k] = body.settings?.[k] ?? ""));
        setValues(next);
        setInitial(next);
      } catch (err) {
        toast.error("Could not load integration settings");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = ALL_KEYS.some((k) => (values[k] ?? "") !== (initial[k] ?? ""));

  const save = async () => {
    setSaving(true);
    try {
      const payload: Fields = {};
      ALL_KEYS.forEach((k) => {
        if ((values[k] ?? "") !== (initial[k] ?? "")) payload[k] = values[k] ?? "";
      });
      const res = await authedFetch({ method: "POST", body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      setInitial({ ...values });
      toast.success("Integration settings saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading integrations…
      </div>
    );
  }

  if (forbidden) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />Integrations
          </CardTitle>
          <CardDescription>
            Only workspace admins and managers can view or change integration credentials.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground max-w-3xl">
          These credentials belong to your workspace only. Secret values are stored encrypted and are
          never returned to the browser — saved keys appear as dots and stay untouched unless you type
          a new value.
        </p>
        <Button onClick={save} disabled={!dirty || saving} className="gap-2 shrink-0">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save changes
        </Button>
      </div>

      {GROUPS.map((group) => {
        const Icon = group.icon;
        const configured = group.fields.some((f) => (values[f.key] ?? "").length > 0);
        return (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="h-5 w-5" />
                {group.title}
                <Badge variant={configured ? "default" : "secondary"} className="ml-2">
                  {configured ? "Configured" : "Not configured"}
                </Badge>
              </CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {group.fields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={field.key} className="text-xs font-medium">
                    {field.label}
                    {field.secret && <span className="ml-1 text-muted-foreground">(secret)</span>}
                  </Label>
                  <Input
                    id={field.key}
                    value={values[field.key] ?? ""}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                  {field.help && (
                    <p className="text-[11px] text-muted-foreground">{field.help}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Separator />
      <p className="text-xs text-muted-foreground">
        Features stay disabled until their credentials are filled in — the app reports a clear
        "not configured for this tenant" message instead of failing silently.
      </p>
    </div>
  );
}
