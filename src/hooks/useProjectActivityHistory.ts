import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ActivityEntry {
  id: string;
  category: string;
  description: string;
  userName: string | null;
  timestamp: string;
  metadata?: any;
  source: "activity_log" | "comment_log" | "checklist_comment" | "portal_visit";
}

export const useProjectActivityHistory = (projectId: string | undefined) => {
  return useQuery({
    queryKey: ["project_activity_history", projectId],
    queryFn: async (): Promise<ActivityEntry[]> => {
      if (!projectId) return [];

      // 1. Activity logs for this project
      const { data: activityLogs } = await supabase
        .from("activity_logs")
        .select("*")
        .eq("entity_id", projectId)
        .order("created_at", { ascending: false })
        .limit(500);

      // 2. Project comment logs
      const { data: commentLogs } = await supabase
        .from("project_comment_logs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(500);

      // 3. Checklist comments via checklist_items
      const { data: checklistItems } = await supabase
        .from("checklist_items")
        .select("id, title")
        .eq("project_id", projectId);

      const itemIds = (checklistItems ?? []).map((i: any) => i.id);
      const itemMap = Object.fromEntries((checklistItems ?? []).map((i: any) => [i.id, i.title]));

      let checklistComments: any[] = [];
      if (itemIds.length > 0) {
        const { data } = await supabase
          .from("checklist_comments")
          .select("*")
          .in("checklist_item_id", itemIds)
          .order("created_at", { ascending: false })
          .limit(500);
        checklistComments = data ?? [];
      }

      // 4. Merchant portal visits (customer portal activity)
      const { data: portalVisits } = await supabase
        .from("merchant_portal_visits")
        .select("*")
        .eq("project_id", projectId)
        .order("visited_at", { ascending: false })
        .limit(500);

      // Merge into unified entries
      const entries: ActivityEntry[] = [];

      for (const log of activityLogs ?? []) {
        entries.push({
          id: log.id,
          category: log.category || "project",
          description: log.description,
          userName: log.user_name,
          timestamp: log.created_at,
          metadata: log.metadata,
          source: "activity_log",
        });
      }

      for (const cl of commentLogs ?? []) {
        entries.push({
          id: cl.id,
          category: "comment",
          description: `Comment on "${cl.field_name}": ${cl.content}`,
          userName: cl.author_name,
          timestamp: cl.created_at,
          source: "comment_log",
        });
      }

      for (const cc of checklistComments) {
        const itemTitle = itemMap[cc.checklist_item_id] || "checklist item";
        entries.push({
          id: cc.id,
          category: "checklist",
          description: `Commented on "${itemTitle}": ${cc.comment}`,
          userName: cc.user_name,
          timestamp: cc.created_at,
          metadata: cc.attachment_url ? { attachment: cc.attachment_url } : undefined,
          source: "checklist_comment",
        });
      }

      for (const pv of portalVisits ?? []) {
        entries.push({
          id: pv.id,
          category: "portal",
          description: `Customer viewed the portal${pv.page ? ` — ${pv.page}` : ""}`,
          userName: pv.email || "Customer",
          timestamp: pv.visited_at,
          metadata: { page: pv.page, sessionId: pv.session_id },
          source: "portal_visit",
        });
      }

      // Sort by timestamp descending
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return entries;
    },
    enabled: !!projectId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
};
