import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Roles a support grant can carry. It replaces the grantee's own role for the session. */
export type SupportAccessRole = "manager" | "admin" | "gokwik_general";

export interface TenantAccessGrant {
  id: string;
  tenant_id: string;
  granted_to: string;
  granted_by: string;
  granted_by_name: string | null;
  reason: string | null;
  role: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Time-limited access to a customer workspace.
 *
 * A super admin can already reach every tenant through RLS. What this adds is
 * intent and a record: you open a grant against one tenant for a set number of
 * days and a set role, the app then reads and writes as that tenant, and the
 * grant says who did it, when, and why.
 *
 * The record is kept by the database, not here: grants cannot be edited or
 * deleted, and every grant, revocation, entry and exit is logged into the
 * customer's workspace by triggers (see 20260913120000_support_access_hardening).
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
    mutationFn: async ({ tenantId, days, reason, role, grantTo }: {
      tenantId: string; tenantName: string; days: number; reason: string;
      /** What the grantee may do inside the workspace. */
      role: SupportAccessRole;
      /** Who gets the access. Defaults to the person granting it. */
      grantTo?: string;
    }) => {
      if (!currentUser) throw new Error("Not signed in");
      const recipient = grantTo || currentUser.id;

      const expires = new Date();
      expires.setDate(expires.getDate() + days);

      // granted_by and granted_by_name are overwritten by the database with
      // the signed-in user; they are sent only so older schemas still accept it.
      const { error: grantError } = await (supabase as any)
        .from("tenant_access_grants")
        .insert({
          tenant_id: tenantId,
          granted_to: recipient,
          granted_by: currentUser.id,
          granted_by_name: currentUser.name,
          reason,
          role,
          expires_at: expires.toISOString(),
        });
      if (grantError) throw grantError;

      // Entering is separate from being allowed to enter. Granting to someone
      // else must not drag them into a workspace mid-task; they choose when.
      if (recipient === currentUser.id) {
        const { error: profileError } = await (supabase as any)
          .from("profiles")
          .update({ active_tenant_id: tenantId })
          .eq("id", currentUser.id);
        if (profileError) throw profileError;
      }

      return { tenantId, expiresAt: expires.toISOString(), entered: recipient === currentUser.id };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["tenant_access_grants"] });
      // Only reload when this session actually moved workspace.
      if (res.entered) window.location.reload();
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
    },
    onSuccess: () => window.location.reload(),
  });
};

export const useRevokeTenantAccess = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: string) => {
      // The database stamps its own time and ends the grantee's session.
      const { error } = await (supabase as any)
        .from("tenant_access_grants")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", grantId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant_access_grants"] }),
  });
};

/** Workspaces this person may enter right now. */
export const useMyTenantAccess = () => {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: ["my_tenant_access", currentUser?.id],
    enabled: !!currentUser,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_access_grants")
        .select("id, tenant_id, expires_at, tenants(name)")
        .eq("granted_to", currentUser!.id)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Array<{
        id: string; tenant_id: string; expires_at: string; tenants: { name: string } | null;
      }>;
    },
  });
};

/** Step into a workspace already granted. */
export const useEnterTenant = () => {
  const { currentUser } = useAuth();
  return useMutation({
    mutationFn: async (tenantId: string) => {
      if (!currentUser) throw new Error("Not signed in");
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ active_tenant_id: tenantId })
        .eq("id", currentUser.id);
      if (error) throw error;
    },
    onSuccess: () => window.location.reload(),
  });
};
