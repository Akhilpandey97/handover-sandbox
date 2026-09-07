import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Latest checklist comment per project, the signal behind the "no activity"
 * risk rule. Backed by the project_last_activity() function because
 * checklist_comments has no project_id and PostgREST cannot group through the
 * join. A project absent from the map has never been commented on.
 */
export const useLastChecklistActivity = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId || null;

  const { data, isLoading } = useQuery({
    queryKey: ["project_last_activity", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.rpc("project_last_activity" as never, {
        _tenant_id: tenantId,
      } as never);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of (data || []) as { project_id: string; last_comment_at: string }[]) {
        if (row.last_comment_at) map[row.project_id] = row.last_comment_at;
      }
      return map;
    },
  });

  return { lastActivityByProject: data || {}, isLoading };
};
