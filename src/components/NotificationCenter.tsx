import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, AtSign, ListTodo, CheckCheck, Folder, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNotifications, useMarkNotificationRead, type AppNotification } from "@/hooks/useNotifications";
import { useProjects } from "@/contexts/ProjectContext";
import { cn } from "@/lib/utils";

const typeIcon = (type: string) => {
  if (type === "mention") return <AtSign className="h-3.5 w-3.5" />;
  return <ListTodo className="h-3.5 w-3.5" />;
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

export const NotificationCenter = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const { projects } = useProjects();

  const unread = notifications.filter((n) => !n.read_at);

  // Group project → notification rows
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { projectId: string | null; projectName: string | null; rows: AppNotification[] }
    >();
    for (const n of notifications) {
      const pKey = n.project_id || "none";
      if (!groups.has(pKey)) {
        groups.set(pKey, {
          projectId: n.project_id,
          projectName:
            n.project_name ||
            (projects || []).find((project) => project.id === n.project_id)?.merchantName ||
            null,
          rows: [],
        });
      }
      groups.get(pKey)!.rows.push(n);
    }
    return Array.from(groups.values());
  }, [notifications, projects]);

  const handleClick = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate([n.id]);
    setOpen(false);
    if (!n.project_id) return;
    navigate({
      to: "/projects/$projectId",
      params: { projectId: n.project_id },
      search: {
        tab: "checklists",
        ...(n.checklist_item_id ? { item: n.checklist_item_id } : {}),
        ...(n.task_id ? { task: n.task_id } : {}),
      } as never,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread.length > 99 ? "99+" : unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[520px] p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-base font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">{unread.length} unread</p>
          </div>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => markRead.mutate(unread.map((n) => n.id))}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[560px] overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {grouped.map((project) => (
                <div key={project.projectId || "none"} className="py-3">
                  <div className="flex items-center gap-2 px-5 pb-1.5 pt-0.5">
                    <Folder className="h-3.5 w-3.5 text-primary" />
                    <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">
                      {project.projectName || "Project updates"}
                    </p>
                  </div>
                  <div className="px-3">
                    {project.rows.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => handleClick(n)}
                        className={cn(
                          "flex w-full gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60",
                          !n.read_at && "bg-primary/5",
                        )}
                      >
                        <span className="mt-0.5 shrink-0 text-primary">{typeIcon(n.type)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-foreground">{n.title}</span>
                            {!n.read_at && <Badge className="h-4 px-1.5 text-[9px]">New</Badge>}
                          </span>
                          {n.checklist_item_title && (
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <FileCheck className="h-3 w-3" />
                              {n.checklist_item_title}
                            </span>
                          )}
                          {n.body && (
                            <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">{n.body}</span>
                          )}
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {n.actor_name ? `${n.actor_name} · ` : ""}
                            {timeAgo(n.created_at)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
