import { z } from "zod";
import { adminClient } from "@/lib/tenant-integrations.server";

export const projectInputSchema = z.object({
  merchant_name: z.string().min(1).max(200),
  external_id: z.string().min(1).max(120).optional(),
  mid: z.string().min(1).max(80).optional(),
  contact_email: z.string().email().optional(),
  brand_url: z.string().max(400).optional(),
  platform: z.string().max(80).optional(),
  category: z.string().max(80).optional(),
  arr: z.number().nonnegative().optional(),
  aov: z.number().nonnegative().optional(),
  txns_per_day: z.number().int().nonnegative().optional(),
  kick_off_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected_go_live_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sales_spoc: z.string().max(160).optional(),
  owner_email: z.string().email().optional(),
  integration_type: z.string().max(80).optional(),
  project_notes: z.string().max(5000).optional(),
  custom_fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  allow_duplicate: z.boolean().optional(),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;

export function slugMid(name: string) {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "PROJ";
  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function resolveOwner(tenantId: string, email?: string) {
  if (!email) return null;
  const { data } = await adminClient()
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("email", email)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export function toProjectRow(input: ProjectInput, ownerId: string | null) {
  const row: Record<string, unknown> = {};
  const map: Array<[keyof ProjectInput, string]> = [
    ["merchant_name", "merchant_name"],
    ["external_id", "external_id"],
    ["contact_email", "contact_email"],
    ["brand_url", "brand_url"],
    ["platform", "platform"],
    ["category", "category"],
    ["arr", "arr"],
    ["aov", "aov"],
    ["txns_per_day", "txns_per_day"],
    ["kick_off_date", "kick_off_date"],
    ["expected_go_live_date", "expected_go_live_date"],
    ["sales_spoc", "sales_spoc"],
    ["integration_type", "integration_type"],
    ["project_notes", "project_notes"],
    ["mid", "mid"],
  ];
  for (const [from, to] of map) {
    const value = input[from];
    if (value !== undefined) row[to] = value;
  }
  if (ownerId) row["assigned_owner"] = ownerId;
  return row;
}

export async function applyCustomFields(
  tenantId: string,
  projectId: string,
  fields?: Record<string, string | number | boolean>,
) {
  if (!fields || Object.keys(fields).length === 0) return;
  const admin = adminClient();
  const { data } = await admin
    .from("custom_fields")
    .select("id, field_key")
    .eq("tenant_id", tenantId);
  const defs = (data || []) as Array<{ id: string; field_key: string }>;
  for (const [key, value] of Object.entries(fields)) {
    const def = defs.find((d) => d.field_key === key);
    if (!def) continue;
    await admin
      .from("custom_field_values")
      .upsert(
        { project_id: projectId, field_id: def.id, tenant_id: tenantId, value: String(value) },
        { onConflict: "project_id,field_id" },
      );
  }
}

export async function logApiActivity(
  tenantId: string,
  description: string,
  metadata: Record<string, unknown>,
) {
  try {
    await adminClient().from("activity_logs").insert({
      tenant_id: tenantId,
      user_name: "CRM API",
      action_type: "api_request",
      category: "integration",
      description,
      status: "success",
      metadata,
    });
  } catch {
    /* logging must never break the request */
  }
}
