import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_RISK_RULES, RISK_SETTINGS_KEY, RiskRule, parseRiskRules } from "@/data/riskRules";

/** Tenant-scoped risk rule configuration, stored in app_settings. */
export const useRiskRules = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId || null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["risk_rules_config", tenantId],
    enabled: !!currentUser,
    queryFn: async (): Promise<RiskRule[]> => {
      let query = supabase.from("app_settings").select("value").eq("key", RISK_SETTINGS_KEY);
      query = tenantId ? query.eq("tenant_id", tenantId) : query.is("tenant_id", null);
      const { data, error } = await query.maybeSingle();
      if (error) return DEFAULT_RISK_RULES;
      return parseRiskRules((data as { value?: string } | null)?.value);
    },
    staleTime: 10 * 60 * 1000,
  });

  const saveRules = useCallback(
    async (rules: RiskRule[]) => {
      const { error } = await supabase.from("app_settings").upsert(
        {
          key: RISK_SETTINGS_KEY,
          value: JSON.stringify(rules),
          category: "risk",
          tenant_id: tenantId,
        },
        { onConflict: "key,tenant_id" },
      );
      if (error) throw error;
      queryClient.setQueryData(["risk_rules_config", tenantId], rules);
    },
    [tenantId, queryClient],
  );

  return { rules: data || DEFAULT_RISK_RULES, isLoading, saveRules };
};
