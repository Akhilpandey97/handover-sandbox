import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/hooks/useActivityLogs";

export interface JiraTicket {
  id: string;
  jiraKey: string;
  summary: string | null;
  status: string | null;
  statusCategory: string | null;
  priority: string | null;
  issueType: string | null;
  resolution: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  assigneeAvatar: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  reporterAvatar: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  projectKey: string | null;
  projectName: string | null;
  created: string | null;
  updated: string | null;
  dueDate: string | null;
  resolvedAt: string | null;
  labels: string[];
  components: string[];
  fixVersions: string[];
  affectsVersions: string[];
  description: string | null;
  environment: string | null;
  storyPoints: number | null;
  sprint: string | null;
  epicKey: string | null;
  epicName: string | null;
  parentKey: string | null;
  subtaskCount: number;
  commentCount: number;
  attachmentCount: number;
  watchersCount: number;
  votes: number;
  url: string | null;
  fetchedAt: string;
}

const mapRow = (row: any): JiraTicket => ({
  id: row.id,
  jiraKey: row.jira_key,
  summary: row.summary,
  status: row.status,
  statusCategory: row.status_category,
  priority: row.priority,
  issueType: row.issue_type,
  resolution: row.resolution,
  assigneeName: row.assignee_name,
  assigneeEmail: row.assignee_email,
  assigneeAvatar: row.assignee_avatar,
  reporterName: row.reporter_name,
  reporterEmail: row.reporter_email,
  reporterAvatar: row.reporter_avatar,
  creatorName: row.creator_name,
  creatorEmail: row.creator_email,
  projectKey: row.project_key,
  projectName: row.project_name,
  created: row.created,
  updated: row.updated,
  dueDate: row.due_date,
  resolvedAt: row.resolved_at,
  labels: row.labels || [],
  components: row.components || [],
  fixVersions: row.fix_versions || [],
  affectsVersions: row.affects_versions || [],
  description: row.description,
  environment: row.environment,
  storyPoints: row.story_points,
  sprint: row.sprint,
  epicKey: row.epic_key,
  epicName: row.epic_name,
  parentKey: row.parent_key,
  subtaskCount: row.subtask_count || 0,
  commentCount: row.comment_count || 0,
  attachmentCount: row.attachment_count || 0,
  watchersCount: row.watchers_count || 0,
  votes: row.votes || 0,
  url: row.url,
  fetchedAt: row.fetched_at,
});

export const useProjectJiraTickets = (projectId: string | undefined) => {
  const { currentUser } = useAuth();
  const [tickets, setTickets] = useState<JiraTicket[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchCached = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("project_jira_tickets")
        .select("*")
        .eq("project_id", projectId)
        .order("updated", { ascending: false, nullsFirst: false });
      if (!error && data) setTickets(data.map(mapRow));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const refreshTickets = useCallback(async () => {
    if (!projectId || !currentUser?.tenantId) return;
    setIsRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-project-jira-tickets`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ project_id: projectId, tenant_id: currentUser.tenantId }),
        }
      );
      if (res.ok) {
        await fetchCached();
        logActivity({ action_type: "user", category: "jira", description: "Refreshed Jira tickets", entity_type: "project", entity_id: projectId });
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("fetch-project-jira-tickets error:", err);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [projectId, currentUser?.tenantId, fetchCached]);

  useEffect(() => {
    fetchCached();
  }, [fetchCached]);

  return { tickets, isLoading, isRefreshing, refreshTickets };
};
