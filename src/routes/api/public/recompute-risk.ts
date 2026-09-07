import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_RISK_RULES,
  RISK_SETTINGS_KEY,
  RiskInput,
  RiskRule,
  evaluateRisk,
  isRiskExempt,
  parseRiskRules,
} from "@/data/riskRules";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Recomputes risk for one tenant and reconciles the auto rows in project_risks.
 *
 * Every query filters tenant_id explicitly: this runs with the service role,
 * which bypasses RLS, so relying on it the way the browser does would write
 * across tenants.
 */
async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string | undefined = body.tenant_id;
    if (!tenantId) return json({ error: "tenant_id required" }, 400);

    const supabase = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!);

    // Tenant's configured rules, falling back to the defaults.
    const { data: settingRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", RISK_SETTINGS_KEY)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const rules: RiskRule[] = settingRow
      ? parseRiskRules((settingRow as { value?: string }).value)
      : DEFAULT_RISK_RULES;
    const rulesById = new Map(rules.map((r) => [r.id, r]));

    const { data: projects, error: projectsError } = await supabase
      .from("projects")
      .select("id, merchant_name, project_state, expected_go_live_date, updated_at, archived")
      .eq("tenant_id", tenantId);
    if (projectsError) throw projectsError;

    const live = (projects || []).filter((p: any) => !p.archived && !isRiskExempt(p.project_state));
    if (live.length === 0) return json({ tenant_id: tenantId, evaluated: 0, opened: 0, resolved: 0 });

    const { data: items, error: itemsError } = await supabase
      .from("checklist_items")
      .select("project_id, completed, due_date, is_task")
      .eq("tenant_id", tenantId);
    if (itemsError) throw itemsError;

    const checklistByProject = new Map<string, RiskInput["checklist"]>();
    for (const it of (items || []) as any[]) {
      const list = checklistByProject.get(it.project_id) || [];
      list.push({ completed: !!it.completed, dueDate: it.due_date, isTask: it.is_task });
      checklistByProject.set(it.project_id, list);
    }

    const { data: activity } = await supabase.rpc("project_last_activity" as never, { _tenant_id: tenantId } as never);
    const lastActivity = new Map<string, string>();
    for (const row of (activity || []) as any[]) {
      if (row.last_comment_at) lastActivity.set(row.project_id, row.last_comment_at);
    }

    // The firing set for this run.
    const firing = new Map<string, { projectId: string; merchantName: string; ruleId: string; detail: string; severity: string }>();
    for (const p of live as any[]) {
      const verdict = evaluateRisk(
        {
          projectState: p.project_state,
          expectedGoLiveDate: p.expected_go_live_date,
          // The derived-go-live shortcut is a client transform; server-side the
          // column is only ever a real value.
          expectedGoLiveDateIsDerived: false,
          checklist: checklistByProject.get(p.id) || [],
          lastActivityAt: lastActivity.get(p.id) ?? null,
          updatedAt: p.updated_at,
        },
        rules,
      );
      for (const f of verdict.findings) {
        firing.set(`${p.id}::${f.ruleId}`, {
          projectId: p.id,
          merchantName: p.merchant_name,
          ruleId: f.ruleId,
          detail: f.detail,
          severity: f.severity,
        });
      }
    }

    const { data: openRows, error: openError } = await supabase
      .from("project_risks")
      .select("id, project_id, trigger_rule, status")
      .eq("tenant_id", tenantId)
      .eq("trigger_type", "auto")
      .not("status", "in", '("resolved","dismissed")');
    if (openError) throw openError;

    const openByKey = new Map<string, any>();
    for (const r of (openRows || []) as any[]) openByKey.set(`${r.project_id}::${r.trigger_rule}`, r);

    // Open rows for newly firing rules. Human-owned fields (severity once set,
    // assigned_to, mitigation_plan, escalated) are never touched after insert.
    const toInsert = [...firing.entries()]
      .filter(([key]) => !openByKey.has(key))
      .map(([, f]) => ({
        tenant_id: tenantId,
        project_id: f.projectId,
        title: `${f.merchantName}: ${f.detail}`,
        description: f.detail,
        category: "project_viability",
        severity: rulesById.get(f.ruleId)?.severity || f.severity,
        status: "open",
        trigger_type: "auto",
        trigger_rule: f.ruleId,
        created_by: "Risk engine",
      }));

    if (toInsert.length > 0) {
      const { error } = await supabase.from("project_risks").insert(toInsert as any);
      if (error) throw error;
    }

    // Resolve rows whose cause has cleared. Re-firing later inserts a new row,
    // so resolved_at history survives.
    const stale = [...openByKey.entries()].filter(([key]) => !firing.has(key)).map(([, r]) => r.id);
    if (stale.length > 0) {
      const { error } = await supabase
        .from("project_risks")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .in("id", stale);
      if (error) throw error;
    }

    return json({
      tenant_id: tenantId,
      evaluated: live.length,
      at_risk: new Set([...firing.values()].map((f) => f.projectId)).size,
      opened: toInsert.length,
      resolved: stale.length,
    });
  } catch (err) {
    console.error("recompute-risk failed:", err);
    return json({ error: (err as Error).message }, 500);
  }
}

export const Route = createFileRoute("/api/public/recompute-risk")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
