import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sendNotification } from "@/utils/sendNotification";

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  actor_name: string | null;
  project_id: string | null;
  project_name: string | null;
  checklist_item_id: string | null;
  checklist_item_title: string | null;
  task_id: string | null;
  comment_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CreateNotificationInput {
  user_id: string;
  type: "mention" | "task_assigned" | "task_pending" | string;
  title: string;
  body?: string | null;
  actor_name?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  checklist_item_id?: string | null;
  checklist_item_title?: string | null;
  task_id?: string | null;
  comment_id?: string | null;
  tenant_id?: string | null;
}

export const createNotifications = async (rows: CreateNotificationInput[]) => {
  if (rows.length === 0) return;
  const { error } = await supabase.from("notifications").insert(rows as never);
  if (error) {
    console.error("Failed to create notifications:", error);
    toast.error("Notification not sent", { description: error.message });
    return;
  }

  // Also send an email for each in-app notification (fire-and-forget)
  const uniqueUserIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, email")
    .in("id", uniqueUserIds);

  const profileMap = new Map<string, { name: string; email: string }>(
    ((profiles || []) as { id: string; name: string; email: string }[])
      .filter((p) => p.email)
      .map((p) => [p.id, { name: p.name, email: p.email }]),
  );

  for (const row of rows) {
    const recipient = profileMap.get(row.user_id);
    if (!recipient) continue;
    // Only email notification types that have an email template
    if (!["task_assigned", "mention"].includes(row.type)) continue;
    void sendNotification({
      type: row.type as "task_assigned" | "mention",
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      projectName: row.project_name || "a project",
      assignedBy: row.actor_name || undefined,
      notes: row.type === "mention" ? (row.body || undefined) : (row.checklist_item_title || undefined),
      projectId: row.project_id || undefined,
      checklistItemId: row.checklist_item_id || undefined,
      taskId: row.task_id || undefined,
      commentId: row.comment_id || undefined,
    });
  }
};

export const useNotifications = () => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const userId = currentUser?.id;
  // Track IDs we've already seen so we don't toast on initial load
  const seenIdsRef = useRef<Set<string> | null>(null);

  const query = useQuery({
    queryKey: ["notifications", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data || []) as AppNotification[];
      // Seed seen-IDs on first fetch so only future inserts trigger toasts
      if (seenIdsRef.current === null) {
        seenIdsRef.current = new Set(rows.map((r) => r.id));
      }
      return rows;
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as AppNotification;
          queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
          // Only show toast if this is genuinely new (not from initial load)
          if (seenIdsRef.current && !seenIdsRef.current.has(n.id)) {
            seenIdsRef.current.add(n.id);
            // Fire a DOM event — the NotificationToastListener component renders the JSX
            window.dispatchEvent(new CustomEvent("app:notification", { detail: n }));
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return query;
};

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", currentUser?.id] });
    },
  });
};
