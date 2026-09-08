import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "assign_owner",
      description: "Assign an owner to a project by their user ID and name",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project UUID to assign" },
          owner_id: { type: "string", description: "The user UUID to assign as owner" },
          owner_name: { type: "string", description: "The display name of the owner" },
        },
        required: ["project_id", "owner_id", "owner_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_project_field",
      description: "Update a specific field on a project. Allowed fields: project_state, current_phase, platform, category, arr, txns_per_day, aov, sales_spoc, integration_type, pg_onboarding, go_live_percent, expected_go_live_date, project_notes, mint_notes, current_phase_comment",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project UUID" },
          field: { type: "string", description: "The database field name to update (snake_case, exactly as listed in schema)" },
          value: { type: "string", description: "The new value for the field" },
        },
        required: ["project_id", "field", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_workflow",
      description: "Create an automated workflow rule that triggers actions based on conditions. Trigger types: time_based (delay-based), field_change (when a field changes to a value), event (on project creation, transfer, etc.). Action types: assign_owner, update_field, send_notification, transfer_project.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name for the workflow" },
          description: { type: "string", description: "What this workflow does" },
          trigger_type: { type: "string", enum: ["time_based", "field_change", "event"], description: "When to trigger" },
          trigger_config: {
            type: "object",
            description: "Trigger configuration. For time_based: {delay_hours, condition_field, condition_value}. For field_change: {field, from_value, to_value}. For event: {event_name}.",
          },
          action_type: { type: "string", enum: ["assign_owner", "update_field", "send_notification", "transfer_project"], description: "What action to perform" },
          action_config: {
            type: "object",
            description: "Action configuration. For assign_owner: {owner_id, owner_name}. For update_field: {field, value}. For send_notification: {message}. For transfer_project: {to_team}.",
          },
        },
        required: ["name", "description", "trigger_type", "trigger_config", "action_type", "action_config"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bulk_update_projects",
      description: "Update a field across multiple projects at once. Use with caution.",
      parameters: {
        type: "object",
        properties: {
          project_ids: { type: "array", items: { type: "string" }, description: "Array of project UUIDs" },
          field: { type: "string", description: "The field to update" },
          value: { type: "string", description: "The new value" },
        },
        required: ["project_ids", "field", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trigger_brd",
      description: "Trigger a BRD (Business Requirements Document) form for a project. This sends an email to the merchant's contact email with a link to fill out the BRD Form. Once the merchant completes the form, responses are saved as an Excel file and the URL is stored in the project's BRD Link field. Uses the 'BRD Form' template automatically.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project UUID to trigger BRD for" },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_responsibility",
      description: "Toggle the current responsibility party for a project between 'gokwik', 'merchant', or 'neutral'. Use this when asked to change who is currently responsible or who the ball is with.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project UUID" },
          party: { type: "string", enum: ["gokwik", "merchant", "neutral"], description: "The responsibility party to set" },
        },
        required: ["project_id", "party"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description: "Create a new project in the system. Required: merchant_name, mid, kick_off_date (YYYY-MM-DD). All other fields are optional with sensible defaults. Use exact snake_case field names and valid enum values from the schema.",
      parameters: {
        type: "object",
        properties: {
          merchant_name: { type: "string", description: "Merchant/brand name (required)" },
          mid: { type: "string", description: "Merchant ID — unique identifier (required)" },
          kick_off_date: { type: "string", description: "Project start date in YYYY-MM-DD format (required). If user doesn't provide one, use today's date." },
          platform: { type: "string", description: "E.g. Shopify, WooCommerce, Magento, Custom. Defaults to 'Custom'." },
          category: { type: "string", description: "Business category (e.g. Fashion, Electronics, Beauty)" },
          arr: { type: "number", description: "Annual Recurring Revenue in Crores (numeric)" },
          txns_per_day: { type: "number", description: "Average transactions per day" },
          aov: { type: "number", description: "Average Order Value" },
          brand_url: { type: "string", description: "Brand website URL" },
          contact_email: { type: "string", description: "Merchant contact email (used for BRD and notifications)" },
          sales_spoc: { type: "string", description: "Sales single-point-of-contact name" },
          integration_type: { type: "string", description: "Integration type. Defaults to 'Standard'." },
          pg_onboarding: { type: "string", description: "Payment gateway onboarding info" },
          current_phase: { type: "string", enum: ["mint", "integration", "ms", "completed"], description: "Project phase. Defaults to 'mint'." },
          current_owner_team: { type: "string", description: "Team currently owning the project (e.g. mint, integration, ms). Defaults to 'mint'." },
          project_state: { type: "string", enum: ["not_started", "on_hold", "in_progress", "live", "blocked"], description: "Defaults to 'not_started'." },
          expected_go_live_date: { type: "string", description: "Expected go-live date in YYYY-MM-DD format" },
          project_notes: { type: "string", description: "Initial project notes" },
          mint_notes: { type: "string", description: "Internal pre-sales team notes (mint_notes column)" },
          jira_link: { type: "string" },
          sow_link: { type: "string" },
          brd_link: { type: "string" },
        },
        required: ["merchant_name", "mid", "kick_off_date"],
      },
    },
  },
];

// Comprehensive schema reference so the AI always uses correct field names + enums
const SCHEMA_REFERENCE = `
DATABASE SCHEMA REFERENCE (use these EXACT snake_case field names and enum values):

═══ projects table ═══
Required: merchant_name (text), mid (text, unique), kick_off_date (date YYYY-MM-DD)
Identifiers: id (uuid), tenant_id (uuid)
Core fields:
  - platform (text, default 'Custom') — Shopify | WooCommerce | Magento | Custom | etc.
  - category (text) — Fashion | Electronics | Beauty | F&B | etc.
  - arr (numeric, in Crores), txns_per_day (int), aov (numeric)
  - brand_url (text), contact_email (text)
  - sales_spoc (text), integration_type (text, default 'Standard')
  - pg_onboarding (text)
Phase & state:
  - current_phase: ENUM 'mint' | 'integration' | 'ms' | 'completed' (default 'mint')
  - current_owner_team (text, default 'mint') — mint | integration | ms | manager | super_admin | gokwik_general
  - project_state: ENUM 'not_started' | 'on_hold' | 'in_progress' | 'live' | 'blocked' (default 'not_started')
  - current_responsibility: ENUM 'gokwik' | 'merchant' | 'neutral' (default 'neutral')
  - pending_acceptance (bool), assigned_owner (uuid), go_live_percent (int 0-100)
Dates: expected_go_live_date, go_live_date (date)
Notes (append-style with timestamp via AI): project_notes, mint_notes, current_phase_comment, phase2_comment
Links: jira_link, brd_link, sow_link, mint_checklist_link, integration_checklist_link
Flags: archived (bool), archived_at (ts)

═══ Other key tables ═══
- checklist_items: project_id, title, phase, owner_team, completed, current_responsibility, due_date, sort_order, is_task
- checklist_tasks: checklist_item_id, project_id, title, status, priority ('low'|'medium'|'high'), assigned_to, due_date
- ai_workflows: name, trigger_type, trigger_config, action_type, action_config, is_active
- custom_fields: field_key, field_label, field_type ('text'|'number'|'date'|'select'), options
- transfer_history: project_id, from_team, to_team, transferred_by, accepted_by, notes

═══ Enums ═══
- project_phase: mint | integration | ms | completed
- project_state: not_started | on_hold | in_progress | live | blocked
- responsibility_party: gokwik | merchant | neutral
- team_role: mint | integration | ms | manager | super_admin | gokwik_general

CRITICAL RULES:
1. Always use snake_case field names exactly as listed above (NOT camelCase like merchantName).
2. Use enum values exactly as listed (lowercase, underscores).
3. Dates must be YYYY-MM-DD format.
4. For create_project: if user doesn't specify kick_off_date, use today's date.
5. mid must be unique — if uncertain, ask the user.
`;

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, projectContext, enableActions } = await req.json();
    const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You are an AI assistant for a project management dashboard. You can both answer questions AND take actions on projects.

Today's date: ${today}

${SCHEMA_REFERENCE}

${projectContext ? `CURRENT PROJECT DATA CONTEXT:\n${projectContext}\n\n` : ""}

CAPABILITIES - You can:
1. **Answer questions** about projects, timelines, team workloads, risks
2. **Create projects** using the create_project tool (requires merchant_name, mid, kick_off_date)
3. **Assign owners** to projects using the assign_owner tool
4. **Update project fields** like state, phase, notes using update_project_field tool
5. **Create automated workflows** using the create_workflow tool
6. **Bulk update** multiple projects using bulk_update_projects tool
7. **Trigger BRD** - Send a BRD form to a merchant using the trigger_brd tool
8. **Toggle Responsibility** - Switch the responsible party (internal, merchant or neutral) using toggle_responsibility tool

GUIDELINES:
- Be concise and actionable
- When asked to make changes, USE THE TOOLS to actually make the changes
- **IMPORTANT: All actions require user approval before execution.**
- ALWAYS use exact snake_case field names and valid enum values from the schema reference above
- For create_project: if the user gives a project name without an MID, ask for the MID. If kick_off_date is omitted, use today (${today}).
- For note fields (project_notes, mint_notes, current_phase_comment), new notes are APPENDED with timestamps
- After executing an action, confirm what was done
- Reference specific project names and MIDs when available`;

    const body: any = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      stream: true,
    };

    // Add tools when actions are enabled
    if (enableActions !== false) {
      body.tools = TOOLS;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI request failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/ai-chat")({
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
