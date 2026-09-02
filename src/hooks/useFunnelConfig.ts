import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  DEFAULT_FUNNEL_STAGES,
  FUNNEL_SETTINGS_KEY,
  FunnelStageRule,
  parseFunnelStages,
  setActiveFunnelStages,
} from "@/data/funnelConfig";

/** Tenant-scoped project stage configuration stored in app_settings. */
export const useFunnelConfig = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId || null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["funnel_stages_config", tenantId],
    enabled: !!currentUser,
    queryFn: async (): Promise<FunnelStageRule[]> => {
      let query = supabase.from("app_settings").select("value").eq("key", FUNNEL_SETTINGS_KEY);
      query = tenantId ? query.eq("tenant_id", tenantId) : query.is("tenant_id", null);
      const { data, error } = await query.maybeSingle();
      if (error) return DEFAULT_FUNNEL_STAGES;
      return parseFunnelStages((data as { value?: string } | null)?.value);
    },
    staleTime: 10 * 60 * 1000,
  });

  const saveStages = useCallback(
    async (stages: FunnelStageRule[]) => {
      const { error } = await supabase.from("app_settings").upsert(
        {
          key: FUNNEL_SETTINGS_KEY,
          value: JSON.stringify(stages),
          category: "funnel",
          tenant_id: tenantId,
        },
        { onConflict: "key,tenant_id" },
      );
      if (error) throw error;
      queryClient.setQueryData(["funnel_stages_config", tenantId], stages);
    },
    [tenantId, queryClient],
  );

  const stages = data || DEFAULT_FUNNEL_STAGES;

  // Keep the runtime registry in sync so non-hook helpers stay tenant-aware
  useEffect(() => { setActiveFunnelStages(stages); }, [stages]);

  return { stages, isLoading, saveStages };
};
