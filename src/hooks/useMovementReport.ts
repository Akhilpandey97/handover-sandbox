import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tenantScope } from "@/lib/tenant-scope";

export interface MovementChange {
  field: string;
  from: string;
  to: string;
}

export interface MovementEntry {
  id: string;
  category: string;
  actionType?: string;
  description: string;
  userName: string | null;
  timestamp: string;
  metadata?: any;
  changes?: MovementChange[];
  source: "activity_log" | "comment_log" | "checklist_comment";
}

const fetchAll = async <T,>(
  build: (from: number, to: number) => any
): Promise<T[]> => {
  const pageSize = 1000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
};

export const useMovementReport = (timeframe: "daily" | "weekly") => {
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  return useQuery({
    queryKey: ["movement_report", tenantId, timeframe],
    queryFn: async (): Promise<Record<string, MovementEntry[]>> => {
      // Strict calendar window in IST (UTC+5:30):
      //  - daily  = today 00:00 IST → now
      //  - weekly = Monday 00:00 IST of current week → now
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const nowUtcMs = Date.now();
      const nowIst = new Date(nowUtcMs + IST_OFFSET_MS);
      const istYear = nowIst.getUTCFullYear();
      const istMonth = nowIst.getUTCMonth();
      const istDate = nowIst.getUTCDate();
      const istDay = nowIst.getUTCDay(); // 0 = Sun
      const daysSinceMonday = (istDay + 6) % 7; // Mon=0 ... Sun=6

      const startOfTodayIstUtcMs = Date.UTC(istYear, istMonth, istDate) - IST_OFFSET_MS;
      const startOfWeekIstUtcMs = startOfTodayIstUtcMs - daysSinceMonday * 24 * 3600 * 1000;
      const since = new Date(timeframe === "daily" ? startOfTodayIstUtcMs : startOfWeekIstUtcMs).toISOString();
      const until = new Date(nowUtcMs).toISOString();


      const activityLogs = await fetchAll<any>((from, to) =>
        supabase
          .from("activity_logs")
          .select("id, entity_id, entity_type, category, action_type, description, user_name, metadata, created_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", since)
          .lte("created_at", until)
          .order("created_at", { ascending: false })
          .range(from, to)
      );

      const commentLogs = await fetchAll<any>((from, to) =>
        supabase
          .from("project_comment_logs")
          .select("id, project_id, field_name, content, author_name, created_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", since)
          .lte("created_at", until)
          .order("created_at", { ascending: false })
          .range(from, to)
      );

      const checklistComments = await fetchAll<any>((from, to) =>
        supabase
          .from("checklist_comments")
          .select("id, checklist_item_id, comment, user_name, created_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", since)
          .lte("created_at", until)
          .order("created_at", { ascending: false })
          .range(from, to)
      );

      const itemIds = Array.from(new Set(checklistComments.map((c: any) => c.checklist_item_id))).filter(Boolean);
      let itemMap: Record<string, { project_id: string; title: string }> = {};
      if (itemIds.length > 0) {
        const items = await fetchAll<any>((from, to) =>
          supabase
            .from("checklist_items")
            .select("id, project_id, title")
            .in("id", itemIds as string[])
            .range(from, to)
        );
        itemMap = Object.fromEntries(items.map((i: any) => [i.id, { project_id: i.project_id, title: i.title }]));
      }

      const grouped: Record<string, MovementEntry[]> = {};
      const push = (projectId: string | undefined | null, entry: MovementEntry) => {
        if (!projectId) return;
        if (!grouped[projectId]) grouped[projectId] = [];
        grouped[projectId].push(entry);
      };

      for (const log of activityLogs) {
        if (log.entity_type && log.entity_type !== "project") continue;
        const md = log.metadata || {};
        const changes: MovementChange[] | undefined = Array.isArray(md.changes) ? md.changes : undefined;
        push(log.entity_id, {
          id: log.id,
          category: log.category || "project",
          actionType: log.action_type,
          description: log.description,
          userName: log.user_name,
          timestamp: log.created_at,
          metadata: md,
          changes,
          source: "activity_log",
        });
      }

      for (const cl of commentLogs) {
        push(cl.project_id, {
          id: cl.id,
          category: "comment",
          description: `Comment on "${cl.field_name}": ${cl.content}`,
          userName: cl.author_name,
          timestamp: cl.created_at,
          metadata: { field: cl.field_name, content: cl.content },
          source: "comment_log",
        });
      }

      for (const cc of checklistComments) {
        const item = itemMap[cc.checklist_item_id];
        if (!item) continue;
        push(item.project_id, {
          id: cc.id,
          category: "checklist",
          description: `Commented on "${item.title}": ${cc.comment}`,
          userName: cc.user_name,
          timestamp: cc.created_at,
          metadata: { itemTitle: item.title, comment: cc.comment, attachment: cc.attachment_url },
          source: "checklist_comment",
        });
      }

      // Sort each project's entries newest first
      for (const k of Object.keys(grouped)) {
        grouped[k].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      return grouped;
    },
    staleTime: 60_000,
  });
};
