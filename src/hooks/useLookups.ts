import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tenantScope } from "@/lib/tenant-scope";

const EMPTY_PROFILES: { id: string; name: string }[] = [];

/** Cached id -> name profile lookup for the current workspace (shared across all components). */
export const useProfilesLookup = () => {
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  const { data, isLoading } = useQuery({
    queryKey: ["profiles", "lookup", tenantId],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, name").eq("tenant_id", tenantId);
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });
  return { profiles: data ?? EMPTY_PROFILES, isLoading };
};

const EMPTY_TITLES: Record<string, string> = {};

/** Cached checklist template title -> id map for the current workspace. */
export const useChecklistTemplateTitles = () => {
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  const { data, isLoading } = useQuery({
    queryKey: ["checklist_templates", "titles", tenantId],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("checklist_templates").select("id, title").eq("tenant_id", tenantId);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((t: any) => { map[t.title] = t.id; });
      return map;
    },
  });
  return { titlesToId: data ?? EMPTY_TITLES, isLoading };
};
