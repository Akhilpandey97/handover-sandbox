import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DynamicTeam {
  id: string;
  name: string;
  slug: string;
  color: string;
  is_system: boolean;
  sort_order: number;
}

// System teams that always exist (even if not in DB)
const SYSTEM_TEAMS: DynamicTeam[] = [
  { id: "system-mint", name: "Sales", slug: "mint", color: "#3b82f6", is_system: true, sort_order: 0 },
  { id: "system-integration", name: "MINT", slug: "integration", color: "#a855f7", is_system: true, sort_order: 1 },
  { id: "system-ms", name: "Merchant Success", slug: "ms", color: "#10b981", is_system: true, sort_order: 2 },
];

export const useTeams = () => {
  const { data: dbTeams = [], isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("*").order("sort_order");
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const customTeams: DynamicTeam[] = dbTeams.filter(t => !t.is_system);

  // Team Management (Settings → Checklist) is the single source of truth for
  // team names. A saved row always wins over the built-in fallback name.
  const systemTeams: DynamicTeam[] = SYSTEM_TEAMS.map((fallback) => {
    const saved = dbTeams.find(t => t.slug === fallback.slug);
    return saved ? { ...fallback, ...saved } : fallback;
  });

  // Checklist teams = system teams + custom teams (excludes manager/super_admin/gokwik_general)
  const checklistTeams = [...systemTeams, ...customTeams];

  // Build slug→name lookup
  const teamLabelMap: Record<string, string> = {};
  checklistTeams.forEach(t => { teamLabelMap[t.slug] = t.name; });

  // Build slug→color lookup
  const teamColorMap: Record<string, string> = {};
  checklistTeams.forEach(t => { teamColorMap[t.slug] = t.color; });

  // All team slugs for checklists
  const checklistTeamSlugs = checklistTeams.map(t => t.slug);

  return {
    allTeams: checklistTeams,
    customTeams,
    systemTeams,
    teamLabelMap,
    teamColorMap,
    checklistTeamSlugs,
    isLoading,
  };
};
