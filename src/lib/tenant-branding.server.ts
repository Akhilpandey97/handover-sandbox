import { adminClient } from "./tenant-integrations.server";
import { DEFAULT_LABELS } from "@/data/defaultLabels";

/**
 * Tenant naming for AI prompts.
 *
 * Prompts used to hardcode one tenant's brand — "GoKwik's merchant integration
 * team", "MINT notes" — so every tenant's assistant answered as that company,
 * and the merchant-facing portal assistant introduced itself as them to other
 * companies' customers. This resolves what each tenant actually calls itself
 * and its teams, so the prompt can say it.
 *
 * Falls back to neutral wording rather than a brand: with no tenant resolved,
 * a generic prompt is wrong for nobody, where a branded one is wrong for
 * everyone but one.
 */
export interface TenantBranding {
  /** The tenant's own name, e.g. "Noveo". Neutral fallback when unknown. */
  orgName: string;
  /** Configured name for a team slug, e.g. "mint" → "Pre-Sales". */
  teamLabel: (slug: string | null | undefined) => string;
  /** What this tenant calls a customer record, e.g. "Brand". */
  merchantLabel: string;
  /** Its plural, for headings. */
  merchantPluralLabel: string;
  /** The two sides of the work, e.g. "Our team" and "Brand". */
  internalLabel: string;
  externalLabel: string;
  /** Any workspace label by key, falling back to the product default. */
  label: (key: string) => string;
}

const NEUTRAL_ORG = "the onboarding team";

const FALLBACK: TenantBranding = {
  orgName: NEUTRAL_ORG,
  teamLabel: (slug) => (slug ? slug.replace(/_/g, " ") : "unassigned"),
  merchantLabel: DEFAULT_LABELS.field_merchant_name,
  merchantPluralLabel: DEFAULT_LABELS.field_merchant_name_plural,
  internalLabel: DEFAULT_LABELS.responsibility_internal,
  externalLabel: DEFAULT_LABELS.responsibility_external,
  label: (key) => DEFAULT_LABELS[key] || key,
};

/** Labels worth carrying into emails and AI prompts. */
const LABEL_KEYS = [
  "org_name",
  "app_title",
  "field_merchant_name",
  "field_merchant_name_plural",
  "field_mid",
  "field_arr",
  "field_assigned_owner",
  "field_expected_go_live_date",
  "field_project_state",
  "responsibility_internal",
  "responsibility_external",
];

const cache = new Map<string, { at: number; value: TenantBranding }>();
const TTL_MS = 60_000;

export async function getTenantBranding(
  tenantId: string | null | undefined,
): Promise<TenantBranding> {
  if (!tenantId) return FALLBACK;

  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  try {
    const supabase = adminClient();
    const [{ data: settings }, { data: teamRows }] = await Promise.all([
      supabase
        .from("app_settings")
        .select("key, value")
        .eq("tenant_id", tenantId)
        .in("key", LABEL_KEYS),
      supabase.from("teams").select("slug, name").eq("tenant_id", tenantId),
    ]);

    const byKey = new Map<string, string>(
      ((settings || []) as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]),
    );
    const labels = new Map<string, string>(
      ((teamRows || []) as Array<{ slug: string; name: string }>).map((t) => [t.slug, t.name]),
    );

    const label = (key: string) => (byKey.get(key) || "").trim() || DEFAULT_LABELS[key] || key;
    const value: TenantBranding = {
      orgName: (byKey.get("org_name") || "").trim() || NEUTRAL_ORG,
      teamLabel: (slug) => (slug && (labels.get(slug) || slug.replace(/_/g, " "))) || "unassigned",
      merchantLabel: label("field_merchant_name"),
      merchantPluralLabel: label("field_merchant_name_plural"),
      internalLabel: label("responsibility_internal"),
      externalLabel: label("responsibility_external"),
      label,
    };
    cache.set(tenantId, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error("getTenantBranding failed:", (err as Error).message);
    return FALLBACK;
  }
}

/** Tenant for a project, for endpoints that receive only a project id. */
export async function tenantIdForProject(projectId: string): Promise<string | null> {
  try {
    const { data } = await adminClient()
      .from("projects")
      .select("tenant_id")
      .eq("id", projectId)
      .maybeSingle();
    return (data as { tenant_id: string | null } | null)?.tenant_id ?? null;
  } catch {
    return null;
  }
}
