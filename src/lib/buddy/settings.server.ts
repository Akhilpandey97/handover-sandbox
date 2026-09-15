import type { BuddyCaller } from "@/lib/buddy/scope.server";
import { DEFAULT_BULK_LIMIT } from "@/lib/buddy/actions.server";

/**
 * Per-workspace Buddy settings, stored in app_settings under one key so they
 * travel with the rest of the workspace's configuration.
 */
export const BUDDY_SETTINGS_KEY = "buddy_settings";

export interface BuddySettings {
  /** Action names Buddy must not offer or run in this workspace. */
  disabled_actions: string[];
  /** Largest bulk change allowed without typing the count to confirm. */
  bulk_limit: number;
  /** Extra guidance an admin gives Buddy: tone, terminology, house rules. */
  instructions: string;
  /** Show the daily brief to everyone by default. */
  brief_enabled: boolean;
}

export const DEFAULT_BUDDY_SETTINGS: BuddySettings = {
  disabled_actions: [],
  bulk_limit: DEFAULT_BULK_LIMIT,
  instructions: "",
  brief_enabled: true,
};

export function parseBuddySettings(raw: unknown): BuddySettings {
  let value: any = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = {};
    }
  }
  const v = value && typeof value === "object" ? value : {};
  const limit = Number(v.bulk_limit);
  return {
    disabled_actions: Array.isArray(v.disabled_actions) ? v.disabled_actions.map(String) : [],
    bulk_limit: Number.isFinite(limit) && limit >= 1 ? Math.min(Math.round(limit), 500) : DEFAULT_BULK_LIMIT,
    instructions: typeof v.instructions === "string" ? v.instructions.slice(0, 2000) : "",
    brief_enabled: v.brief_enabled !== false,
  };
}

export async function loadBuddySettings(caller: BuddyCaller): Promise<BuddySettings> {
  const { data } = await caller.client
    .from("app_settings")
    .select("value")
    .eq("tenant_id", caller.tenantId)
    .eq("key", BUDDY_SETTINGS_KEY)
    .maybeSingle();
  return parseBuddySettings((data as { value?: string } | null)?.value);
}
