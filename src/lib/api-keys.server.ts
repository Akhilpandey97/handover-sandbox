import { adminClient } from "@/lib/tenant-integrations.server";

export const KEY_PREFIX = "hk_live_";

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return (
    KEY_PREFIX +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export interface ApiKeyAuth {
  tenantId: string;
  keyId: string;
}

/**
 * Authenticate an inbound CRM request by its `Authorization: Bearer hk_live_…`
 * key. Returns null when the key is missing, unknown or revoked.
 */
export async function authenticateApiKey(req: Request): Promise<ApiKeyAuth | null> {
  const raw = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;

  const hash = await sha256Hex(raw);
  const admin = adminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, tenant_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  const row = data as { id: string; tenant_id: string; revoked_at: string | null } | null;
  if (!row || row.revoked_at) return null;

  void admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { tenantId: row.tenant_id, keyId: row.id };
}

export const apiCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

export const apiJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...apiCors, "Content-Type": "application/json" },
  });
