import { useMemo, useRef, useState, useCallback } from "react";
import { Project, ProjectChecklist } from "@/data/projectsData";
import { useChecklistTasks } from "@/hooks/useChecklistTasks";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  addDays,
  differenceInDays,
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachWeekOfInterval,
  eachMonthOfInterval,
  isBefore,
  isAfter,
} from "date-fns";
import { ZoomIn, ZoomOut, CalendarDays, Layers } from "lucide-react";

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
const TASK_ROW_H = 26;
const LEFT_W = 220;
const DAY_W_WEEK = 32;
const DAY_W_MONTH = 12;
const RESIZE_HANDLE_W = 8;

function safeParseISO(d: string | undefined | null): Date | null {
  if (!d) return null;
  try { return parseISO(d); } catch { return null; }
}

interface DragState {
  type: "move" | "resize";
  itemId: string;
  startMouseX: number;
  origStartDate: Date;
  origEndDate: Date;
}

interface RowEntry {
  type: "item" | "task";
  item: ProjectChecklist;
  taskId?: string;
  taskTitle?: string;
  taskStartDate?: string | null;
  taskDueDate?: string | null;
  taskStatus?: string;
  y: number;
  height: number;
}

export function ChecklistGanttView({ project }: Props) {
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [showTasks, setShowTasks] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: allTasks = [] } = useChecklistTasks(project.id);

  // §7.3 Drag state
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dateOverrides, setDateOverrides] = useState<Map<string, { start: Date; end: Date }>>(new Map());

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const baseItems = useMemo(
    () => project.checklist.filter((i) => !i.isTask),
    [project.checklist],
  );

  // Items that have at least one date (for Gantt display)
  const items = useMemo(
    () => baseItems.filter((i) => i.startDate || i.dueDate),
    [baseItems],
  );

  const { rangeStart, rangeEnd, dayPx } = useMemo(() => {
    const dates: Date[] = [today];
    items.forEach((i) => {
      const s = safeParseISO(i.startDate);
      const e = safeParseISO(i.dueDate);
      if (s) dates.push(s);
      if (e) dates.push(e);
    });
    // Also consider task dates when showing tasks
    if (showTasks) {
      allTasks.forEach((t) => {
        if (t.start_date) dates.push(parseISO(t.start_date));
        if (t.due_date) dates.push(parseISO(t.due_date));
      });
    }
    let minDate = dates.reduce((a, b) => (isBefore(a, b) ? a : b));
    let maxDate = dates.reduce((a, b) => (isAfter(a, b) ? a : b));
    const dp = zoom === "week" ? DAY_W_WEEK : DAY_W_MONTH;
    minDate = zoom === "week" ? startOfWeek(addDays(minDate, -7)) : startOfMonth(addDays(minDate, -15));
    maxDate = zoom === "week" ? endOfWeek(addDays(maxDate, 7)) : endOfMonth(addDays(maxDate, 15));
    return { rangeStart: minDate, rangeEnd: maxDate, dayPx: dp };
  }, [items, today, zoom, showTasks, allTasks]);

  const totalDays = differenceInDays(rangeEnd, rangeStart) + 1;
  const chartWidth = totalDays * dayPx;

  const xForDate = useCallback(
    (d: Date) => differenceInDays(d, rangeStart) * dayPx,
    [rangeStart, dayPx],
  );

  const todayX = xForDate(today);

  // Build rows array for synchronized label + chart rendering
  const rows = useMemo<RowEntry[]>(() => {
    const result: RowEntry[] = [];
    let y = ROW_H; // start after header
    for (const item of items) {
      result.push({ type: "item", item, y, height: ROW_H });
      y += ROW_H;
      if (showTasks) {
        const itemTasks = allTasks.filter(
          (t) => t.checklist_item_id === item.id && (t.start_date || t.due_date),
        );
        for (const t of itemTasks) {
          result.push({
            type: "task",
            item,
            taskId: t.id,
            taskTitle: t.title,
            taskStartDate: t.start_date,
            taskDueDate: t.due_date,
            taskStatus: t.status,
            y,
            height: TASK_ROW_H,
          });
          y += TASK_ROW_H;
        }
      }
    }
    return result;
  }, [items, showTasks, allTasks]);

  const totalChartHeight = rows.reduce((sum, r) => Math.max(sum, r.y + r.height), ROW_H);

  const tickLabels = useMemo(() => {
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
  }, [rangeStart, rangeEnd, zoom, xForDate]);

  function scrollToToday() {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = todayX - scrollRef.current.clientWidth / 2 + LEFT_W;
    }
  }

  // Convert viewport clientX to SVG x (accounting for scroll)
  function svgX(clientX: number): number {
    if (!scrollRef.current) return 0;
    const rect = scrollRef.current.getBoundingClientRect();
    return clientX - rect.left + scrollRef.current.scrollLeft;
  }

  // §7.3 Drag handlers
  function startDrag(e: React.MouseEvent, item: ProjectChecklist, type: "move" | "resize") {
    e.preventDefault();
    e.stopPropagation();
    const override = dateOverrides.get(item.id);
    const origStart = override?.start ?? safeParseISO(item.startDate) ?? today;
    const origEnd = override?.end ?? safeParseISO(item.dueDate) ?? addDays(origStart, 1);
    setDragState({ type, itemId: item.id, startMouseX: svgX(e.clientX), origStartDate: origStart, origEndDate: origEnd });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragState) return;
    const dx = svgX(e.clientX) - dragState.startMouseX;
    const dDays = Math.round(dx / dayPx);
    if (dragState.type === "move") {
      setDateOverrides((prev) =>
        new Map(prev).set(dragState.itemId, {
          start: addDays(dragState.origStartDate, dDays),
          end: addDays(dragState.origEndDate, dDays),
        }),
      );
    } else {
      const newEnd = addDays(dragState.origEndDate, dDays);
      if (differenceInDays(newEnd, dragState.origStartDate) >= 1) {
        setDateOverrides((prev) =>
          new Map(prev).set(dragState.itemId, { start: dragState.origStartDate, end: newEnd }),
        );
      }
    }
  }

  async function handleMouseUp() {
    if (!dragState) return;
    const override = dateOverrides.get(dragState.itemId);
    if (override) {
      await supabase
        .from("checklist_items")
        .update({
          start_date: format(override.start, "yyyy-MM-dd"),
          due_date: format(override.end, "yyyy-MM-dd"),
        })
        .eq("id", dragState.itemId);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
    setDragState(null);
    setTimeout(() => setDateOverrides(new Map()), 300);
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No items with dates yet — set start/due dates in List view to see the Gantt.
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{ cursor: dragState ? (dragState.type === "resize" ? "col-resize" : "grabbing") : "default" }}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-background/80 backdrop-blur-sm flex-shrink-0">
        <span className="text-xs font-medium text-muted-foreground">Zoom:</span>
        <Button variant={zoom === "week" ? "default" : "outline"} size="sm" className="h-7 px-2 text-xs" onClick={() => setZoom("week")}>
          <ZoomIn className="h-3 w-3 mr-1" /> Week
        </Button>
        <Button variant={zoom === "month" ? "default" : "outline"} size="sm" className="h-7 px-2 text-xs" onClick={() => setZoom("month")}>
          <ZoomOut className="h-3 w-3 mr-1" /> Month
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={scrollToToday}>
          <CalendarDays className="h-3 w-3 mr-1" /> Jump to today
        </Button>
        {/* §12.3 Show tasks toggle */}
        <Button
          variant={showTasks ? "default" : "outline"}
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setShowTasks((v) => !v)}
        >
          <Layers className="h-3 w-3" />
          {showTasks ? "Milestones only" : "Show tasks"}
        </Button>
        <span className="text-xs text-muted-foreground ml-2 italic">
          Drag bars to reschedule · Drag right edge to resize
        </span>
      </div>

      {/* Chart area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Frozen label column */}
        <div className="flex-shrink-0 overflow-y-hidden border-r" style={{ width: LEFT_W }}>
          {/* Header */}
          <div
            className="border-b bg-muted/60 flex items-center px-3"
            style={{ height: ROW_H }}
          >
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Item</span>
          </div>
          {rows.map((row, idx) => (
            <div
              key={`${row.item.id}-${row.taskId ?? "item"}`}
              className={`border-b flex items-center bg-background ${row.type === "task" ? "pl-7" : "px-3"}`}
              style={{ height: row.height, paddingLeft: row.type === "task" ? 28 : undefined, paddingRight: 12 }}
            >
              {row.type === "task" ? (
                <span className="text-2xs text-muted-foreground truncate" title={row.taskTitle}>
                  → {row.taskTitle}
                </span>
              ) : (
                <span className="text-xs font-medium truncate" title={row.item.title}>
                  {row.item.title}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Scrollable SVG chart */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <svg
            ref={svgRef}
            width={chartWidth}
            height={totalChartHeight}
            style={{ display: "block" }}
          >
            {/* Header */}
            <rect x={0} y={0} width={chartWidth} height={ROW_H} className="fill-muted/60" />
            {tickLabels.map((t) => (
              <g key={t.x}>
                <line x1={t.x} y1={0} x2={t.x} y2={totalChartHeight} className="stroke-border" strokeWidth={1} />
                <text x={t.x + 4} y={ROW_H / 2 + 4} fontSize={10} className="fill-muted-foreground">
                  {t.label}
                </text>
              </g>
            ))}

            {/* Row backgrounds */}
            {rows.map((row, idx) => (
              <rect
                key={`bg-${row.item.id}-${row.taskId ?? "item"}`}
                x={0}
                y={row.y}
                width={chartWidth}
                height={row.height}
                fill={idx % 2 === 0 ? "transparent" : "rgba(0,0,0,0.015)"}
              />
            ))}

            {/* Today line */}
            {todayX >= 0 && todayX <= chartWidth && (
              <g>
                <line x1={todayX} y1={0} x2={todayX} y2={totalChartHeight} stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 2" />
                <text x={todayX + 3} y={14} fontSize={9} fill="#f97316" fontWeight="600">Today</text>
              </g>
            )}

            {/* §7.4 Dependency arrows — render before bars so bars draw on top */}
            {rows
              .filter((r) => r.type === "item" && r.item.dependsOn?.length)
              .map((row) => {
                const item = row.item;
                return (item.dependsOn ?? []).map((depId) => {
                  const depRow = rows.find((r) => r.type === "item" && r.item.id === depId);
                  if (!depRow) return null;
                  const depOverride = dateOverrides.get(depId);
                  const depStart = depOverride?.start ?? safeParseISO(depRow.item.startDate) ?? today;
                  const depEnd = depOverride?.end ?? safeParseISO(depRow.item.dueDate) ?? addDays(depStart, 1);
                  const depBarW = Math.max(dayPx, differenceInDays(depEnd, depStart) * dayPx);
                  const ax = xForDate(depStart) + depBarW;
                  const ay = depRow.y + depRow.height / 2;
                  const thisOverride = dateOverrides.get(item.id);
                  const thisStart = thisOverride?.start ?? safeParseISO(item.startDate) ?? today;
                  const bx = xForDate(thisStart);
                  const by = row.y + row.height / 2;
                  const mx = (ax + bx) / 2;
                  return (
                    <g key={`dep-${depId}-${item.id}`} opacity={0.65}>
                      <path
                        d={`M ${ax},${ay} L ${mx},${ay} L ${mx},${by} L ${bx},${by}`}
                        fill="none"
                        stroke="#94a3b8"
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                      />
                      {/* Arrowhead */}
                      <polygon
                        points={`${bx},${by} ${bx - 5},${by - 3} ${bx - 5},${by + 3}`}
                        fill="#94a3b8"
                      />
                    </g>
                  );
                });
              })}

            {/* Bars */}
            {rows.map((row) => {
              if (row.type === "task") {
                // §12.3 Task sub-bar
                const startD = safeParseISO(row.taskStartDate) ?? today;
                const endD = safeParseISO(row.taskDueDate) ?? addDays(startD, 1);
                const x = xForDate(startD);
                const w = Math.max(dayPx, differenceInDays(endD, startD) * dayPx);
                const barH = row.height * 0.5;
                const y = row.y + (row.height - barH) / 2;
                const statusColor = STATUS_BAR_COLOR[row.taskStatus || "todo"];
                return (
                  <g key={`task-bar-${row.taskId}`}>
                    <rect x={x + 10} y={y} width={Math.max(w - 10, dayPx)} height={barH} rx={3} fill={statusColor} opacity={0.65} />
                  </g>
                );
              }

              // §7.3 Item milestone bar with drag
              const item = row.item;
              const override = dateOverrides.get(item.id);
              const startD = override?.start ?? safeParseISO(item.startDate) ?? today;
              const endD = override?.end ?? safeParseISO(item.dueDate) ?? addDays(startD, 1);
              const x = xForDate(startD);
              const w = Math.max(dayPx, differenceInDays(endD, startD) * dayPx);
              const barH = row.height * 0.55;
              const y = row.y + (row.height - barH) / 2;
              const color = STATUS_BAR_COLOR[item.status || "todo"];
              const isDraggingThis = dragState?.itemId === item.id;

              return (
                <g key={`bar-${item.id}`}>
                  {/* Main bar body — drag to move */}
                  <rect
                    x={x}
                    y={y}
                    width={Math.max(w - RESIZE_HANDLE_W, dayPx)}
                    height={barH}
                    rx={4}
                    fill={color}
                    opacity={item.completed ? 0.45 : isDraggingThis ? 1 : 0.85}
                    style={{ cursor: "grab" }}
                    onMouseDown={(e) => startDrag(e, item, "move")}
                  />
                  {/* Resize handle — right edge */}
                  <rect
                    x={x + w - RESIZE_HANDLE_W}
                    y={y}
                    width={RESIZE_HANDLE_W}
                    height={barH}
                    rx={4}
                    fill={color}
                    opacity={item.completed ? 0.45 : isDraggingThis ? 1 : 0.9}
                    style={{ cursor: "col-resize" }}
                    onMouseDown={(e) => startDrag(e, item, "resize")}
                  />
                  {/* Bar label */}
                  {w > 50 && (
                    <text x={x + 6} y={y + barH / 2 + 4} fontSize={9} fill="white" fontWeight="500">
                      {item.title.length > 22 ? item.title.slice(0, 20) + "…" : item.title}
                    </text>
                  )}
                  {/* §7.4 Dependency indicator dot on bars that have dependsOn */}
                  {item.dependsOn && item.dependsOn.length > 0 && (
                    <circle cx={x - 5} cy={y + barH / 2} r={3} fill="#94a3b8" />
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
