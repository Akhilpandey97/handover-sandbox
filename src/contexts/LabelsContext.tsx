import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFunnelConfig } from "@/hooks/useFunnelConfig";

// Default labels - used as fallback when DB has no overrides
const DEFAULT_LABELS: Record<string, string> = {
  // General
  app_title: "Manager Dashboard",
  app_subtitle: "Project Management Hub",
  org_name: "Handover",

  // Team labels
  team_mint: "MINT (Presales)",
  team_integration: "MINT",
  team_ms: "MS (Merchant Success)",
  team_manager: "Manager",

  // Responsibility labels
  responsibility_internal: "GoKwik",
  responsibility_external: "Merchant",
  responsibility_neutral: "Neutral",

  // Phase labels
  phase_mint: "MINT",
  phase_integration: "Integration",
  phase_ms: "MS",
  phase_completed: "Completed",

  // State labels
  state_not_started: "Not Started",
  state_on_hold: "On-Hold",
  state_in_progress: "In Progress",
  state_live: "Live",
  state_blocked: "Blocked",

  // Field labels
  field_merchant_name: "Merchant Name",
  field_mid: "MID",
  field_kick_off_date: "Start Date (Kick Off)",
  field_go_live_date: "Go-Live Date",
  field_arr: "ARR",
  field_platform: "Platform",
  field_integration_type: "Integration Type",
  field_sales_spoc: "Sales SPOC",
  field_assigned_owner: "Assigned Owner",
  field_project_notes: "Project Notes",
  field_category: "Category",
  field_brand_url: "Brand URL",
  field_jira_link: "JIRA Link",
  field_brd_link: "BRD Link",
  field_mint_checklist_link: "MINT Checklist Link",
  field_integration_checklist_link: "Integration Checklist Link",
  field_txns_per_day: "Txns/Day",
  field_aov: "AOV",
  field_pg_onboarding: "PG Onboarding",
  field_go_live_percent: "Go Live %",
  field_expected_go_live_date: "Expected Go Live Date",
  field_actual_go_live_date: "Actual Go Live Date",
  field_mint_notes: "MINT Notes",
  field_current_phase_comment: "Current Phase Comment",
  field_phase2_comment: "Phase 2 Comment",

  // Color settings - team badge colors
  color_team_mint_badge: "#3b82f6",
  color_team_integration_badge: "#a855f7",
  color_team_ms_badge: "#10b981",
  color_team_completed_badge: "#6b7280",

  // Color settings - card background colors (light mode)
  color_card_mint_bg: "#eff6ff",
  color_card_integration_bg: "#faf5ff",
  color_card_ms_bg: "#ecfdf5",
  color_card_completed_bg: "#f9fafb",

  // Color settings - project state badge colors
  color_state_not_started: "#6b7280",
  color_state_on_hold: "#f59e0b",
  color_state_in_progress: "#3b82f6",
  color_state_live: "#10b981",
  color_state_blocked: "#ef4444",

  // Color settings - KPI overview cards
  color_kpi_total: "#3b82f6",
  color_kpi_pending: "#f59e0b",
  color_kpi_active: "#3b82f6",
  color_kpi_live: "#10b981",

  // Color settings - Team performance mini cards
  color_team_perf_total: "#6b7280",
  color_team_perf_pending: "#f59e0b",
  color_team_perf_active: "#3b82f6",
  color_team_perf_completed: "#10b981",

  // Color settings - Time distribution cards
  color_time_internal: "#3b82f6",
  color_time_external: "#f59e0b",
};

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

export const LabelsProvider = ({ children }: { children: ReactNode }) => {
  const { currentUser } = useAuth();
  // Loads tenant funnel stages into the runtime registry used across the app
  useFunnelConfig();
  const [labels, setLabels] = useState<Record<string, string>>(DEFAULT_LABELS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLabels = async () => {
      try {
        let query = supabase.from("app_settings").select("key, value");
        if (currentUser?.tenantId) {
          query = query.eq("tenant_id", currentUser.tenantId);
        }
        const { data, error } = await query;
        if (!error && data) {
          const merged = { ...DEFAULT_LABELS };
          data.forEach((row: { key: string; value: string }) => {
            merged[row.key] = row.value;
          });
          setLabels(merged);
        }
      } catch (e) {
        console.error("Failed to fetch labels:", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchLabels();
  }, [currentUser?.tenantId]);

  const getLabel = useCallback((key: string) => labels[key] || DEFAULT_LABELS[key] || key, [labels]);

  const updateLabel = useCallback(async (key: string, value: string) => {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, category: key.split("_")[0], tenant_id: currentUser?.tenantId || null }, { onConflict: "key,tenant_id" });
    if (!error) {
      setLabels((prev) => ({ ...prev, [key]: value }));
    }
  }, [currentUser?.tenantId]);

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
  }, [currentUser?.tenantId]);

  const teamLabels: Record<string, string> = {
    mint: labels.team_mint,
    integration: labels.team_integration,
    ms: labels.team_ms,
    manager: labels.team_manager,
    super_admin: "Super Admin",
    gokwik_general: "GoKwik General",
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
