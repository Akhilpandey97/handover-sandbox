import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Save, Mail, Inbox, Bug, Bell, KeyRound, ShieldCheck, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ApiKeysSettings } from "./ApiKeysSettings";

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
      { key: "jira_project_key", label: "Default Project Key", placeholder: "ONB", help: "Used when creating tickets from a project" },
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
  {
    title: "Meeting Transcripts",
    icon: Video,
    description:
      "Pulls the transcript after a checklist meeting so Meeting AI can post the minutes and flag risks. Scheduling and invites work without any of this — only transcripts need it, and only for the providers you use.",
    fields: [
      { key: "zoom_account_id", label: "Zoom Account ID", placeholder: "abc123XYZ", help: "Server-to-server OAuth app" },
      { key: "zoom_client_id", label: "Zoom Client ID", placeholder: "xxxxxxxxxxxxxxxxxxxxxx" },
      { key: "zoom_client_secret", label: "Zoom Client Secret", placeholder: "•••••", secret: true },
      { key: "zoom_webhook_secret", label: "Zoom Webhook Secret Token", placeholder: "•••••", secret: true, help: "Event Subscriptions → /api/public/zoom-webhook" },
      { key: "teams_tenant_id", label: "Microsoft Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "teams_client_id", label: "Microsoft Client ID", placeholder: "00000000-0000-0000-0000-000000000000", help: "Graph app with OnlineMeetingTranscript.Read.All" },
      { key: "teams_client_secret", label: "Microsoft Client Secret", placeholder: "•••••", secret: true },
      { key: "google_oauth_client_id", label: "Google OAuth Client ID", placeholder: "...apps.googleusercontent.com" },
      { key: "google_oauth_client_secret", label: "Google OAuth Client Secret", placeholder: "•••••", secret: true },
      { key: "google_meet_refresh_token", label: "Google Meet Refresh Token", placeholder: "•••••", secret: true, help: "Scope: meetings.space.readonly" },
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
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="portal-heading flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />Integrations
          </CardTitle>
          <CardDescription>
            Only workspace admins and managers can view or change integration credentials.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <h2 className="portal-heading">Workspace integrations</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
              Credentials are encrypted and never returned to the browser. Saved secrets remain unchanged until replaced.
            </p>
          </div>
        </div>
        <Button onClick={save} disabled={!dirty || saving} size="sm" className="h-8 shrink-0 gap-1.5 text-xs">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save changes
        </Button>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {GROUPS.map((group) => {
        const Icon = group.icon;
        const configured = group.fields.some((f) => (values[f.key] ?? "").length > 0);
        return (
          <Card key={group.title} className="transition-colors hover:border-primary/35">
            <CardHeader className="min-h-[4.5rem]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-primary shadow-sm">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="portal-heading">{group.title}</CardTitle>
                    <CardDescription className="mt-1">{group.description}</CardDescription>
                  </div>
                </div>
                <Badge variant={configured ? "default" : "secondary"} className="shrink-0 text-[10px]">
                  {configured ? "Configured" : "Not configured"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
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
                    className="h-8 text-xs"
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

        <div className="xl:col-span-2">
          <ApiKeysSettings />
        </div>
      </div>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        Features stay disabled until their credentials are filled in — the app reports a clear
        "not configured for this tenant" message instead of failing silently.
      </p>
    </div>
  );
}
