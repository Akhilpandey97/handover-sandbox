import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/hooks/useActivityLogs";

export interface TenantAccessGrant {
  id: string;
  tenant_id: string;
  granted_to: string;
  granted_by: string;
  granted_by_name: string | null;
  reason: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Time-limited access to a customer workspace.
 *
 * A super admin can already reach every tenant through RLS. What this adds is
 * intent and a record: you open a grant against one tenant for a set number of
 * days, the app then reads and writes as that tenant, and the grant says who
 * did it, when, and why.
 */
export const useTenantAccessGrants = (tenantId?: string) =>
  useQuery({
    queryKey: ["tenant_access_grants", tenantId ?? "all"],
    queryFn: async () => {
      let q = (supabase as any)
        .from("tenant_access_grants")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as TenantAccessGrant[];
    },
  });

export const useStartTenantAccess = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async ({ tenantId, tenantName, days, reason }: {
      tenantId: string; tenantName: string; days: number; reason: string;
    }) => {
      if (!currentUser) throw new Error("Not signed in");

      const expires = new Date();
      expires.setDate(expires.getDate() + days);

      const { error: grantError } = await (supabase as any)
        .from("tenant_access_grants")
        .insert({
          tenant_id: tenantId,
          granted_to: currentUser.id,
          granted_by: currentUser.id,
          granted_by_name: currentUser.name,
          reason,
          expires_at: expires.toISOString(),
        });
      if (grantError) throw grantError;

      // What makes the session active. The grant alone only permits it.
      const { error: profileError } = await (supabase as any)
        .from("profiles")
        .update({ active_tenant_id: tenantId })
        .eq("id", currentUser.id);
      if (profileError) throw profileError;

      await logActivity({
        action_type: "user",
        category: "tenant",
        description: `Opened support access to "${tenantName}" for ${days} day${days === 1 ? "" : "s"} — ${reason}`,
        entity_type: "tenant",
        entity_id: tenantId,
      });

      return { tenantId, expiresAt: expires.toISOString() };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant_access_grants"] });
      // Everything the app holds belongs to the other workspace now.
      window.location.reload();
    },
  });
};

export const useEndTenantAccess = () => {
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!currentUser) throw new Error("Not signed in");

      // Clearing the active tenant is enough to end the session. The grant is
      // left standing so the record of it survives, and so returning does not
      // need a fresh one until it expires.
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ active_tenant_id: null })
        .eq("id", currentUser.id);
      if (error) throw error;

      await logActivity({
        action_type: "user",
        category: "tenant",
        description: "Closed support access",
        entity_type: "tenant",
        entity_id: currentUser.supportTenantId ?? undefined,
      });
    },
    onSuccess: () => window.location.reload(),
  });
};

export const useRevokeTenantAccess = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: string) => {
      const { error } = await (supabase as any)
        .from("tenant_access_grants")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", grantId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant_access_grants"] }),
  });
};
