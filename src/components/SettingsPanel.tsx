import { useState } from "react";
import { useLabels } from "@/contexts/LabelsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Save, RotateCcw, Settings, Palette, Tags, Layers, Mail, FileText, Zap, Activity, Bell, Plug } from "lucide-react";
import { LogoUpload } from "./LogoUpload";
import { CustomFieldsManager } from "./settings/CustomFieldsManager";
import { ChecklistFormsManager } from "./settings/ChecklistFormsManager";
import { ThemePresets } from "./settings/ThemePresets";
import { WorkflowsManager } from "./settings/WorkflowsManager";
import { ActivityLogViewer } from "./settings/ActivityLogViewer";
import { SlackAlertsSettings } from "./settings/SlackAlertsSettings";
import { FunnelStagesSettings } from "./settings/FunnelStagesSettings";
import { IntegrationsSettings } from "./settings/IntegrationsSettings";
import { usePermissions } from "@/hooks/usePermissions";
import { NoAccessCard } from "@/components/NoAccessCard";

interface LabelGroup {
  title: string;
  description: string;
  keys: { key: string; label: string }[];
}

const GENERAL_GROUPS: LabelGroup[] = [
  {
    title: "Application Branding",
    description: "Application name and branding",
    keys: [
      { key: "app_title", label: "Dashboard Title" },
      { key: "app_subtitle", label: "Dashboard Subtitle" },
      { key: "org_name", label: "Organisation Name" },
    ],
  },
  // Team names are managed in Settings → Checklist → Team Management, which is
  // the single source of truth for every team label across the product.

  {
    title: "Responsibility Parties",
    description: "Labels for internal vs external ownership",
    keys: [
      { key: "responsibility_internal", label: "Internal Party" },
      { key: "responsibility_external", label: "External Party" },
      { key: "responsibility_neutral", label: "Neutral State" },
    ],
  },
];

const WORKFLOW_GROUPS: LabelGroup[] = [
  {
    title: "Project States",
    description: "Status labels for projects",
    keys: [
      { key: "state_not_started", label: "State: Not Started" },
      { key: "state_on_hold", label: "State: On Hold" },
      { key: "state_in_progress", label: "State: Active" },
      { key: "state_live", label: "State: Live/Complete" },
      { key: "state_blocked", label: "State: Blocked" },
    ],
  },
];

const FIELD_GROUPS: LabelGroup[] = [
  {
    title: "Field Labels",
    description: "Labels for project data fields shown across the app",
    keys: [
      { key: "field_merchant_name", label: "Client/Merchant Name" },
      { key: "field_mid", label: "Client ID Field" },
      { key: "field_arr", label: "Revenue Metric" },
      { key: "field_platform", label: "Platform Label" },
      { key: "field_integration_type", label: "Integration Type Label" },
      { key: "field_sales_spoc", label: "Sales Contact Label" },
      { key: "field_assigned_owner", label: "Owner Label" },
      { key: "field_project_notes", label: "Notes Label" },
      { key: "field_category", label: "Category Label" },
      { key: "field_txns_per_day", label: "Txns/Day Label" },
      { key: "field_aov", label: "AOV Label" },
      { key: "field_pg_onboarding", label: "PG Onboarding Label" },
      { key: "field_go_live_percent", label: "Go Live % Label" },
      { key: "field_project_state", label: "Project State Label" },
      { key: "field_project_stage", label: "Project Stage Label" },
      { key: "field_kick_off_date", label: "Kick-off Date Label" },
      { key: "field_expected_go_live_date", label: "Expected Go-Live Label" },
      { key: "field_actual_go_live_date", label: "Actual Go-Live Label" },
    ],
  },
  {
    title: "Link Labels",
    description: "Labels for project link fields",
    keys: [
      { key: "field_brand_url", label: "Brand URL Label" },
      { key: "field_jira_link", label: "JIRA Link Label" },
      { key: "field_brd_link", label: "BRD Link Label" },
      { key: "field_mint_checklist_link", label: "MINT Checklist Link Label" },
      { key: "field_integration_checklist_link", label: "Integration Checklist Link Label" },
    ],
  },
  {
    title: "Date Labels",
    description: "Labels for project date fields",
    keys: [
      { key: "field_kick_off_date", label: "Start Date Label" },
      { key: "field_expected_go_live_date", label: "Expected Go Live Date Label" },
      { key: "field_actual_go_live_date", label: "Actual Go Live Date Label" },
    ],
  },
  {
    title: "Notes Labels",
    description: "Labels for project notes and comments",
    keys: [
      { key: "field_project_notes", label: "Project Notes Label" },
      { key: "field_mint_notes", label: "MINT Notes Label" },
      { key: "field_current_phase_comment", label: "Current Phase Comment Label" },
      { key: "field_phase2_comment", label: "Phase 2 Comment Label" },
    ],
  },
];

const EMAIL_GROUPS: LabelGroup[] = [
  {
    title: "Email Monitoring",
    description: "Configure the email address and subject keywords for auto-parsing new brand onboarding emails",
    keys: [
      { key: "email_monitor_address", label: "Sender Email Address (emails FROM this address)" },
      { key: "email_subject_keywords", label: "Subject Keywords (comma-separated)" },
    ],
  },
];

interface ColorLabelGroup {
  title: string;
  description: string;
  keys: { key: string; label: string }[];
}

const COLOR_GROUPS: ColorLabelGroup[] = [
  {
    title: "Team Badge Colours",
    description: "Set the badge colour for each team across project cards",
    keys: [
      { key: "color_team_mint_badge", label: "Team 1 (Presales) Badge" },
      { key: "color_team_integration_badge", label: "Team 2 (Integration) Badge" },
      { key: "color_team_ms_badge", label: "Team 3 (Post-Sales) Badge" },
      { key: "color_team_completed_badge", label: "Completed Badge" },
    ],
  },
  {
    title: "Card Background Colours",
    description: "Set the card tint colour for each team's projects",
    keys: [
      { key: "color_card_mint_bg", label: "Team 1 Card Background" },
      { key: "color_card_integration_bg", label: "Team 2 Card Background" },
      { key: "color_card_ms_bg", label: "Team 3 Card Background" },
      { key: "color_card_completed_bg", label: "Completed Card Background" },
    ],
  },
  {
    title: "Project State Badge Colours",
    description: "Set the colour for each project state badge",
    keys: [
      { key: "color_state_not_started", label: "Not Started" },
      { key: "color_state_on_hold", label: "On Hold" },
      { key: "color_state_in_progress", label: "In Progress" },
      { key: "color_state_live", label: "Live" },
      { key: "color_state_blocked", label: "Blocked" },
    ],
  },
  {
    title: "Overview KPI Card Colours",
    description: "Set the accent colour for each KPI card on the Overview tab",
    keys: [
      { key: "color_kpi_total", label: "Total Card" },
      { key: "color_kpi_pending", label: "Pending Card" },
      { key: "color_kpi_active", label: "Active Card" },
      { key: "color_kpi_live", label: "Live Card" },
    ],
  },
  {
    title: "Team Performance Card Colours",
    description: "Set the colour for each mini stat card inside Team Performance",
    keys: [
      { key: "color_team_perf_total", label: "Total" },
      { key: "color_team_perf_pending", label: "Pending" },
      { key: "color_team_perf_active", label: "Active" },
      { key: "color_team_perf_completed", label: "Completed" },
    ],
  },
  {
    title: "Time Distribution Card Colours",
    description: "Set the colour for the internal and external time cards",
    keys: [
      { key: "color_time_internal", label: "Internal Time" },
      { key: "color_time_external", label: "External Time" },
    ],
  },
];

interface SettingsPanelProps {
  activeSubTab?: string;
}

export const SettingsPanel = ({ activeSubTab }: SettingsPanelProps) => {
  const perms = usePermissions();
  const { labels, updateLabels } = useLabels();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const getValue = (key: string) => draft[key] ?? labels[key] ?? "";

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (Object.keys(draft).length === 0) {
      toast.info("No changes to save");
      return;
    }
    setIsSaving(true);
    try {
      await updateLabels(draft);
      setDraft({});
      toast.success("Labels updated! Changes apply globally across the app.");
    } catch {
      toast.error("Failed to save labels");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setDraft({});
    toast.info("Reverted unsaved changes");
  };

  const hasChanges = Object.keys(draft).length > 0;

  const renderLabelGroups = (groups: LabelGroup[]) => (
    <div className="space-y-8">
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <Separator className="mb-6" />}
          <h3 className="text-base font-semibold mb-1">{group.title}</h3>
          <p className="text-sm text-muted-foreground mb-4">{group.description}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.keys.map(({ key, label }) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={key} className="text-xs text-muted-foreground">{label}</Label>
                <Input
                  id={key}
                  value={getValue(key)}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className={draft[key] !== undefined ? "border-primary ring-1 ring-primary/20" : ""}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderColorGroups = (groups: ColorLabelGroup[]) => (
    <div className="space-y-8">
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <Separator className="mb-6" />}
          <h3 className="text-base font-semibold mb-1">{group.title}</h3>
          <p className="text-sm text-muted-foreground mb-4">{group.description}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {group.keys.map(({ key, label }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key} className="text-xs text-muted-foreground">{label}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    id={key}
                    value={getValue(key)}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="w-10 h-10 rounded-lg border border-border cursor-pointer p-0.5"
                  />
                  <Input
                    value={getValue(key)}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={`font-mono text-xs h-10 ${draft[key] !== undefined ? "border-primary ring-1 ring-primary/20" : ""}`}
                    placeholder="#000000"
                  />
                </div>
                <div className="h-6 rounded-md border border-border/50" style={{ backgroundColor: getValue(key) }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Save bar */}
      {hasChanges && (
        <div className="sticky top-0 z-10 flex items-center justify-between bg-background/95 backdrop-blur border border-border rounded-lg p-3">
          <p className="text-sm text-muted-foreground">
            You have <strong>{Object.keys(draft).length}</strong> unsaved change(s)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />Revert
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />{isSaving ? "Saving..." : "Save All Changes"}
            </Button>
          </div>
        </div>
      )}

      <Tabs value={activeSubTab || "general"} defaultValue="general" className="w-full">
        {!activeSubTab && (
          <TabsList className="flex flex-wrap h-auto gap-1 mb-4">
            <TabsTrigger value="general" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />General
            </TabsTrigger>
            <TabsTrigger value="fields" className="gap-1.5">
              <Tags className="h-3.5 w-3.5" />Field Labels
            </TabsTrigger>
            <TabsTrigger value="custom-fields" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />Custom Fields
            </TabsTrigger>
            <TabsTrigger value="checklist-forms" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />Checklist Forms
            </TabsTrigger>
            <TabsTrigger value="colours" className="gap-1.5">
              <Palette className="h-3.5 w-3.5" />Colours
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5">
              <Mail className="h-3.5 w-3.5" />Add New Projects
            </TabsTrigger>
            <TabsTrigger value="workflows" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" />Workflows
            </TabsTrigger>
            <TabsTrigger value="slack-alerts" className="gap-1.5">
              <Bell className="h-3.5 w-3.5" />Slack Alerts
            </TabsTrigger>
            <TabsTrigger value="funnel" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />Project Stages
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-1.5">
              <Plug className="h-3.5 w-3.5" />Integrations
            </TabsTrigger>
            <TabsTrigger value="activity-log" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />Activity Log
            </TabsTrigger>
          </TabsList>
        )}

        {/* General Tab */}
        <TabsContent value="general" className="space-y-6">
          {perms.canManageBranding && <LogoUpload />}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />General & Teams
              </CardTitle>
              <CardDescription>Application branding, team names, and responsibility labels</CardDescription>
            </CardHeader>
            <CardContent>{renderLabelGroups(GENERAL_GROUPS)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tags className="h-5 w-5" />Project States
              </CardTitle>
              <CardDescription>Configure project state labels</CardDescription>
            </CardHeader>
            <CardContent>{renderLabelGroups(WORKFLOW_GROUPS)}</CardContent>
          </Card>
        </TabsContent>

        {/* Integrations Tab */}
        <TabsContent value="integrations">
          {perms.canManageIntegrations ? <IntegrationsSettings /> : <NoAccessCard message="Integration credentials and API keys are managed by workspace admins." />}
        </TabsContent>


        {/* Field Labels Tab */}
        <TabsContent value="fields">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tags className="h-5 w-5" />Field Labels
              </CardTitle>
              <CardDescription>Customise labels for built-in project fields, links, dates, and notes</CardDescription>
            </CardHeader>
            <CardContent>{renderLabelGroups(FIELD_GROUPS)}</CardContent>
          </Card>
        </TabsContent>

        {/* Custom Fields Tab */}
        <TabsContent value="custom-fields">
          <CustomFieldsManager />
        </TabsContent>

        {/* Checklist Forms Tab */}
        <TabsContent value="checklist-forms">
          <ChecklistFormsManager />
        </TabsContent>

        {/* Colours Tab */}
        <TabsContent value="colours" className="space-y-6">
          <ThemePresets
            onApply={(colors) => {
              Object.entries(colors).forEach(([key, value]) => {
                handleChange(key, value);
              });
            }}
            currentColors={Object.fromEntries(
              COLOR_GROUPS.flatMap(g => g.keys).map(({ key }) => [key, getValue(key)])
            )}
          />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />Colours & Branding
              </CardTitle>
              <CardDescription>Fine-tune individual colours for team badges, card backgrounds, and state indicators</CardDescription>
            </CardHeader>
            <CardContent>{renderColorGroups(COLOR_GROUPS)}</CardContent>
          </Card>
        </TabsContent>

        {/* Email Tab */}
        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />Email Monitoring
              </CardTitle>
              <CardDescription>Configure email parsing for auto-creating projects from emails</CardDescription>
            </CardHeader>
            <CardContent>{renderLabelGroups(EMAIL_GROUPS)}</CardContent>
          </Card>
        </TabsContent>

        {/* Workflows Tab */}
        <TabsContent value="workflows">
          <WorkflowsManager />
        </TabsContent>

        {/* Slack Alerts Tab */}
        <TabsContent value="slack-alerts">
          <SlackAlertsSettings />
        </TabsContent>

        {/* Project Stages Tab */}
        <TabsContent value="funnel">
          <FunnelStagesSettings />
        </TabsContent>

        {/* Activity Log Tab */}
        <TabsContent value="activity-log">
          <ActivityLogViewer />
        </TabsContent>
      </Tabs>
    </div>
  );
};
