import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEndTenantAccess } from "@/hooks/useTenantAccess";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogOut } from "lucide-react";

/**
 * Shown for the whole of a support session.
 *
 * Working inside someone else's workspace looks exactly like working in your
 * own, which is how a change ends up in the wrong account. This is deliberately
 * hard to miss and always offers the way out.
 */
export const SupportAccessBanner = () => {
  const { currentUser } = useAuth();
  const endAccess = useEndTenantAccess();
  const [tenantName, setTenantName] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const supportTenantId = currentUser?.supportTenantId ?? null;

  useEffect(() => {
    if (!supportTenantId || !currentUser) return;
    let cancelled = false;

    (async () => {
      const [{ data: tenant }, { data: grant }] = await Promise.all([
        (supabase as any).from("tenants").select("name").eq("id", supportTenantId).maybeSingle(),
        (supabase as any)
          .from("tenant_access_grants")
          .select("expires_at")
          .eq("tenant_id", supportTenantId)
          .eq("granted_to", currentUser.id)
          .is("revoked_at", null)
          .order("expires_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setTenantName((tenant as { name?: string } | null)?.name || "another workspace");
      setExpiresAt((grant as { expires_at?: string } | null)?.expires_at ?? null);
    })();

    return () => { cancelled = true; };
  }, [supportTenantId, currentUser]);

  if (!supportTenantId) return null;

  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-amber-950">
      <div className="flex min-w-0 items-center gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <p className="min-w-0 truncate text-xs font-medium">
          You are working inside <strong>{tenantName}</strong>. Everything you change belongs to them.
          {daysLeft !== null && (
            <span className="font-normal">
              {" "}Access ends in {daysLeft} day{daysLeft === 1 ? "" : "s"}.
            </span>
          )}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 gap-1.5 border-amber-900/30 bg-amber-100 text-xs text-amber-950 hover:bg-amber-50"
        onClick={() => endAccess.mutate()}
        disabled={endAccess.isPending}
      >
        <LogOut className="h-3.5 w-3.5" />
        {endAccess.isPending ? "Leaving…" : "Leave workspace"}
      </Button>
    </div>
  );
};
