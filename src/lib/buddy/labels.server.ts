import type { BuddyCaller } from "@/lib/buddy/scope.server";
import { PHASE_LABELS, RESPONSIBILITY_LABELS, STATE_LABELS } from "@/lib/buddy/scope.server";
import { getTenantBranding } from "@/lib/tenant-branding.server";
import { teamNameMap } from "@/lib/buddy/setup-read.server";
import { DEFAULT_LABELS } from "@/data/defaultLabels";

/**
 * What this workspace calls things, for everything Buddy shows or says.
 *
 * The built-in names (Merchant, Merchant Success, Internal team) are only the
 * defaults; a workspace can rename any of them, and Buddy repeats whatever it
 * reads here. Stored values are untouched — this is display only.
 */
export interface BuddyLabels {
  merchant: string;
  merchantPlural: string;
  state: Record<string, string>;
  phase: Record<string, string>;
  responsibility: Record<string, string>;
  team: Record<string, string>;
  label: (key: string) => string;
}

export async function buddyLabels(caller: BuddyCaller): Promise<BuddyLabels> {
  const [branding, teams] = await Promise.all([
    getTenantBranding(caller.tenantId),
    teamNameMap(caller).catch(() => ({}) as Record<string, string>),
  ]);
  const phase: Record<string, string> = {
    ...PHASE_LABELS,
    mint: teams.mint || branding.label("phase_mint") || PHASE_LABELS.mint,
    integration: teams.integration || branding.label("phase_integration") || PHASE_LABELS.integration,
    ms: teams.ms || branding.label("phase_ms") || PHASE_LABELS.ms,
  };
  const state: Record<string, string> = { ...STATE_LABELS };
  for (const [key, value] of Object.entries({
    not_started: "state_not_started",
    on_hold: "state_on_hold",
    in_progress: "state_in_progress",
    live: "state_live",
    blocked: "state_blocked",
  })) {
    const resolved = branding.label(value);
    if (resolved && resolved !== DEFAULT_LABELS[value]) state[key] = resolved;
  }
  return {
    merchant: branding.merchantLabel,
    merchantPlural: branding.merchantPluralLabel,
    state,
    phase,
    responsibility: {
      ...RESPONSIBILITY_LABELS,
      gokwik: branding.internalLabel,
      merchant: branding.externalLabel,
      neutral: branding.label("responsibility_neutral"),
    },
    team: { ...phase, ...teams },
    label: branding.label,
  };
}
