import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Convert Atlassian Document Format → plain text (best-effort).
function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text" && typeof node.text === "string") return node.text;
  const children = Array.isArray(node.content) ? node.content : [];
  const sep = ["paragraph", "heading", "bulletList", "orderedList", "listItem", "codeBlock"].includes(node.type) ? "\n" : "";
  return children.map(adfToText).join("") + sep;
}

function arr(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any) => (typeof x === "string" ? x : x?.name ?? x?.value ?? "")).filter(Boolean);
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = process.env['SUPABASE_URL']!;
    const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
    const JIRA_BASE_URL = (process.env['JIRA_BASE_URL'] || "").replace(/\/+$/, "");
    const JIRA_EMAIL = process.env['JIRA_EMAIL'];
    const JIRA_API_TOKEN = process.env['JIRA_API_TOKEN'];

    if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Jira credentials not configured." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { project_id, tenant_id } = body;

    if (!project_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: "project_id and tenant_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, merchant_name, mid")
      .eq("id", project_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const merchantName = (project.merchant_name || "").trim().replace(/"/g, '\\"');
    const mid = (project.mid || "").trim();
    const isValidMid = mid && mid.toUpperCase() !== "NA" && mid.length >= 4;

    // Use Jira's exact-phrase match: summary ~ "\"For Real\"" forces phrase matching
    // instead of tokenized OR matching that returns unrelated tickets.
    const jqlClauses: string[] = [];
    if (merchantName) {
      jqlClauses.push(`summary ~ "\\"${merchantName}\\""`);
    }
    if (isValidMid) {
      const safeMid = mid.replace(/"/g, '\\"');
      jqlClauses.push(`text ~ "\\"${safeMid}\\""`);
    }

    if (jqlClauses.length === 0) {
      return new Response(
        JSON.stringify({ tickets: [], message: "No merchant_name or valid MID to search." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const jql = `(${jqlClauses.join(" OR ")}) ORDER BY updated DESC`;
    const auth = btoa(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`);

    const fields = [
      "summary","status","priority","issuetype","resolution",
      "assignee","reporter","creator","project",
      "created","updated","duedate","resolutiondate",
      "labels","components","fixVersions","versions",
      "description","environment",
      "parent","subtasks","comment","attachment","watches","votes",
      "customfield_10016", // story points (common)
      "customfield_10020", // sprint (common)
      "customfield_10014", // epic link (common)
    ].join(",");

    const searchUrl = `${JIRA_BASE_URL}/rest/api/3/search/jql`;

    console.log(`[fetch-project-jira-tickets] JQL: ${jql}`);

    const jiraRes = await fetch(searchUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        fields: fields.split(","),
        maxResults: 50,
      }),
    });

    if (!jiraRes.ok) {
      const errText = await jiraRes.text();
      console.error("Jira API error:", jiraRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Jira API error (${jiraRes.status}): ${errText.slice(0, 500)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const jiraData = await jiraRes.json();
    const issues: any[] = jiraData.issues || [];
    console.log(`Found ${issues.length} Jira issues`);

    const records = issues.map((issue: any) => {
      const f = issue.fields || {};
      const sprintField = f.customfield_10020;
      const sprintName = Array.isArray(sprintField)
        ? sprintField.map((s: any) => s?.name).filter(Boolean).join(", ")
        : (sprintField?.name || null);

      return {
        project_id,
        tenant_id,
        jira_key: issue.key,
        summary: f.summary || null,
        status: f.status?.name || null,
        status_category: f.status?.statusCategory?.key || null,
        priority: f.priority?.name || null,
        issue_type: f.issuetype?.name || null,
        resolution: f.resolution?.name || null,
        assignee_name: f.assignee?.displayName || null,
        assignee_email: f.assignee?.emailAddress || null,
        assignee_avatar: f.assignee?.avatarUrls?.["48x48"] || null,
        reporter_name: f.reporter?.displayName || null,
        reporter_email: f.reporter?.emailAddress || null,
        reporter_avatar: f.reporter?.avatarUrls?.["48x48"] || null,
        creator_name: f.creator?.displayName || null,
        creator_email: f.creator?.emailAddress || null,
        project_key: f.project?.key || null,
        project_name: f.project?.name || null,
        created: f.created || null,
        updated: f.updated || null,
        due_date: f.duedate || null,
        resolved_at: f.resolutiondate || null,
        labels: arr(f.labels),
        components: arr(f.components),
        fix_versions: arr(f.fixVersions),
        affects_versions: arr(f.versions),
        description: typeof f.description === "string" ? f.description : adfToText(f.description),
        environment: typeof f.environment === "string" ? f.environment : adfToText(f.environment),
        story_points: typeof f.customfield_10016 === "number" ? f.customfield_10016 : null,
        sprint: sprintName,
        epic_key: typeof f.customfield_10014 === "string" ? f.customfield_10014 : null,
        epic_name: null,
        parent_key: f.parent?.key || null,
        subtask_count: Array.isArray(f.subtasks) ? f.subtasks.length : 0,
        comment_count: f.comment?.total ?? (Array.isArray(f.comment?.comments) ? f.comment.comments.length : 0),
        attachment_count: Array.isArray(f.attachment) ? f.attachment.length : 0,
        watchers_count: f.watches?.watchCount ?? 0,
        votes: f.votes?.votes ?? 0,
        url: `${JIRA_BASE_URL}/browse/${issue.key}`,
        raw: issue,
        fetched_at: new Date().toISOString(),
      };
    });

    // Clear stale cached tickets for this project (previous loose query may have stored unrelated tickets)
    await supabase.from("project_jira_tickets").delete().eq("project_id", project_id);

    if (records.length > 0) {
      const { error: upsertError } = await supabase
        .from("project_jira_tickets")
        .upsert(records, { onConflict: "project_id,jira_key" });
      if (upsertError) console.error("Upsert error:", upsertError);
    }

    return new Response(
      JSON.stringify({
        tickets: records.map((r) => ({ ...r, raw: undefined })),
        total: records.length,
        message: `Fetched ${records.length} Jira ticket(s)`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fetch-project-jira-tickets:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

export const Route = createFileRoute("/api/public/fetch-project-jira-tickets")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      PUT: ({ request }) => handler(request),
      PATCH: ({ request }) => handler(request),
      DELETE: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
