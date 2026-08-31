import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { logActivity } from "@/hooks/useActivityLogs";

export interface ChecklistTask {
  id: string;
  checklist_item_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  assigned_to: string | null;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tenant_id: string | null;
}

export const useChecklistTasks = (projectId?: string) => {
  return useQuery({
    queryKey: ["checklist-tasks", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_tasks")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ChecklistTask[];
    },
  });
};

export const useChecklistTasksByItem = (checklistItemId?: string) => {
  return useQuery({
    queryKey: ["checklist-tasks-item", checklistItemId],
    enabled: !!checklistItemId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_tasks")
        .select("*")
        .eq("checklist_item_id", checklistItemId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ChecklistTask[];
    },
  });
};

export const useAddChecklistTask = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async (task: {
      checklist_item_id: string;
      project_id: string;
      title: string;
      description?: string;
      priority?: string;
      assigned_to?: string;
      due_date?: string;
    }) => {
      const { data, error } = await supabase
        .from("checklist_tasks")
        .insert({
          ...task,
          status: "open",
          priority: task.priority || "medium",
          created_by: currentUser?.name || "Unknown",
          tenant_id: currentUser?.tenantId || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["checklist-tasks", variables.project_id] });
      queryClient.invalidateQueries({ queryKey: ["checklist-tasks-item", variables.checklist_item_id] });
      toast.success("Task created");
      logActivity({ action_type: "user", category: "checklist", description: `Created task "${variables.title}"`, entity_type: "project", entity_id: variables.project_id });
    },
    onError: (err: any) => toast.error(err.message || "Failed to create task"),
  });
};

export const useUpdateChecklistTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ChecklistTask> & { id: string }) => {
      const { error } = await supabase
        .from("checklist_tasks")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["checklist-tasks-item"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to update task"),
  });
};

export const useDeleteChecklistTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("checklist_tasks")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["checklist-tasks-item"] });
      toast.success("Task deleted");
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete task"),
  });
};
