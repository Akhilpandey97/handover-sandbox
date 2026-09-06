import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";
import { apiCors, apiJson, authenticateApiKey } from "@/lib/api-keys.server";
import {
  applyCustomFields,
  logApiActivity,
  projectInputSchema,
  resolveOwner,
  slugMid,
  toProjectRow,
} from "@/lib/crm-projects.server";

const baseUrl = (req: Request) => new URL(req.url).origin;

async function GET({ request }: { request: Request }): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if (!auth) return apiJson({ error: "Invalid API key" }, 401);

  const url = new URL(request.url);
  const updatedSince = url.searchParams.get("updated_since");
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);

  let query = adminClient()
    .from("projects")
    .select(
      "id, merchant_name, mid, external_id, project_state, go_live_percent, arr, kick_off_date, expected_go_live_date, go_live_date, updated_at",
    )
    .eq("tenant_id", auth.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (updatedSince) query = query.gte("updated_at", updatedSince);

  const { data, error } = await query;
  if (error) return apiJson({ error: error.message }, 500);
  return apiJson({ projects: data || [] });
}

async function POST({ request }: { request: Request }): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if (!auth) return apiJson({ error: "Invalid API key" }, 401);

  const parsed = projectInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiJson(
      { error: "Validation failed", fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      400,
    );
  }
  const input = parsed.data;
  const admin = adminClient();
  const ownerId = await resolveOwner(auth.tenantId, input.owner_email);

  // Idempotency on external_id
  if (input.external_id) {
    const { data: existing } = await admin
      .from("projects")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("external_id", input.external_id)
      .maybeSingle();
    const found = existing as { id: string } | null;
    if (found) {
      const { error } = await admin
        .from("projects")
        .update(toProjectRow(input, ownerId))
        .eq("id", found.id);
      if (error) return apiJson({ error: error.message }, 500);
      await applyCustomFields(auth.tenantId, found.id, input.custom_fields);
      await logApiActivity(auth.tenantId, `CRM updated project ${input.merchant_name}`, {
        project_id: found.id,
        external_id: input.external_id,
      });
      return apiJson({
        id: found.id,
        merchant_name: input.merchant_name,
        external_id: input.external_id,
        project_url: `${baseUrl(request)}/projects/${found.id}`,
        created: false,
      });
    }
  }

  if (!input.allow_duplicate) {
    const { data: dupe } = await admin
      .from("projects")
      .select("id, external_id")
      .eq("tenant_id", auth.tenantId)
      .ilike("merchant_name", input.merchant_name)
      .maybeSingle();
    if (dupe) {
      return apiJson(
        { error: "A project with this merchant_name already exists", project_id: (dupe as { id: string }).id },
        409,
      );
    }
  }

  const row = {
    ...toProjectRow(input, ownerId),
    tenant_id: auth.tenantId,
    mid: input.mid || slugMid(input.merchant_name),
    kick_off_date: input.kick_off_date || new Date().toISOString().slice(0, 10),
    project_state: "not_started",
    current_phase: "mint",
    current_owner_team: "mint",
  };

  const { data: created, error } = await admin.from("projects").insert(row).select("id, mid").single();
  if (error) return apiJson({ error: error.message }, 500);
  const project = created as { id: string; mid: string };

  await applyCustomFields(auth.tenantId, project.id, input.custom_fields);

  const { count } = await admin
    .from("checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  await logApiActivity(auth.tenantId, `CRM created project ${input.merchant_name}`, {
    project_id: project.id,
    external_id: input.external_id ?? null,
  });

  return apiJson(
    {
      id: project.id,
      merchant_name: input.merchant_name,
      mid: project.mid,
      external_id: input.external_id ?? null,
      project_url: `${baseUrl(request)}/projects/${project.id}`,
      checklist_items_created: count ?? 0,
      created: true,
    },
    201,
  );
}

export const Route = createFileRoute("/api/public/v1/projects")({
  server: {
    handlers: {
      GET,
      POST,
      OPTIONS: async () => new Response(null, { headers: apiCors }),
    },
  },
});
