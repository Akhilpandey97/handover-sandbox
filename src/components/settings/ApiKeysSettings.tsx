import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, KeyRound, Copy, Plus, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function ApiKeysSettings() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const call = async (init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    return fetch("/api/public/api-keys", {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(data.session?.access_token
          ? { Authorization: `Bearer ${data.session.access_token}` }
          : {}),
      },
    });
  };

  const load = async () => {
    try {
      const res = await call();
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      const body = await res.json();
      setKeys(body.keys || []);
    } catch {
      toast.error("Could not load API keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await call({ method: "POST", body: JSON.stringify({ name: name.trim() }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create key");
      setFreshKey(body.key);
      setName("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    const res = await call({ method: "POST", body: JSON.stringify({ action: "revoke", id }) });
    if (res.ok) {
      toast.success("Key revoked");
      load();
    } else {
      toast.error("Could not revoke key");
    }
  };

  if (forbidden) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />API Keys
          </CardTitle>
          <CardDescription>Only workspace admins and managers can manage API keys.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />API Keys
        </CardTitle>
        <CardDescription>
          Give your CRM a key so a won deal can create a project in Handover automatically. Send it
          as <code>Authorization: Bearer …</code> to <code>/api/public/v1/projects</code>. A key is
          shown once — copy it now and store it in your CRM.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Key name (e.g. Salesforce production)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button onClick={create} disabled={creating || !name.trim()} className="gap-2 shrink-0">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create key
          </Button>
        </div>

        {freshKey && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Copy this key now — it will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate text-sm">{freshKey}</code>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => {
                  navigator.clipboard.writeText(freshKey);
                  toast.success("Copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading keys…
          </div>
        ) : keys.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{k.name}</span>
                    <Badge variant={k.revoked_at ? "secondary" : "default"}>
                      {k.revoked_at ? "Revoked" : "Active"}
                    </Badge>
                  </div>
                  <p className="text-micro text-muted-foreground">
                    {k.key_prefix}…
                    {k.last_used_at
                      ? ` · last used ${new Date(k.last_used_at).toLocaleString()}`
                      : " · never used"}
                  </p>
                </div>
                {!k.revoked_at && (
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => revoke(k.id)}>
                    <Ban className="h-3.5 w-3.5" /> Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
