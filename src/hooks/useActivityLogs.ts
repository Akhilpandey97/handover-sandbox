import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tenantScope } from "@/lib/tenant-scope";

export interface ActivityLog {
  id: string;
  user_name: string | null;
  action_type: string;
  category: string;
  description: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: any;
  status: string;
  created_at: string;
}

export const useActivityLogs = (limit = 200) => {
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  return useQuery({
    queryKey: ["activity_logs", tenantId, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as ActivityLog[];
    },
    refetchInterval: 15_000,
  });
};

// Utility to log an activity from the frontend
export const logActivity = async (log: {
  action_type: "user" | "system" | "ai";
  category: string;
  description: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: any;
  status?: "success" | "failed";
}) => {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, tenant_id")
    .eq("id", session.session.user.id)
    .single();

  await supabase.from("activity_logs").insert({
    tenant_id: profile?.tenant_id || null,
    user_id: session.session.user.id,
    user_name: profile?.name || "Unknown",
    action_type: log.action_type,
    category: log.category,
    description: log.description,
    entity_type: log.entity_type || null,
    entity_id: log.entity_id || null,
    metadata: log.metadata || {},
    status: log.status || "success",
  });
};
