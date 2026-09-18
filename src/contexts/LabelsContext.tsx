import { createContext, useContext, useCallback, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFunnelConfig } from "@/hooks/useFunnelConfig";
import { useTeams } from "@/hooks/useTeams";
import { DEFAULT_LABELS, withDerivedLabels } from "@/data/defaultLabels";

interface LabelsContextType {
  labels: Record<string, string>;
  getLabel: (key: string) => string;
  updateLabel: (key: string, value: string) => Promise<void>;
  updateLabels: (updates: Record<string, string>) => Promise<void>;
  isLoading: boolean;
  // Convenience getters
  teamLabels: Record<string, string>;
  responsibilityLabels: Record<string, string>;
  phaseLabels: Record<string, string>;
  stateLabels: Record<string, string>;
}

const LabelsContext = createContext<LabelsContextType | null>(null);

export const useLabels = () => {
  const ctx = useContext(LabelsContext);
  if (!ctx) throw new Error("useLabels must be used within LabelsProvider");
  return ctx;
};

// Safe variant for code that may run outside the provider (e.g. sibling providers).
export const useLabelsOptional = () => useContext(LabelsContext);

export const LabelsProvider = ({ children }: { children: ReactNode }) => {
  const { currentUser } = useAuth();
  // Loads tenant project stages into the runtime registry used across the app
  useFunnelConfig();
  const { customTeams, teamLabelMap } = useTeams();
  const customTeamLabels: Record<string, string> = {};
  customTeams.forEach((t) => { customTeamLabels[t.slug] = t.name; });
  const queryClient = useQueryClient();
  const tenantId = currentUser?.tenantId ?? null;
  // Through the query cache rather than a one-off fetch, so a label changed
  // anywhere else (Buddy, another tab's save) shows as soon as queries refresh.
  const labelsKey = ["app_settings_labels", tenantId] as const;
  const { data: labels = DEFAULT_LABELS, isLoading: labelsLoading } = useQuery({
    queryKey: labelsKey,
    enabled: !!currentUser,
    staleTime: 60_000,
    queryFn: async () => {
      let query = supabase.from("app_settings").select("key, value");
      if (tenantId) query = query.eq("tenant_id", tenantId);
      const { data, error } = await query;
      const merged = { ...DEFAULT_LABELS };
      if (error) {
        console.error("Failed to fetch labels:", error);
        return merged;
      }
      (data || []).forEach((row: { key: string; value: string }) => {
        merged[row.key] = row.value;
      });
      return withDerivedLabels(merged);
    },
  });
  const isLoading = !!currentUser && labelsLoading;
  const setLabels = useCallback(
    (update: (prev: Record<string, string>) => Record<string, string>) =>
      queryClient.setQueryData<Record<string, string>>(labelsKey, (prev) => update(prev || DEFAULT_LABELS)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, tenantId],
  );

  const getLabel = useCallback((key: string) => labels[key] || DEFAULT_LABELS[key] || key, [labels]);

  const updateLabel = useCallback(async (key: string, value: string) => {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, category: key.split("_")[0], tenant_id: currentUser?.tenantId || null }, { onConflict: "key,tenant_id" });
    if (!error) {
      setLabels((prev) => ({ ...prev, [key]: value }));
    }
  }, [currentUser?.tenantId, setLabels]);

  const updateLabels = useCallback(async (updates: Record<string, string>) => {
    const rows = Object.entries(updates).map(([key, value]) => ({
      key,
      value,
      category: key.includes("_") ? key.substring(0, key.indexOf("_")) : "general",
      tenant_id: currentUser?.tenantId || null,
    }));
    const { error } = await supabase
      .from("app_settings")
      .upsert(rows, { onConflict: "key,tenant_id" });
    if (!error) {
      setLabels((prev) => ({ ...prev, ...updates }));
    }
  }, [currentUser?.tenantId, setLabels]);

  // Names come from Settings → Checklist → Team Management (the `teams` table).
  const teamLabels: Record<string, string> = {
    manager: "Manager",
    admin: "Admin",
    super_admin: "Super Admin",
    gokwik_general: "General",
    ...teamLabelMap,
    ...customTeamLabels,
  };


  const responsibilityLabels: Record<string, string> = {
    gokwik: labels.responsibility_internal,
    merchant: labels.responsibility_external,
    neutral: labels.responsibility_neutral,
  };

  const phaseLabels: Record<string, string> = {
    mint: labels.phase_mint,
    integration: labels.phase_integration,
    ms: labels.phase_ms,
    completed: labels.phase_completed,
  };

  const stateLabels: Record<string, string> = {
    not_started: labels.state_not_started,
    on_hold: labels.state_on_hold,
    in_progress: labels.state_in_progress,
    live: labels.state_live,
    blocked: labels.state_blocked,
  };

  return (
    <LabelsContext.Provider
      value={{
        labels,
        getLabel,
        updateLabel,
        updateLabels,
        isLoading,
        teamLabels,
        responsibilityLabels,
        phaseLabels,
        stateLabels,
      }}
    >
      {children}
    </LabelsContext.Provider>
  );
};
