import { createFileRoute } from "@tanstack/react-router";

import { corsHeaders } from "@/lib/api-cors";
import { createClient } from "@supabase/supabase-js";

const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SERVICE_ROLE = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { projectIds, month } = await req.json();
    if (!Array.isArray(projectIds) || projectIds.length === 0 || !month) {
      return new Response(JSON.stringify({ error: 'projectIds[] and month required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch context for each project (last 7 days)
    const [projects, activity, comments, checklistComments, jira] = await Promise.all([
      sb.from('projects').select('id, merchant_name, project_state, current_phase, current_responsibility, expected_go_live_date, assigned_owner').in('id', projectIds),
      sb.from('activity_logs').select('project_id, action, details, created_at').in('project_id', projectIds).gte('created_at', since).order('created_at', { ascending: false }),
      sb.from('project_comment_logs').select('project_id, comment, created_at').in('project_id', projectIds).gte('created_at', since).order('created_at', { ascending: false }),
      sb.from('checklist_comments').select('checklist_item_id, comment, created_at').gte('created_at', since).order('created_at', { ascending: false }),
      sb.from('project_jira_tickets').select('project_id, key, summary, status, jira_url, updated_at').in('project_id', projectIds),
    ]);

    // Map checklist comments to projects via items
    const items = await sb.from('checklist_items').select('id, project_id').in('project_id', projectIds);
    const itemToProject: Record<string, string> = {};
    (items.data || []).forEach((i: any) => { itemToProject[i.id] = i.project_id; });

    const byProject: Record<string, any[]> = {};
    for (const id of projectIds) byProject[id] = [];
    (activity.data || []).forEach((a: any) => byProject[a.project_id]?.push({ type: 'activity', when: a.created_at, text: `${a.action}: ${JSON.stringify(a.details || {})}` }));
    (comments.data || []).forEach((c: any) => byProject[c.project_id]?.push({ type: 'comment', when: c.created_at, text: c.comment }));
    (checklistComments.data || []).forEach((c: any) => {
      const pid = itemToProject[c.checklist_item_id];
      if (pid) byProject[pid]?.push({ type: 'checklist_comment', when: c.created_at, text: c.comment });
    });
    const jiraByProject: Record<string, any[]> = {};
    (jira.data || []).forEach((j: any) => {
      jiraByProject[j.project_id] ??= [];
      jiraByProject[j.project_id].push(j);
    });

    const results: any[] = [];

    for (const p of (projects.data || []) as any[]) {
      const ctx = (byProject[p.id] || []).slice(0, 25);
      const openJira = (jiraByProject[p.id] || []).filter((j: any) => j.status && !/done|closed|resolved/i.test(j.status));
      const jiraLine = openJira.length ? openJira.map((j: any) => `${j.key} (${j.status}): ${j.summary} ${j.jira_url || ''}`).join(' | ') : '';

      const prompt = `You are tracking SaaS go-live projects. Given recent activity for one project, return STRICT JSON with fields:
{"blocker": string, "blocked_on": string, "deadline": string, "confidence": "High"|"Medium"|"Low"}

- "blocker": one-line description of the current blocker. If no blocker, return "Unblocked".
- "blocked_on": who is responsible to unblock — e.g. "Tech/KP Team", "Merchant", "Sales", "GoKwik", or person name if mentioned. Empty if unblocked.
- "deadline": date string mentioned in context (e.g. "17th June") for blocker resolution, else "".
- "confidence": High/Medium/Low confidence that merchant goes live on expected date.

Project: ${p.merchant_name}
State: ${p.project_state}, Phase: ${p.current_phase}, Responsibility: ${p.current_responsibility}
Expected Go-Live: ${p.expected_go_live_date || 'TBD'}
Open JIRA: ${jiraLine || 'none'}

Recent activity (last 7 days, newest first):
${ctx.map(c => `[${c.when}] (${c.type}) ${c.text}`).join('\n').slice(0, 4000)}

Return ONLY JSON, nothing else.`;

      try {
        const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
          }),
        });
        const j = await r.json();
        const content = j?.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(content);

        const blockerText = openJira.length
          ? `${openJira[0].jira_url || openJira[0].key} — ${openJira[0].summary}`
          : (parsed.blocker || 'Unblocked');

        const upsertRow = {
          project_id: p.id,
          month,
          blocker: blockerText,
          blocked_on: parsed.blocked_on || '',
          deadline: parsed.deadline || '',
          confidence: parsed.confidence || 'Medium',
          ai_generated_at: new Date().toISOString(),
        };
        // Upsert respecting manual overrides
        const existing = await sb.from('project_ai_insights').select('manual_overrides').eq('project_id', p.id).eq('month', month).maybeSingle();
        const overrides = (existing.data?.manual_overrides as Record<string, string>) || {};
        const finalRow: any = { ...upsertRow };
        for (const k of Object.keys(overrides)) {
          if (overrides[k] !== undefined && overrides[k] !== null) finalRow[k] = overrides[k];
        }
        await sb.from('project_ai_insights').upsert(finalRow, { onConflict: 'project_id,month' });
        results.push({ project_id: p.id, ok: true });
      } catch (e: any) {
        results.push({ project_id: p.id, ok: false, error: String(e?.message || e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

export const Route = createFileRoute("/api/public/enrich-golive-tracker")({
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
