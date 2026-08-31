import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AiWorkflow {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: any;
  action_type: string;
  action_config: any;
  is_active: boolean;
  created_by_name: string | null;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
  updated_at: string;
}

export const useAiWorkflows = () => {
  return useQuery({
    queryKey: ["ai_workflows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_workflows")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as AiWorkflow[];
    },
  });
};

export const useToggleWorkflow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("ai_workflows")
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_workflows"] });
      toast.success("Workflow updated");
    },
    onError: () => toast.error("Failed to update workflow"),
  });
};

export const useUpdateWorkflow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Omit<AiWorkflow, "id" | "created_at" | "updated_at">> }) => {
      const { error } = await supabase
        .from("ai_workflows")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_workflows"] });
      toast.success("Workflow updated");
    },
    onError: () => toast.error("Failed to update workflow"),
  });
};

export const useDeleteWorkflow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("ai_workflows")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_workflows"] });
      toast.success("Workflow deleted");
    },
    onError: () => toast.error("Failed to delete workflow"),
  });
};
