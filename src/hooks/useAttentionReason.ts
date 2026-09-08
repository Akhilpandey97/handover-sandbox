import { useQuery, useQueryClient } from "@tanstack/react-query";

export type AttentionKind = "risk" | "egl";

export interface AttentionReason {
  why: string;
  recommendation: string;
  evidence?: string[];
  generated_at?: string;
  cached?: boolean;
}

const call = async (
  projectId: string,
  kind: AttentionKind,
  reasons: string[],
  force = false,
): Promise<AttentionReason> => {
  const res = await fetch("/api/public/ai-attention-reason", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]}`,
      apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
    },
    body: JSON.stringify({ projectId, kind, reasons, force }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || "AI request failed");
  return payload.result as AttentionReason;
};

/**
 * AI prose for one project's rule findings. Fetched lazily (only when the
 * caller is actually showing it) and cached server-side by reason hash, so
 * reopening a popover is free.
 */
export const useAttentionReason = (
  projectId: string | undefined,
  kind: AttentionKind,
  reasons: string[],
  enabled: boolean,
) => {
  const queryClient = useQueryClient();
  const key = ["attention_reason", kind, projectId, reasons.join("|")];

  const query = useQuery({
    queryKey: key,
    enabled: enabled && !!projectId && reasons.length > 0,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: () => call(projectId!, kind, reasons),
  });

  const regenerate = async () => {
    if (!projectId || reasons.length === 0) return;
    const fresh = await call(projectId, kind, reasons, true);
    queryClient.setQueryData(key, fresh);
  };

  return { reason: query.data, isLoading: query.isLoading || query.isFetching, error: query.error, regenerate };
};
