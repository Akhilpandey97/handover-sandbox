import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActivityLogs, ActivityLog } from "@/hooks/useActivityLogs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Activity, Search, Filter, ChevronDown, ChevronRight, Bot, User, Settings, CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

const ACTION_TYPE_CONFIG: Record<string, { icon: typeof Bot; label: string; color: string }> = {
  ai: { icon: Bot, label: "AI", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400" },
  user: { icon: User, label: "User", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  system: { icon: Settings, label: "System", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

const CATEGORY_OPTIONS = [
  { value: "all", label: "All Categories" },
  { value: "project", label: "Project" },
  { value: "checklist", label: "Checklist" },
  { value: "transfer", label: "Transfer" },
  { value: "workflow", label: "Workflow" },
  { value: "auth", label: "Auth" },
  { value: "api", label: "API" },
  { value: "settings", label: "Settings" },
];

export const ActivityLogViewer = () => {
  const { data: logs = [], isLoading } = useActivityLogs(500);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = logs.filter((log) => {
    if (typeFilter !== "all" && log.action_type !== typeFilter) return false;
    if (categoryFilter !== "all" && log.category !== categoryFilter) return false;
    if (statusFilter !== "all" && log.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        log.description.toLowerCase().includes(q) ||
        (log.user_name || "").toLowerCase().includes(q) ||
        (log.entity_type || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />Activity Log
            </CardTitle>
            <CardDescription>All system, user, and AI activities with full API call details</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["activity_logs"] })}
          >
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search activities..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="ai">AI</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats bar */}
        <div className="flex gap-4 text-xs text-muted-foreground border-b pb-2">
          <span>Total: {filtered.length}</span>
          <span>Success: {filtered.filter(l => l.status === "success").length}</span>
          <span className="text-destructive">Failed: {filtered.filter(l => l.status === "failed").length}</span>
        </div>

        {/* Log entries */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No activity logs found</p>
            <p className="text-sm">Activities will appear here as you use the application</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="space-y-1">
              {filtered.map((log) => (
                <LogEntry key={log.id} log={log} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};

const LogEntry = ({ log }: { log: ActivityLog }) => {
  const [isOpen, setIsOpen] = useState(false);
  const config = ACTION_TYPE_CONFIG[log.action_type] || ACTION_TYPE_CONFIG.system;
  const Icon = config.icon;
  const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group">
          <div className="mt-0.5">
            {log.status === "failed" ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <Badge className={`text-micro px-1.5 py-0 ${config.color}`}>
                <Icon className="h-3 w-3 mr-1" />{config.label}
              </Badge>
              <Badge variant="outline" className="text-micro px-1.5 py-0">
                {log.category}
              </Badge>
              {log.entity_type && (
                <span className="text-micro text-muted-foreground">{log.entity_type}</span>
              )}
            </div>
            <p className="text-sm truncate">{log.description}</p>
            <div className="flex gap-3 text-micro text-muted-foreground mt-0.5">
              {log.user_name && <span>{log.user_name}</span>}
              <span>{format(new Date(log.created_at), "dd MMM yyyy HH:mm:ss")}</span>
            </div>
          </div>

          {hasMetadata && (
            <div className="shrink-0 mt-1 text-muted-foreground group-hover:text-foreground transition-colors">
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          )}
        </div>
      </CollapsibleTrigger>
      {hasMetadata && (
        <CollapsibleContent>
          <div className="ml-10 mr-4 mb-2 p-3 rounded-md bg-muted/50 border">
            <p className="text-micro font-medium text-muted-foreground mb-1">Full Details (API Payload)</p>
            <pre className="text-xs whitespace-pre-wrap font-mono max-h-[300px] overflow-auto">
              {JSON.stringify(log.metadata, null, 2)}
            </pre>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};
