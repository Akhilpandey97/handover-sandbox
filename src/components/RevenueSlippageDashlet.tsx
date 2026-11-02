import { useMemo } from "react";
import { CalendarX } from "lucide-react";
import { formatCr, sumArrCrore } from "@/lib/arr";
import type { Project } from "@/data/projectsData";
import { openProjectInNewTab } from "@/lib/open-project";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan",
  "02": "Feb",
  "03": "Mar",
  "04": "Apr",
  "05": "May",
  "06": "Jun",
  "07": "Jul",
  "08": "Aug",
  "09": "Sep",
  "10": "Oct",
  "11": "Nov",
  "12": "Dec",
};

function formatMonth(yyyyMm: string) {
  const [year, month] = yyyyMm.split("-");
  return `${MONTH_LABELS[month!] ?? month} ${year}`;
}

export const RevenueSlippageDashlet = ({ projects }: { projects?: Project[] } = {}) => {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const { slipped, thisMonthSlipped, byMonth } = useMemo(() => {
    const all = (projects ?? []).filter(
      (p) => !p.archived && p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate < today,
    );

    const thisM = all.filter((p) => p.dates.expectedGoLiveDate!.startsWith(thisMonth));

    // Group by YYYY-MM, newest first
    const map = new Map<string, Project[]>();
    for (const p of all) {
      const key = p.dates.expectedGoLiveDate!.slice(0, 7);
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    const sorted = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));

    return { slipped: all, thisMonthSlipped: thisM, byMonth: sorted };
  }, [projects, today, thisMonth]);

  const totalArr = sumArrCrore(slipped.map((p) => p.arr));
  const totalMrr = totalArr / 12;
  const thisMonthArr = sumArrCrore(thisMonthSlipped.map((p) => p.arr));
  const thisMonthMrr = thisMonthArr / 12;

  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">Revenue Slippage</p>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          Projects whose expected go-live has passed
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-2 p-3">
        <div className="flex flex-col gap-1 rounded-lg bg-destructive-soft p-3 text-destructive-strong">
          <div className="flex items-center gap-1.5 text-2xs font-medium opacity-80">
            <CalendarX className="h-3 w-3" />
            Total slippage
          </div>
          <p className="text-lg font-semibold leading-tight tabular-nums">
            {formatCr(totalArr)} Cr
          </p>
          <p className="text-2xs opacity-70">
            MRR {formatCr(totalMrr)} Cr · {slipped.length} project
            {slipped.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-warning-soft p-3 text-warning-strong">
          <div className="flex items-center gap-1.5 text-2xs font-medium opacity-80">
            <CalendarX className="h-3 w-3" />
            This month
          </div>
          <p className="text-lg font-semibold leading-tight tabular-nums">
            {formatCr(thisMonthArr)} Cr
          </p>
          <p className="text-2xs opacity-70">
            MRR {formatCr(thisMonthMrr)} Cr · {thisMonthSlipped.length} project
            {thisMonthSlipped.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-foreground">
          <div className="text-2xs font-medium text-muted-foreground">Months with slippage</div>
          <p className="text-lg font-semibold leading-tight">{byMonth.length}</p>
          <p className="text-2xs text-muted-foreground">calendar months affected</p>
        </div>
      </div>

      {/* Breakdown by month */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table wrapperClassName="rounded-none border-0 bg-transparent backdrop-blur-none overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-card table-header-tint">
            <TableRow className="hover:bg-muted/40 border-b">
              <TableHead className="font-semibold text-foreground">Month</TableHead>
              <TableHead className="font-semibold text-foreground text-right">Projects</TableHead>
              <TableHead className="font-semibold text-foreground text-right whitespace-nowrap">
                ARR (Cr)
              </TableHead>
              <TableHead className="font-semibold text-foreground text-right whitespace-nowrap">
                MRR (Cr)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byMonth.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  No slippage recorded.
                </TableCell>
              </TableRow>
            ) : (
              byMonth.map(([month, ps]) => {
                const mArr = sumArrCrore(ps.map((p) => p.arr));
                const mMrr = mArr / 12;
                const isThisMonth = month === thisMonth;
                return (
                  <TableRow
                    key={month}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      // open first project as a proxy — a future drill-down dialog can list all
                      if (ps[0]) openProjectInNewTab(ps[0].id);
                    }}
                  >
                    <TableCell className="text-xs font-medium">
                      {formatMonth(month)}
                      {isThisMonth && (
                        <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 py-0.5 text-2xs font-semibold text-warning-strong">
                          this month
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{ps.length}</TableCell>
                    <TableCell className="text-right text-xs font-medium tabular-nums">
                      {formatCr(mArr)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {formatCr(mMrr)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
};
