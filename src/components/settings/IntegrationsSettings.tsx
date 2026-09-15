import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Mail,
  Inbox,
  Bug,
  Bell,
  KeyRound,
  ShieldCheck,
  Video,
  Check,
} from "lucide-react";
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
    title: "Meetings",
    icon: Video,
    description:
      "Creates the join link automatically when a meeting is scheduled, and pulls the transcript afterwards so Meeting AI can post the minutes.",
    fields: [
      { key: "zoom_account_id", label: "Zoom Account ID", placeholder: "abc123XYZ", help: "Server-to-server OAuth app" },
      { key: "zoom_client_id", label: "Zoom Client ID", placeholder: "xxxxxxxxxxxxxxxxxxxxxx" },
      { key: "zoom_client_secret", label: "Zoom Client Secret", placeholder: "•••••", secret: true },
      { key: "zoom_webhook_secret", label: "Zoom Webhook Secret Token", placeholder: "•••••", secret: true, help: "Event Subscriptions → /api/public/zoom-webhook" },
      { key: "zoom_user_id", label: "Zoom Host Email / User ID", placeholder: "host@yourcompany.com", help: "Whose account hosts generated meetings. Defaults to the app user." },
      { key: "teams_tenant_id", label: "Microsoft Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "teams_client_id", label: "Microsoft Client ID", placeholder: "00000000-0000-0000-0000-000000000000", help: "Graph app with OnlineMeetingTranscript.Read.All" },
      { key: "teams_client_secret", label: "Microsoft Client Secret", placeholder: "•••••", secret: true },
      { key: "teams_organizer_user_id", label: "Teams Organiser User ID", placeholder: "00000000-0000-0000-0000-000000000000", help: "Required to create Teams links automatically" },
      { key: "google_oauth_client_id", label: "Google OAuth Client ID", placeholder: "...apps.googleusercontent.com" },
      { key: "google_oauth_client_secret", label: "Google OAuth Client Secret", placeholder: "•••••", secret: true },
      { key: "google_meet_refresh_token", label: "Google Meet Refresh Token", placeholder: "•••••", secret: true, help: "Scope: meetings.space.readonly" },
      { key: "google_calendar_refresh_token", label: "Google Calendar Refresh Token", placeholder: "•••••", secret: true, help: "Scope: calendar.events — needed to create Meet links" },
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
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);

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
      } catch {
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
      setOpenGroup(null);
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

  const active = GROUPS.find((g) => g.title === openGroup) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="portal-heading">Workspace integrations</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              Pick a card to set it up. Credentials are encrypted and never returned to the browser.
            </p>
          </div>
        </div>
        {dirty && (
          <Button onClick={save} disabled={saving} size="sm" className="h-8 shrink-0 gap-1.5 text-xs">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save changes
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {GROUPS.map((group) => {
          const Icon = group.icon;
          const filled = group.fields.filter((f) => (values[f.key] ?? "").length > 0).length;
          const configured = filled > 0;
          return (
            <button
              key={group.title}
              type="button"
              onClick={() => setOpenGroup(group.title)}
              className="group flex h-full flex-col rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="portal-heading truncate text-sm">{group.title}</span>
                {configured && (
                  <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-2xs leading-4 text-muted-foreground">
                {group.description}
              </p>
              <p className="mt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {filled}/{group.fields.length} fields set
              </p>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setApiKeysOpen(true)}
          className="group flex h-full flex-col rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
              <KeyRound className="h-4 w-4" />
            </span>
            <span className="portal-heading truncate text-sm">API Keys</span>
          </div>
          <p className="mt-2 line-clamp-2 text-2xs leading-4 text-muted-foreground">
            Keys your CRM uses to push won deals into Handover.
          </p>
          <p className="mt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Manage keys
          </p>
        </button>
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setOpenGroup(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <active.icon className="h-4 w-4 text-primary" />
                  {active.title}
                </DialogTitle>
                <DialogDescription className="text-xs">{active.description}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 md:grid-cols-2">
                {active.fields.map((field) => (
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
                    {field.help && <p className="text-2xs text-muted-foreground">{field.help}</p>}
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setOpenGroup(null)}>
                  Close
                </Button>
                <Button onClick={save} disabled={!dirty || saving} size="sm" className="h-8 gap-1.5 text-xs">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={apiKeysOpen} onOpenChange={setApiKeysOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" />
              API Keys
            </DialogTitle>
          </DialogHeader>
          <ApiKeysSettings />
        </DialogContent>
      </Dialog>
    </div>
  );
}
