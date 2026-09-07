import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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
    // Callers fire this without awaiting a result, so a swallowed failure looks
    // exactly like "notifications are broken" with nothing to go on.
    console.error("Failed to create notifications:", error);
    toast.error("Notification not sent", { description: error.message });
  }
};

export const useNotifications = () => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const userId = currentUser?.id;

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
      return (data || []) as AppNotification[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
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
