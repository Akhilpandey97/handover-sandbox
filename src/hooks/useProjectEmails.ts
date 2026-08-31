import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/hooks/useActivityLogs";

export interface ProjectEmailMessage {
  id: string;
  from: string;
  to: string;
  cc?: string;
  date: string;
  subject: string;
  snippet: string;
  body_text: string;
  body_html: string;
}

export interface ProjectEmailThread {
  id: string;
  gmailThreadId: string;
  subject: string;
  snippet: string;
  participants: string[];
  threadDate: string;
  messageCount: number;
  messages: ProjectEmailMessage[];
}

export interface ActionItem {
  title: string;
  description?: string;
  owner?: "GoKwik" | "Merchant" | "Unknown" | string;
  priority?: "high" | "medium" | "low" | string;
  source?: "email" | "jira" | "both" | string;
  reference?: string;
}

export interface ProjectEmailContext {
  summary: string;
  testCases: { title: string; description: string }[];
  checklistContext: string;
  actionItems: ActionItem[];
  generatedAt: string;
  emailCount: number;
}

const THREAD_CACHE_TTL = 5 * 60_000;
const threadCache = new Map<string, { at: number; threads: ProjectEmailThread[] }>();

export const useProjectEmails = (projectId: string | undefined) => {
  const { currentUser } = useAuth();
  const [threads, setThreads] = useState<ProjectEmailThread[]>([]);
  const [emailContext, setEmailContext] = useState<ProjectEmailContext | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch cached threads from project_emails table.
  // Cached in-memory per project so re-opening the dialog doesn't re-pull the
  // (very heavy) messages JSON on every mount.
  const fetchCachedThreads = useCallback(async (force = false) => {
    if (!projectId) return;
    const cached = threadCache.get(projectId);
    if (!force && cached && Date.now() - cached.at < THREAD_CACHE_TTL) {
      setThreads(cached.threads);
      return;
    }
    setIsLoadingThreads(true);
    try {
      const { data, error } = await (supabase as any)
        .from("project_emails")
        .select("id, gmail_thread_id, subject, snippet, participants, thread_date, message_count, messages")
        .eq("project_id", projectId)
        .order("thread_date", { ascending: false });

      if (!error && data) {
        const mapped = data.map((row: any) => ({
          id: row.id,
          gmailThreadId: row.gmail_thread_id,
          subject: row.subject,
          snippet: row.snippet || "",
          participants: row.participants || [],
          threadDate: row.thread_date,
          messageCount: row.message_count || 1,
          messages: Array.isArray(row.messages) ? row.messages : [],
        }));
        threadCache.set(projectId, { at: Date.now(), threads: mapped });
        setThreads(mapped);
      }
    } finally {
      setIsLoadingThreads(false);
    }
  }, [projectId]);


  // Fetch cached AI context from project_email_context table
  const fetchCachedContext = useCallback(async () => {
    if (!projectId) return;
    setIsLoadingContext(true);
    try {
      const { data, error } = await (supabase as any)
        .from("project_email_context")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();

      if (!error && data) {
        setEmailContext({
          summary: data.summary || "",
          testCases: Array.isArray(data.test_cases) ? data.test_cases : [],
          checklistContext: data.checklist_context || "",
          actionItems: Array.isArray(data.action_items) ? data.action_items : [],
          generatedAt: data.generated_at,
          emailCount: data.email_count || 0,
        });
      }
    } finally {
      setIsLoadingContext(false);
    }
  }, [projectId]);

  // Refresh: call fetch-project-emails edge function then reload from DB
  const refreshEmails = useCallback(async () => {
    if (!projectId || !currentUser?.tenantId) return;
    setIsRefreshing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/public/fetch-project-emails`,
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
        await fetchCachedThreads(true);
        logActivity({ action_type: "user", category: "email", description: "Refreshed email threads", entity_type: "project", entity_id: projectId });
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("fetch-project-emails error:", err);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [projectId, currentUser?.tenantId, fetchCachedThreads]);

  // Generate AI context from current threads
  const generateAiContext = useCallback(async () => {
    if (!projectId || !currentUser?.tenantId || threads.length === 0) return;
    setIsLoadingContext(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(
        `/api/public/ai-project-insights`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            type: "email_context",
            project_id: projectId,
            tenant_id: currentUser.tenantId,
            threads,
          }),
        }
      );
      await fetchCachedContext();
    } finally {
      setIsLoadingContext(false);
    }
  }, [projectId, currentUser?.tenantId, threads, fetchCachedContext]);

  // Load cached data on mount
  useEffect(() => {
    fetchCachedThreads();
    fetchCachedContext();
  }, [fetchCachedThreads, fetchCachedContext]);

  return {
    threads,
    emailContext,
    isLoadingThreads,
    isLoadingContext,
    isRefreshing,
    refreshEmails,
    generateAiContext,
  };
};
