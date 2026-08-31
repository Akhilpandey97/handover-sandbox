import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const EMPTY_PROFILES: { id: string; name: string }[] = [];

/** Cached id -> name profile lookup (shared across all components). */
export const useProfilesLookup = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["profiles", "lookup"],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, name");
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });
  return { profiles: data ?? EMPTY_PROFILES, isLoading };
};

const EMPTY_TITLES: Record<string, string> = {};

/** Cached checklist template title -> id map. */
export const useChecklistTemplateTitles = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["checklist_templates", "titles"],
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("checklist_templates").select("id, title");
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((t: any) => { map[t.title] = t.id; });
      return map;
    },
  });
  return { titlesToId: data ?? EMPTY_TITLES, isLoading };
};
