import { LayoutGrid } from "lucide-react";
import { Project, getProjectFunnelStage, funnelStageLabels, projectStateLabels } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { Progress } from "@/components/ui/progress";
import { arrToCrore } from "@/lib/arr";

/**
 * Fields a tenant can build a dashlet on. Each one groups the dashboard's
 * projects and shows how many fall into every value.
 */
export const DASHLET_FIELDS: Array<{ value: string; labelKey?: string; fallback: string }> = [
  { value: "projectState", labelKey: "field_project_state", fallback: "Project State" },
  { value: "stage", labelKey: "field_project_stage", fallback: "Project Stage" },
  { value: "currentOwnerTeam", labelKey: "field_assigned_owner", fallback: "Owner Team" },
  { value: "platform", labelKey: "field_platform", fallback: "Platform" },
  { value: "category", labelKey: "field_category", fallback: "Category" },
  { value: "integrationType", labelKey: "field_integration_type", fallback: "Integration Type" },
  { value: "pgOnboarding", labelKey: "field_pg_onboarding", fallback: "PG Onboarding" },
  { value: "salesSpoc", labelKey: "field_sales_spoc", fallback: "Sales SPOC" },
  { value: "assignedOwnerName", labelKey: "field_assigned_owner", fallback: "Assigned Owner" },
  { value: "currentResponsibility", fallback: "Responsibility" },
  { value: "goLiveMonth", labelKey: "field_expected_go_live_date", fallback: "Expected Go-Live month" },
];

const valueFor = (project: Project, field: string): string => {
  switch (field) {
    case "stage":
      return funnelStageLabels[getProjectFunnelStage(project)] || "Unknown";
    case "projectState":
      return projectStateLabels[project.projectState] || "Unknown";
    case "goLiveMonth": {
      const date = project.dates?.expectedGoLiveDate || project.dates?.goLiveDate;
      if (!date) return "No date";
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? "No date" : parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    }
    default: {
      const raw = (project as unknown as Record<string, unknown>)[field];
      return raw === undefined || raw === null || raw === "" ? "Not set" : String(raw);
    }
  }
};

interface Props {
  title: string;
  field: string;
  projects: Project[];
  onDrillDown?: (title: string, list: Project[]) => void;
}

export const CustomFieldDashlet = ({ title, field, projects, onDrillDown }: Props) => {
  const { getLabel } = useLabels();
  const meta = DASHLET_FIELDS.find((f) => f.value === field);
  const fieldLabel = meta ? (meta.labelKey ? getLabel(meta.labelKey) : meta.fallback) : field;
  const arrLabel = getLabel("field_arr");

  const groups = projects.reduce<Record<string, Project[]>>((acc, project) => {
    const key = valueFor(project, field);
    acc[key] = [...(acc[key] || []), project];
    return acc;
  }, {});
  const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  return (
    <section className="flex h-full max-h-[24rem] flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Projects grouped by {fieldLabel}</p>
        </div>
        <LayoutGrid className="h-4 w-4 text-primary" />
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No projects to group yet.</p>
        ) : entries.map(([label, list]) => {
          const pct = projects.length ? Math.round((list.length / projects.length) * 100) : 0;
          const arr = list.reduce((sum, p) => sum + arrToCrore(p.arr), 0);
          return (
            <button
              key={label}
              type="button"
              onClick={() => onDrillDown?.(`${title} · ${label}`, list)}
              className="block w-full space-y-1 rounded-md p-1 text-left hover:bg-muted/50"
            >
              <span className="flex items-center justify-between gap-2 text-xs">
                <span className="max-w-[60%] truncate font-medium text-foreground/80">{label}</span>
                <span className="text-[11px] font-semibold tabular-nums">{list.length} · {pct}% · {arr.toFixed(2)} Cr {arrLabel}</span>
              </span>
              <Progress value={pct} className="h-1.5" />
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default CustomFieldDashlet;
