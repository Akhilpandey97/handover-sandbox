import { useState } from "react";
import { Project } from "@/data/projectsData";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLabels } from "@/contexts/LabelsContext";
import { RiskBadge } from "./RiskBadge";
import { GoLiveDate } from "./GoLiveDate";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import { openProjectInNewTab } from "@/lib/open-project";
import { sumArrCrore, formatCrRupee, formatArrCrRupee } from "@/lib/arr";
import { Columns3 } from "lucide-react";

const STORAGE_KEY = "project_list_dialog_columns";

interface ColDef {
  id: string;
  header: (getLabel: (k: string) => string) => string;
  cell: (p: Project, ctx: { stateLabels: Record<string, string>; teamLabels: Record<string, string>; verdicts: Record<string, any> }) => React.ReactNode;
  defaultVisible: boolean;
  align?: "right";
}

const ALL_COLUMNS: ColDef[] = [
  {
    id: "merchant",
    header: (g) => g("field_merchant_name") || "Merchant",
    cell: (p, { verdicts }) => (
      <span className="inline-flex items-center gap-1.5">
        {p.merchantName}
        <RiskBadge projectId={p.id} verdict={verdicts[p.id]} />
      </span>
    ),
    defaultVisible: true,
  },
  {
    id: "mid",
    header: () => "MID",
    cell: (p) => <span className="text-xs text-muted-foreground">{p.mid || "—"}</span>,
    defaultVisible: true,
  },
  {
    id: "state",
    header: (g) => g("field_project_state") || "State",
    cell: (p, { stateLabels }) => stateLabels[p.projectState] || p.projectState,
    defaultVisible: true,
  },
  {
    id: "owner_team",
    header: (g) => g("field_assigned_owner") || "Owner Team",
    cell: (p, { teamLabels }) => teamLabels[p.currentOwnerTeam] || p.currentOwnerTeam || "—",
    defaultVisible: true,
  },
  {
    id: "arr",
    header: (g) => g("field_arr") || "ARR",
    cell: (p) => <span className="font-semibold tabular-nums">{formatArrCrRupee(p.arr)}</span>,
    defaultVisible: true,
    align: "right",
  },
  {
    id: "expected_go_live",
    header: (g) => g("field_expected_go_live_date") || "Expected Go-Live",
    cell: (p) => <GoLiveDate project={p} />,
    defaultVisible: true,
  },
  {
    id: "platform",
    header: (g) => g("field_platform") || "Platform",
    cell: (p) => p.platform || "—",
    defaultVisible: false,
  },
  {
    id: "sales_spoc",
    header: (g) => g("field_sales_spoc") || "Sales SPOC",
    cell: (p) => p.salesSpoc || "—",
    defaultVisible: false,
  },
  {
    id: "kick_off_date",
    header: (g) => g("field_kick_off_date") || "Kick-off Date",
    cell: (p) => p.dates?.kickOffDate || "—",
    defaultVisible: false,
  },
  {
    id: "actual_go_live",
    header: (g) => g("field_actual_go_live_date") || "Actual Go-Live",
    cell: (p) => p.dates?.goLiveDate || "—",
    defaultVisible: false,
  },
];

function loadVisible(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveVisible(v: Record<string, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch {}
}

interface Props {
  title: string;
  description?: string;
  projects: Project[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ProjectListDialog = ({ title, description, projects, open, onOpenChange }: Props) => {
  const { teamLabels, stateLabels, getLabel } = useLabels();
  const { verdicts } = useProjectRiskVerdicts();
  const list = projects || [];
  const totalArr = sumArrCrore(list.map((p) => p.arr));

  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const stored = loadVisible();
    const result: Record<string, boolean> = {};
    for (const col of ALL_COLUMNS) {
      result[col.id] = col.id in stored ? stored[col.id] : col.defaultVisible;
    }
    return result;
  });

  const toggleCol = (id: string) => {
    if (id === "merchant") return; // always visible
    setVisible((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveVisible(next);
      return next;
    });
  };

  const activeCols = ALL_COLUMNS.filter((c) => visible[c.id]);
  const ctx = { stateLabels, teamLabels, verdicts };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {description ? `${description} · ` : ""}
                {list.length} project{list.length === 1 ? "" : "s"} · {formatCrRupee(totalArr)} ARR
              </DialogDescription>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  Columns
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-2">
                <p className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Show / hide columns
                </p>
                {ALL_COLUMNS.map((col) => {
                  const label = col.header(getLabel);
                  const isFixed = col.id === "merchant";
                  return (
                    <label
                      key={col.id}
                      className={[
                        "flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50",
                        isFixed ? "opacity-50 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={!!visible[col.id]}
                        disabled={isFixed}
                        onChange={() => toggleCol(col.id)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {label}
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {list.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No projects in this segment.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {activeCols.map((col) => (
                    <TableHead
                      key={col.id}
                      className={col.align === "right" ? "text-right" : ""}
                    >
                      {col.header(getLabel)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => {
                      onOpenChange(false);
                      openProjectInNewTab(p.id);
                    }}
                  >
                    {activeCols.map((col) => (
                      <TableCell
                        key={col.id}
                        className={[
                          "text-sm",
                          col.id === "merchant" ? "font-medium" : "",
                          col.align === "right" ? "text-right" : "",
                        ].join(" ")}
                      >
                        {col.cell(p, ctx)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
