import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_EGL_RULES, EGL_SETTINGS_KEY, EglRule, parseEglRules } from "@/data/eglRisk";

/** Tenant-scoped go-live risk rules, stored in app_settings like the other configs. */
export const useEglRules = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId || null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["egl_risk_config", tenantId],
    enabled: !!currentUser,
    queryFn: async (): Promise<EglRule[]> => {
      let query = supabase.from("app_settings").select("value").eq("key", EGL_SETTINGS_KEY);
      query = tenantId ? query.eq("tenant_id", tenantId) : query.is("tenant_id", null);
      const { data, error } = await query.maybeSingle();
      if (error) return DEFAULT_EGL_RULES;
      return parseEglRules((data as { value?: string } | null)?.value);
    },
    staleTime: 10 * 60 * 1000,
  });

  const saveRules = useCallback(
    async (rules: EglRule[]) => {
      const { error } = await supabase.from("app_settings").upsert(
        {
          key: EGL_SETTINGS_KEY,
          value: JSON.stringify(rules),
          category: "risk",
          tenant_id: tenantId,
        },
        { onConflict: "key,tenant_id" },
      );
      if (error) throw error;
      queryClient.setQueryData(["egl_risk_config", tenantId], rules);
    },
    [tenantId, queryClient],
  );

  return { rules: data || DEFAULT_EGL_RULES, isLoading, saveRules };
};
