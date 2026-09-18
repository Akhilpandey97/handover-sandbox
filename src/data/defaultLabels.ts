/**
 * Default workspace labels and colours, used when a workspace has not saved its
 * own in app_settings. Pure module: the app (LabelsContext) and Buddy's setup
 * tools both read it, so the defaults Buddy shows are the ones the app uses.
 */

export const DEFAULT_LABELS: Record<string, string> = {
  // General
  app_title: "Manager Dashboard",
  app_subtitle: "Handover — Project Management Hub",
  org_name: "Handover",

  // Team names live in the `teams` table (Settings → Checklist → Team Management)

  // Responsibility labels
  responsibility_internal: "Internal Team",
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
  // Plural of the customer record, for headings like "Weeks per Merchant".
  field_merchant_name_plural: "Merchants",
  field_mid: "MID",
  field_kick_off_date: "Start Date (Kick Off)",
  field_go_live_date: "Go-Live Date",
  field_arr: "ARR",
  field_platform: "Platform",
  field_project_state: "Project State",
  field_project_stage: "Project Stage",
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
  field_contact_email: "Merchant Contact Email",
  field_sow_link: "SOW Link",

  // Credentials — defaults match what the Edit dialog already showed, so
  // adding them changes nothing on screen until a tenant renames one. The
  // product names here (KwikPass, MCP, KP) are exactly what a white-labelled
  // tenant needs to be able to change.
  field_sandbox_mid: "Sandbox MID",
  field_sandbox_app_id: "App ID",
  field_sandbox_app_secret: "App Secret",
  field_sandbox_base_url: "Base URL",
  field_sandbox_config_id: "Sandbox Config ID",
  field_sandbox_kwikpass_jwe_key: "KwikPass JWE Key",
  field_payment_simulator_link: "Payment Simulator Link",
  field_prod_mid: "Production MID",
  field_prod_app_id: "App ID",
  field_prod_app_secret: "App Secret",
  field_prod_base_url: "Base URL",
  field_prod_config_id: "Production Config ID",
  field_prod_kwikpass_jwe_key: "KwikPass JWE Key (Production)",
  field_mcp_config_id: "MCP Config ID",
  field_mcp_enabled: "Enable MCP Document for Merchant",
  field_kp_enabled: "Enable KP for Merchant",
  field_kp_prod_jwe_key: "KP Production JWE Key",
  field_kp_sandbox_jwe_key: "KP Sandbox JWE Key",

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
