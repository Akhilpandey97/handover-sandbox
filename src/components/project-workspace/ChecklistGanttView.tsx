import { useMemo, useRef, useState } from "react";
import { Project, ProjectChecklist } from "@/data/projectsData";
import { Button } from "@/components/ui/button";
import {
  addDays,
  addWeeks,
  differenceInDays,
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachWeekOfInterval,
  eachMonthOfInterval,
  isToday,
  isBefore,
  isAfter,
} from "date-fns";
import { ZoomIn, ZoomOut, CalendarDays } from "lucide-react";

type ZoomLevel = "week" | "month";

interface Props {
  project: Project;
}

const STATUS_BAR_COLOR: Record<string, string> = {
  done: "#22c55e",
  in_progress: "#3b82f6",
  blocked: "#ef4444",
  todo: "#94a3b8",
};

const ROW_H = 36;
const LEFT_W = 220;
const DAY_W_WEEK = 32;
const DAY_W_MONTH = 12;

function safeParseISO(d: string | undefined): Date | null {
  if (!d) return null;
  try { return parseISO(d); } catch { return null; }
}

export function ChecklistGanttView({ project }: Props) {
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const svgRef = useRef<SVGSVGElement>(null);

  const items = useMemo(
    () => project.checklist.filter((i) => !i.isTask && (i.startDate || i.dueDate)),
    [project.checklist]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Compute chart date range
  const { rangeStart, rangeEnd, dayPx } = useMemo(() => {
    const dates: Date[] = [today];
    items.forEach((i) => {
      const s = safeParseISO(i.startDate);
      const e = safeParseISO(i.dueDate);
      if (s) dates.push(s);
      if (e) dates.push(e);
    });
    let minDate = dates.reduce((a, b) => (isBefore(a, b) ? a : b));
    let maxDate = dates.reduce((a, b) => (isAfter(a, b) ? a : b));

    minDate = zoom === "week" ? startOfWeek(addWeeks(minDate, -1)) : startOfMonth(addDays(minDate, -15));
    maxDate = zoom === "week" ? endOfWeek(addWeeks(maxDate, 1)) : endOfMonth(addDays(maxDate, 15));

    const dayPx = zoom === "week" ? DAY_W_WEEK : DAY_W_MONTH;
    return { rangeStart: minDate, rangeEnd: maxDate, dayPx };
  }, [items, today, zoom]);

  const totalDays = differenceInDays(rangeEnd, rangeStart) + 1;
  const chartWidth = totalDays * dayPx;
  const chartHeight = (items.length + 1) * ROW_H;

  function xForDate(d: Date): number {
    return differenceInDays(d, rangeStart) * dayPx;
  }

  // Header tick marks
  const tickLabels: { x: number; label: string }[] = useMemo(() => {
    if (zoom === "week") {
      return eachWeekOfInterval({ start: rangeStart, end: rangeEnd }).map((w) => ({
        x: xForDate(w),
        label: format(w, "MMM d"),
      }));
    }
    return eachMonthOfInterval({ start: rangeStart, end: rangeEnd }).map((m) => ({
      x: xForDate(m),
      label: format(m, "MMM yy"),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd, zoom, dayPx]);

  const todayX = xForDate(today);

  function scrollToToday() {
    const container = svgRef.current?.parentElement;
    if (container) {
      container.scrollLeft = LEFT_W + todayX - container.clientWidth / 2;
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-background/80 backdrop-blur-sm">
        <span className="text-xs font-medium text-muted-foreground">Zoom:</span>
        <Button
          variant={zoom === "week" ? "default" : "outline"}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setZoom("week")}
        >
          <ZoomIn className="h-3 w-3 mr-1" /> Week
        </Button>
        <Button
          variant={zoom === "month" ? "default" : "outline"}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setZoom("month")}
        >
          <ZoomOut className="h-3 w-3 mr-1" /> Month
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={scrollToToday}>
          <CalendarDays className="h-3 w-3 mr-1" /> Jump to today
        </Button>
        {items.length === 0 && (
          <span className="text-xs text-muted-foreground italic ml-2">
            No items with dates yet — set start/due dates to see them on the Gantt.
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-auto">
        {/* Frozen label column */}
        <div className="flex-shrink-0" style={{ width: LEFT_W }}>
          <div style={{ height: ROW_H }} className="border-b border-r bg-muted/60 flex items-center px-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Item</span>
          </div>
          {items.map((item) => (
            <div
              key={item.id}
              style={{ height: ROW_H }}
              className="border-b border-r flex items-center px-3 bg-background"
            >
              <span className="text-xs font-medium truncate max-w-full" title={item.title}>
                {item.title}
              </span>
            </div>
          ))}
        </div>

        {/* Scrollable chart area */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <svg
            ref={svgRef}
            width={chartWidth}
            height={chartHeight}
            style={{ display: "block" }}
          >
            {/* Header row */}
            <rect x={0} y={0} width={chartWidth} height={ROW_H} className="fill-muted/60" />
            {tickLabels.map((t) => (
              <g key={t.x}>
                <line x1={t.x} y1={0} x2={t.x} y2={chartHeight} className="stroke-border" strokeWidth={1} />
                <text x={t.x + 4} y={ROW_H / 2 + 4} fontSize={10} className="fill-muted-foreground">
                  {t.label}
                </text>
              </g>
            ))}

            {/* Row backgrounds */}
            {items.map((_, rowIdx) => (
              <rect
                key={rowIdx}
                x={0}
                y={(rowIdx + 1) * ROW_H}
                width={chartWidth}
                height={ROW_H}
                fill={rowIdx % 2 === 0 ? "transparent" : "rgba(0,0,0,0.02)"}
              />
            ))}

            {/* Today line */}
            {todayX >= 0 && todayX <= chartWidth && (
              <g>
                <line
                  x1={todayX}
                  y1={0}
                  x2={todayX}
                  y2={chartHeight}
                  stroke="#f97316"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
                <text x={todayX + 3} y={14} fontSize={9} fill="#f97316" fontWeight="600">
                  Today
                </text>
              </g>
            )}

            {/* Bars */}
            {items.map((item, rowIdx) => {
              const startD = safeParseISO(item.startDate) ?? today;
              const endD = safeParseISO(item.dueDate) ?? addDays(startD, 1);
              const x = xForDate(startD);
              const w = Math.max(dayPx, differenceInDays(endD, startD) * dayPx);
              const y = (rowIdx + 1) * ROW_H + ROW_H * 0.2;
              const h = ROW_H * 0.6;
              const color = STATUS_BAR_COLOR[item.status || "todo"];

              return (
                <g key={item.id}>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    rx={4}
                    fill={color}
                    opacity={item.completed ? 0.5 : 0.85}
                  />
                  {w > 50 && (
                    <text
                      x={x + 6}
                      y={y + h / 2 + 4}
                      fontSize={9}
                      fill="white"
                      fontWeight="500"
                      clipPath={`inset(0 0 0 0)`}
                    >
                      {item.title.length > 22 ? item.title.slice(0, 20) + "…" : item.title}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
