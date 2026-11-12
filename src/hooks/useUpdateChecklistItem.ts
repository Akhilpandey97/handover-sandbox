import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ChecklistItemPatch {
  start_date?: string | null;
  due_date?: string | null;
  status?: 'todo' | 'in_progress' | 'blocked' | 'done';
  completed?: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  sort_order?: number;
  title?: string;
  current_responsibility?: 'gokwik' | 'merchant' | 'neutral' | null;
  owner_team?: string;
}

export function useUpdateChecklistItem(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ChecklistItemPatch }) => {
      // Keep completed boolean in sync with status
      const payload: ChecklistItemPatch = { ...patch };
      if (patch.status === 'done' && patch.completed === undefined) {
        payload.completed = true;
        payload.completed_at = new Date().toISOString();
      } else if (patch.status && patch.status !== 'done' && patch.completed === undefined) {
        payload.completed = false;
        payload.completed_at = null;
      }

      const { error } = await supabase
        .from("checklist_items")
        .update(payload)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ["checklist_items", projectId] });
      }
    },
  });
}
