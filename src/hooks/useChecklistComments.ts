import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ChecklistComment {
  id: string;
  checklist_item_id: string;
  user_name: string;
  user_id: string | null;
  comment: string;
  attachment_url: string | null;
  attachment_name: string | null;
  created_at: string;
}

export const useChecklistComments = (checklistItemId: string | null) => {
  return useQuery({
    queryKey: ["checklist-comments", checklistItemId],
    staleTime: 60_000, // 1 min — comments don't change often
    queryFn: async () => {
      if (!checklistItemId) return [];
      const { data, error } = await supabase
        .from("checklist_comments")
        .select("*")
        .eq("checklist_item_id", checklistItemId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as ChecklistComment[];
    },
    enabled: !!checklistItemId,
  });
};

export const useAddChecklistComment = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async ({
      checklistItemId,
      comment,
      file,
    }: {
      checklistItemId: string;
      comment: string;
      file?: File;
    }) => {
      if (!currentUser) throw new Error("Not authenticated");

      let attachmentUrl: string | null = null;
      let attachmentName: string | null = null;

      // Upload file if provided
      if (file) {
        const fileExt = file.name.split(".").pop();
        const filePath = `${checklistItemId}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("checklist-attachments")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("checklist-attachments")
          .getPublicUrl(filePath);

        attachmentUrl = urlData.publicUrl;
        attachmentName = file.name;
      }

      const { data, error } = await supabase
        .from("checklist_comments")
        .insert({
          checklist_item_id: checklistItemId,
          user_name: currentUser.name,
          user_id: currentUser.id,
          comment,
          attachment_url: attachmentUrl,
          attachment_name: attachmentName,
          tenant_id: currentUser.tenantId || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["checklist-comments", variables.checklistItemId],
      });
      toast.success("Comment added");
    },
    onError: (error) => {
      console.error("Error adding comment:", error);
      toast.error("Failed to add comment");
    },
  });
};

export const useDeleteChecklistComment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      commentId,
      checklistItemId,
    }: {
      commentId: string;
      checklistItemId: string;
    }) => {
      const { error } = await supabase
        .from("checklist_comments")
        .delete()
        .eq("id", commentId);

      if (error) throw error;
      return { commentId, checklistItemId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["checklist-comments", data.checklistItemId],
      });
    },
    onError: (error) => {
      console.error("Error deleting comment:", error);
      toast.error("Failed to delete comment");
    },
  });
};
