import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { logActivity } from "@/hooks/useActivityLogs";

export interface ProjectRisk {
  id: string;
  project_id: string;
  tenant_id: string | null;
  title: string;
  description: string | null;
  category: string;
  severity: string;
  status: string;
  trigger_type: string;
  trigger_rule: string | null;
  mitigation_plan: string | null;
  mitigation_due_at: string | null;
  assigned_to: string | null;
  escalated: boolean;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type RiskInsert = Omit<ProjectRisk, "id" | "created_at" | "updated_at">;

export const useProjectRisks = () => {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const tenantId = currentUser?.tenantId;

  const { data: risks = [], isLoading } = useQuery({
    queryKey: ["project_risks", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_risks" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectRisk[];
    },
    enabled: !!currentUser,
    staleTime: 30_000,
  });

  const createRisk = useMutation({
    mutationFn: async (risk: Partial<RiskInsert>) => {
      const payload = {
        ...risk,
        tenant_id: tenantId,
        created_by: currentUser?.name ?? currentUser?.email ?? "unknown",
      };
      const { data, error } = await supabase
        .from("project_risks" as any)
        .insert(payload as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as ProjectRisk;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project_risks"] });
      toast({ title: "Risk created" });
      const d = data as any;
      if (d?.project_id) logActivity({ action_type: "user", category: "risk", description: `Created risk "${d.title}"`, entity_type: "project", entity_id: d.project_id });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateRisk = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectRisk> & { id: string }) => {
      const { error } = await supabase
        .from("project_risks" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_risks"] });
      toast({ title: "Risk updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteRisk = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("project_risks" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project_risks"] });
      toast({ title: "Risk deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return { risks, isLoading, createRisk, updateRisk, deleteRisk };
};
