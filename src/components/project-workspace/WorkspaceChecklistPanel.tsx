import { Badge } from "@/components/ui/badge";
import { useLabels } from "@/contexts/LabelsContext";
import { hexToRgba } from "@/utils/colorUtils";
import { WorkspaceMetricCard } from "./WorkspaceMetricCard";

interface ChecklistItemSummary {
  id: string;
  title: string;
  completed: boolean;
}

interface WorkspaceChecklistPanelProps {
  groupedChecklist: Array<{ team: string; label: string; items: ChecklistItemSummary[] }>;
  completedChecklist: number;
  totalChecklist: number;
  currentPhase: string;
}

export const WorkspaceChecklistPanel = ({
  groupedChecklist,
  completedChecklist,
  totalChecklist,
  currentPhase,
}: WorkspaceChecklistPanelProps) => {
  const { labels } = useLabels();
  const sectionBackground = labels.color_workspace_section_bg || "#fcfdff";
  const sectionBorder = labels.color_workspace_section_border || "#dbe5ef";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <WorkspaceMetricCard label="Total items" value={String(totalChecklist)} eyebrow="Delivery" />
        <WorkspaceMetricCard label="Completed" value={String(completedChecklist)} eyebrow="Progress" />
        <WorkspaceMetricCard label="Last milestone" value={currentPhase || "—"} eyebrow="Status" />
      </div>

      <div className="space-y-4">
        {groupedChecklist.map(({ team, label, items }) => {
          const done = items.filter((item) => item.completed).length;

          return (
            <div
              key={team}
              className="rounded-[1.75rem] p-5"
              style={{
                backgroundColor: hexToRgba(sectionBackground, 0.86),
                border: `1px solid ${hexToRgba(sectionBorder, 0.78)}`,
              }}
            >
              <div
                className="flex flex-wrap items-center justify-between gap-3 pb-4"
                style={{ borderBottom: `1px solid ${hexToRgba(sectionBorder, 0.42)}` }}
              >
                <div>
                  <p className="text-lg font-semibold tracking-[-0.03em] text-foreground">{label}</p>
                  <p className="text-sm text-muted-foreground">{done} of {items.length} actions closed</p>
                </div>
                <Badge variant="outline" className="px-3 py-1 text-xs font-semibold">
                  {done}/{items.length}
                </Badge>
              </div>

              <div className="mt-4 space-y-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-2xl px-4 py-3"
                    style={{
                      backgroundColor: hexToRgba(sectionBorder, 0.08),
                      border: `1px solid ${hexToRgba(sectionBorder, 0.5)}`,
                    }}
                  >
                    <span className="text-sm font-medium text-foreground">{item.title}</span>
                    <Badge variant={item.completed ? "default" : "outline"}>{item.completed ? "Done" : "Pending"}</Badge>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};