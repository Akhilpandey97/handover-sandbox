import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tenantScope } from "@/lib/tenant-scope";
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
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  return useQuery({
    queryKey: ["ai_workflows", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_workflows")
        .select("*")
        .eq("tenant_id", tenantId)
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

export const useCreateWorkflow = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  return useMutation({
    mutationFn: async (workflow: Partial<Omit<AiWorkflow, "id" | "created_at" | "updated_at">>) => {
      const { error } = await supabase.from("ai_workflows").insert({
        name: workflow.name || "New workflow",
        description: workflow.description ?? null,
        trigger_type: workflow.trigger_type || "event",
        trigger_config: workflow.trigger_config || {},
        action_type: workflow.action_type || "send_notification",
        action_config: workflow.action_config || {},
        is_active: workflow.is_active ?? true,
        tenant_id: tenantScope(currentUser?.tenantId),
        created_by: currentUser?.id ?? null,
        created_by_name: currentUser?.name ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai_workflows"] });
      toast.success("Workflow created");
    },
    onError: () => toast.error("Failed to create workflow"),
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
