import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Shield } from "lucide-react";

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  // The recovery link drops tokens in the URL; the client exchanges them for a
  // short-lived session before the new password can be written.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setReady(Boolean(data.session));
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });
    check();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDone(true);
    toast.success("Password updated");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-[420px] space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <Shield className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="heading-section">Set a new password</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Choose a password you haven't used before.
            </p>
          </div>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            {done ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Your password has been updated. You can now sign in.
                </p>
                <Button className="w-full h-10" onClick={() => (window.location.href = "/")}>
                  Go to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                {!ready && (
                  <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Open this page from the reset link in your email. If the link has expired,
                    request a new one from the sign-in screen.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-xs text-muted-foreground">
                    New password
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-xs text-muted-foreground">
                    Confirm password
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                    className="h-10"
                  />
                </div>
                <Button type="submit" className="w-full h-10 font-semibold" disabled={saving || !ready}>
                  {saving ? "Updating..." : "Update password"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Handover" },
      {
        name: "description",
        content: "Set a new password for your Handover onboarding workspace account.",
      },
      { property: "og:title", content: "Reset password — Handover" },
      {
        property: "og:description",
        content: "Set a new password for your Handover onboarding workspace account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});
