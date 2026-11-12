import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MerchantPortalUpload {
  id: string;
  project_id: string;
  upload_type: string;
  file_name: string;
  file_url: string;
  uploaded_by: string | null;
  created_at: string;
  notes: string | null;
}

export const useMerchantPortalUploads = (projectId?: string) => {
  return useQuery({
    queryKey: ["merchant-portal-uploads", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("merchant_portal_uploads")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data || []) as MerchantPortalUpload[];
      // Generate short-lived signed URLs so the internal view can open private files
      return Promise.all(
        rows.map(async (row) => {
          // Skip if already a full URL (e.g. legacy public bucket rows)
          if (row.file_url.startsWith("http")) return row;
          const { data: signed } = await supabase.storage
            .from("merchant-portal-files")
            .createSignedUrl(row.file_url, 3600);
          return { ...row, file_url: signed?.signedUrl ?? row.file_url };
        }),
      );
    },
  });
};

export const useDeleteMerchantPortalUpload = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("merchant_portal_uploads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merchant-portal-uploads"] });
    },
  });
};
