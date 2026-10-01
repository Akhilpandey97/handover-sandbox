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
  const header = req.headers.get("authorization") || "";
  const raw = header.replace(/^Bearer\s+/i, "").trim();

  /**
   * A rejected key is almost always the integrator sending the wrong thing, and the
   * response can only say "Invalid API key" — so say more in the log: enough to tell a
   * missing header from a wrong key from a key meant for another environment, and never
   * enough to use. The prefix is the same 16 characters already stored in key_prefix.
   */
  const explain = (reason: string) =>
    console.warn(
      `[api-key] ${reason}`,
      JSON.stringify({
        host: req.headers.get("host"),
        forwarded_host: req.headers.get("x-forwarded-host"),
        auth_header: header ? `${header.slice(0, 13)}… (${header.length} chars)` : "(absent)",
        key_prefix: raw.startsWith(KEY_PREFIX) ? raw.slice(0, 16) : null,
        key_length: raw.length || 0,
      }),
    );

  if (!raw || !raw.startsWith(KEY_PREFIX)) {
    explain(raw ? "rejected: not an hk_live_ key" : "rejected: no Authorization header");
    return null;
  }

  const hash = await sha256Hex(raw);
  const admin = adminClient();
  const { data } = await admin
    .from("api_keys")
    .select("id, tenant_id, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  const row = data as { id: string; tenant_id: string; revoked_at: string | null } | null;
  if (!row) {
    explain("rejected: no key with that hash in this database");
    return null;
  }
  if (row.revoked_at) {
    explain("rejected: key revoked");
    return null;
  }

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
