import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";
import { apiCors, apiJson, authenticateApiKey } from "@/lib/api-keys.server";
import {
  applyCustomFields,
  logApiActivity,
  projectInputSchema,
  resolveOwner,
  toProjectRow,
} from "@/lib/crm-projects.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findProject(tenantId: string, idOrExternal: string) {
  const admin = adminClient();
  const query = admin.from("projects").select("*").eq("tenant_id", tenantId);
  const { data } = UUID.test(idOrExternal)
    ? await query.eq("id", idOrExternal).maybeSingle()
    : await query.eq("external_id", idOrExternal).maybeSingle();
  return data as Record<string, unknown> | null;
}

async function GET({ request, params }: { request: Request; params: { id: string } }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return apiJson({ error: "Invalid API key" }, 401);

  const project = await findProject(auth.tenantId, params.id);
  if (!project) return apiJson({ error: "Not found" }, 404);

  const admin = adminClient();
  const { data: items } = await admin
    .from("checklist_items")
    .select("completed")
    .eq("project_id", project["id"] as string)
    .eq("is_task", false);
  const list = (items || []) as Array<{ completed: boolean | null }>;

  return apiJson({
    id: project["id"],
    merchant_name: project["merchant_name"],
    mid: project["mid"],
    external_id: project["external_id"],
    project_state: project["project_state"],
    go_live_percent: project["go_live_percent"],
    arr: project["arr"],
    kick_off_date: project["kick_off_date"],
    expected_go_live_date: project["expected_go_live_date"],
    go_live_date: project["go_live_date"],
    checklist: { total: list.length, completed: list.filter((i) => i.completed).length },
    updated_at: project["updated_at"],
  });
}

async function PATCH({ request, params }: { request: Request; params: { id: string } }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return apiJson({ error: "Invalid API key" }, 401);

  const project = await findProject(auth.tenantId, params.id);
  if (!project) return apiJson({ error: "Not found" }, 404);

  const parsed = projectInputSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiJson(
      { error: "Validation failed", fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      400,
    );
  }
  const input = parsed.data;
  const ownerId = await resolveOwner(auth.tenantId, input.owner_email);
  const row = toProjectRow(input as never, ownerId);

  if (Object.keys(row).length > 0) {
    const { error } = await adminClient()
      .from("projects")
      .update(row)
      .eq("id", project["id"] as string);
    if (error) return apiJson({ error: error.message }, 500);
  }
  await applyCustomFields(auth.tenantId, project["id"] as string, input.custom_fields);
  await logApiActivity(auth.tenantId, `CRM updated project ${project["merchant_name"]}`, {
    project_id: project["id"],
  });

  return apiJson({ id: project["id"], updated: true });
}

export const Route = createFileRoute("/api/public/v1/projects/$id")({
  server: {
    handlers: {
      GET,
      PATCH,
      OPTIONS: async () => new Response(null, { headers: apiCors }),
    },
  },
});
