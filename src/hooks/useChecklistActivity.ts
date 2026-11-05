import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ChecklistActivityEvent {
  id: string;
  type: "comment" | "completion";
  itemId: string;
  itemTitle: string;
  who: string;
  when: string;
  text?: string;
}

/** §8.4 — tab-level checklist activity stream for a project */
export function useChecklistActivity(projectId?: string) {
  return useQuery({
    queryKey: ["checklist-activity", projectId],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async (): Promise<ChecklistActivityEvent[]> => {
      if (!projectId) return [];

      const { data: items } = await supabase
        .from("checklist_items")
        .select("id, title, completed, completed_at, completed_by")
        .eq("project_id", projectId);

      const itemArr = items ?? [];
      const itemIds = itemArr.map((i: any) => i.id);
      const itemMap = Object.fromEntries(itemArr.map((i: any) => [i.id, i.title]));

      let comments: any[] = [];
      if (itemIds.length > 0) {
        const { data } = await supabase
          .from("checklist_comments")
          .select("id, checklist_item_id, user_name, comment, created_at")
          .in("checklist_item_id", itemIds)
          .order("created_at", { ascending: false })
          .limit(60);
        comments = data ?? [];
      }

      const events: ChecklistActivityEvent[] = [];

      comments.forEach((c: any) => {
        events.push({
          id: c.id,
          type: "comment",
          itemId: c.checklist_item_id,
          itemTitle: itemMap[c.checklist_item_id] ?? "Unknown",
          who: c.user_name ?? "Unknown",
          when: c.created_at,
          text: c.comment,
        });
      });

      itemArr
        .filter((i: any) => i.completed && i.completed_at)
        .forEach((i: any) => {
          events.push({
            id: `comp-${i.id}`,
            type: "completion",
            itemId: i.id,
            itemTitle: i.title,
            who: i.completed_by ?? "Someone",
            when: i.completed_at,
          });
        });

      return events.sort((a, b) => b.when.localeCompare(a.when)).slice(0, 40);
    },
  });
}
