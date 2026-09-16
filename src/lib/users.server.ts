import { adminClient, getTenantIntegrations, resendFrom, resendReplyTo } from "@/lib/tenant-integrations.server";
import { appBaseUrl } from "@/lib/app-links.server";
import { getTenantBranding } from "@/lib/tenant-branding.server";

/**
 * Creating people and changing their roles, shared by Settings → Users
 * (create-user) and Buddy, so both write the same rows the same way.
 */

type Db = ReturnType<typeof adminClient>;

/** Roles are single-row per user (user_roles is read with .single()), so this never adds a second. */
async function writeRole(db: Db, userId: string, role: string, tenantId: string | null) {
  const { data: existing } = await db.from("user_roles").select("id").eq("user_id", userId).maybeSingle();
  if (existing) {
    const { error } = await db.from("user_roles").update({ role, tenant_id: tenantId }).eq("user_id", userId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("user_roles").insert({ user_id: userId, role, tenant_id: tenantId, created_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }
}

export async function createWorkspaceUser(opts: {
  email: string;
  password: string;
  name: string;
  role: string;
  tenantId: string | null;
}): Promise<{ id: string; email: string }> {
  const db = adminClient();
  const { data: created, error } = await db.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
    user_metadata: { name: opts.name, team: opts.role, tenant_id: opts.tenantId },
  });
  if (error || !created.user) throw new Error(error?.message || "Couldn't create the account.");

  const now = new Date().toISOString();
  const { error: profileError } = await db.from("profiles").upsert(
    { id: created.user.id, email: opts.email, name: opts.name, team: opts.role, tenant_id: opts.tenantId, created_at: now, updated_at: now },
    { onConflict: "id" },
  );
  // The auth trigger usually writes the profile too; a failure here is logged, not fatal.
  if (profileError) console.error("createWorkspaceUser profile:", profileError.message);
  await writeRole(db, created.user.id, opts.role, opts.tenantId);
  return { id: created.user.id, email: created.user.email || opts.email };
}

export async function setUserRole(userId: string, role: string, tenantId: string | null) {
  const db = adminClient();
  const { error } = await db.from("profiles").update({ team: role }).eq("id", userId);
  if (error) throw new Error(error.message);
  await writeRole(db, userId, role, tenantId);
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Email a new person a link to choose their own password, through the
 * workspace's Resend account. Returns false when email isn't set up, so the
 * caller can say so rather than failing the invite.
 */
export async function sendInviteEmail(opts: {
  req: Request;
  tenantId: string;
  email: string;
  name: string;
  invitedBy: string;
}): Promise<boolean> {
  const creds = await getTenantIntegrations(opts.tenantId);
  if (!creds.resend_api_key) return false;
  const db = adminClient();
  const base = appBaseUrl(creds) || new URL(opts.req.url).origin;
  const { data, error } = await db.auth.admin.generateLink({
    type: "recovery",
    email: opts.email,
    options: { redirectTo: `${base}/reset-password` },
  });
  const link = data?.properties?.action_link;
  if (error || !link) throw new Error(error?.message || "Couldn't create the invite link.");

  const { orgName } = await getTenantBranding(opts.tenantId);
  const html = `
    <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #1d3a5c; padding: 20px; border-radius: 12px 12px 0 0; color: #ffffff;">
        <h1 style="margin: 0; font-size: 20px;">You're invited to ${escape(orgName)}</h1>
      </div>
      <div style="background: #f7fafc; padding: 24px; border: 1px solid #d5e0e6; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="margin: 0 0 16px;">Hi <strong>${escape(opts.name)}</strong>,</p>
        <p style="margin: 0 0 16px;">${escape(opts.invitedBy)} added you to ${escape(orgName)}'s onboarding workspace. Choose a password to sign in.</p>
        <div style="margin: 24px 0; text-align: center;">
          <a href="${link}" style="display: inline-block; background: #24598a; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 600;">Set your password</a>
        </div>
        <p style="margin: 0; color: #546978; font-size: 13px;">The link can be used once. If it expires, use "Forgot password" on the sign-in page with ${escape(opts.email)}.</p>
      </div>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.resend_api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: resendFrom(creds, orgName),
      to: [opts.email],
      subject: `You're invited to ${orgName}`,
      html,
      ...resendReplyTo(creds),
    }),
  });
  if (!res.ok) throw new Error(`The email service rejected the invite (${res.status}).`);
  return true;
}
