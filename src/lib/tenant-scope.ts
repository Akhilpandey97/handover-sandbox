/**
 * The workspace a screen should read.
 *
 * Screens used to read tables unfiltered and leave the tenant boundary to RLS.
 * RLS lets super admins through everywhere, so a super admin saw every
 * customer's data mixed together, silently. Filter explicitly instead:
 *
 *   supabase.from("projects").select("*").eq("tenant_id", tenantScope(currentUser?.tenantId))
 *
 * `currentUser.tenantId` is the person's own tenant, or the customer's during a
 * support session. With no tenant this returns an id that matches no row, so a
 * missing tenant shows nothing rather than everything.
 */
export const NO_TENANT = "00000000-0000-0000-0000-000000000000";

export const tenantScope = (tenantId: string | null | undefined): string => tenantId || NO_TENANT;
