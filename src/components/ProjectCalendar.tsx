import { useMemo, useState } from "react";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { Project, projectStateColors } from "@/data/projectsData";
import { teamColors } from "@/data/teams";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Rocket,
  Flag,
  Target,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  parseISO,
} from "date-fns";

interface CalendarEvent {
  id: string;
  date: Date;
  project: Project;
  type: "kickoff" | "expected_golive" | "golive";
  label: string;
}

const eventTypeConfig = {
  kickoff: { icon: Rocket, color: "bg-blue-500", text: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900/40", label: "Kick-off" },
  expected_golive: { icon: Target, color: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", bg: "bg-amber-100 dark:bg-amber-900/40", label: "Expected Go-Live" },
  golive: { icon: Flag, color: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-100 dark:bg-emerald-900/40", label: "Go-Live" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const ProjectCalendar = () => {
  const { projects: allProjects } = useProjects();
  const projects = useMemo(() => allProjects.filter(p => !p.archived), [allProjects]);
  const { teamLabels, stateLabels } = useLabels();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const events = useMemo(() => {
    const evts: CalendarEvent[] = [];
    projects.forEach((p) => {
      if (p.dates.kickOffDate) {
        evts.push({ id: `${p.id}-ko`, date: parseISO(p.dates.kickOffDate), project: p, type: "kickoff", label: "Kick-off" });
      }
      if (p.dates.expectedGoLiveDate) {
        evts.push({ id: `${p.id}-egl`, date: parseISO(p.dates.expectedGoLiveDate), project: p, type: "expected_golive", label: "Expected Go-Live" });
      }
      if (p.dates.goLiveDate) {
        evts.push({ id: `${p.id}-gl`, date: parseISO(p.dates.goLiveDate), project: p, type: "golive", label: "Go-Live" });
      }
    });
    return evts;
  }, [projects]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getEventsForDay = (day: Date) => events.filter((e) => isSameDay(e.date, day));

  const selectedDayEvents = selectedDate ? getEventsForDay(selectedDate) : [];

  // Month-level stats
  const monthEvents = events.filter((e) => isSameMonth(e.date, currentMonth));
  const kickoffs = monthEvents.filter((e) => e.type === "kickoff").length;
  const goLives = monthEvents.filter((e) => e.type === "golive").length;
  const expectedGoLives = monthEvents.filter((e) => e.type === "expected_golive").length;

  return (
    <div className="space-y-6">
      {/* Month Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <Rocket className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{kickoffs}</p>
              <p className="text-xs text-muted-foreground">Kick-offs this month</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <Target className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{expectedGoLives}</p>
              <p className="text-xs text-muted-foreground">Expected Go-Lives</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <Flag className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{goLives}</p>
              <p className="text-xs text-muted-foreground">Go-Lives this month</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Calendar Grid */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarIcon className="h-5 w-5 text-primary" />
                {format(currentMonth, "MMMM yyyy")}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setCurrentMonth(new Date()); setSelectedDate(new Date()); }}>
                  Today
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">
                  {d}
                </div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
              {calendarDays.map((day) => {
                const dayEvents = getEventsForDay(day);
                const inMonth = isSameMonth(day, currentMonth);
                const today = isToday(day);
                const selected = selectedDate && isSameDay(day, selectedDate);

                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setSelectedDate(day)}
                    className={cn(
                      "relative min-h-[80px] p-1.5 text-left transition-colors bg-card hover:bg-muted/50",
                      !inMonth && "opacity-40",
                      selected && "ring-2 ring-primary ring-inset bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                        today && "bg-primary text-primary-foreground",
                        !today && "text-foreground"
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    {dayEvents.length > 0 && (
                      <div className="mt-0.5 space-y-0.5">
                        {dayEvents.slice(0, 3).map((evt) => {
                          const cfg = eventTypeConfig[evt.type];
                          return (
                            <div
                              key={evt.id}
                              className={cn("flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight truncate", cfg.bg, cfg.text)}
                            >
                              <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.color)} />
                              <span className="truncate">{evt.project.merchantName}</span>
                            </div>
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <span className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 pt-3 border-t">
              {Object.entries(eventTypeConfig).map(([key, cfg]) => (
                <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className={cn("h-2.5 w-2.5 rounded-full", cfg.color)} />
                  {cfg.label}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Selected Day Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {selectedDate ? format(selectedDate, "EEEE, MMM d, yyyy") : "Select a day"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {!selectedDate && (
              <p className="text-xs text-muted-foreground py-8 text-center">Click on a date to see project events</p>
            )}
            {selectedDate && selectedDayEvents.length === 0 && (
              <p className="text-xs text-muted-foreground py-8 text-center">No events on this date</p>
            )}
            {selectedDayEvents.length > 0 && (
              <ScrollArea className="max-h-[500px]">
                <div className="space-y-3">
                  {selectedDayEvents.map((evt) => {
                    const cfg = eventTypeConfig[evt.type];
                    const Icon = cfg.icon;
                    return (
                      <div key={evt.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center", cfg.bg)}>
                            <Icon className={cn("h-3.5 w-3.5", cfg.text)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{evt.project.merchantName}</p>
                            <p className={cn("text-[10px] font-medium", cfg.text)}>{cfg.label}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline" className="text-[10px] h-5">
                            {evt.project.mid}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] h-5">
                            {teamLabels[evt.project.currentOwnerTeam] || evt.project.currentOwnerTeam}
                          </Badge>
                          <Badge className={cn("text-[10px] h-5", projectStateColors[evt.project.projectState])}>
                            {stateLabels?.[evt.project.projectState] || evt.project.projectState}
                          </Badge>
                        </div>
                        {evt.project.assignedOwnerName && (
                          <p className="text-[11px] text-muted-foreground">Owner: {evt.project.assignedOwnerName}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
