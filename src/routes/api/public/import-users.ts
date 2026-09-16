import { createFileRoute } from "@tanstack/react-router";
import { adminClient } from "@/lib/tenant-integrations.server";
import { bearerToken, resolveUserScope } from "@/lib/api-auth.server";
import { createWorkspaceUser, sendInviteEmail } from "@/lib/users.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Bulk import from Settings → Users: a spreadsheet of name, email, role and an
 * optional password.
 *
 * People join the workspace being worked in (the customer's during a support
 * session). Anyone without a password gets an email to set their own. Each row
 * succeeds or fails on its own, and the reply says which.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 200;
const SYSTEM_TEAMS = ["mint", "integration", "ms"];

interface Person {
  name?: string;
  email?: string;
  role?: string;
  password?: string;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const token = bearerToken(req);
  if (!token) return json({ error: "Sign in again." }, 401);
  const db = adminClient();
  const { data: auth } = await db.auth.getUser(token);
  const requester = auth.user;
  if (!requester) return json({ error: "Sign in again." }, 401);

  const scope = await resolveUserScope(db as any, requester.id);
  const isSuperAdmin = scope.roles.includes("super_admin");
  if (!scope.roles.some((r) => r === "admin" || r === "super_admin")) return json({ error: "Only workspace admins can import users." }, 403);
  if (!scope.tenantId) return json({ error: "No workspace to add people to." }, 400);
  const tenantId = scope.tenantId;

  const body = (await req.json().catch(() => ({}))) as { people?: Person[] };
  const people = Array.isArray(body.people) ? body.people : [];
  if (people.length === 0) return json({ error: "The file has no people to import." }, 400);
  if (people.length > MAX_ROWS) return json({ error: `Import up to ${MAX_ROWS} people at a time.` }, 400);

  const [{ data: teams }, { data: requesterProfile }] = await Promise.all([
    db.from("teams").select("slug").eq("tenant_id", tenantId),
    db.from("profiles").select("name").eq("id", requester.id).maybeSingle(),
  ]);
  const roles = new Set(["admin", "manager", ...SYSTEM_TEAMS, ...((teams || []) as { slug: string }[]).map((t) => t.slug)]);
  if (isSuperAdmin) roles.add("super_admin");
  const invitedBy = (requesterProfile as { name?: string } | null)?.name || requester.email || "An admin";

  const emails = people.map((p) => String(p.email || "").trim().toLowerCase()).filter(Boolean);
  const { data: existing } = await db.from("profiles").select("email").in("email", emails);
  const taken = new Set(((existing || []) as { email: string }[]).map((e) => e.email.toLowerCase()));

  const results: { row: number; email: string; status: "created" | "skipped" | "failed"; detail: string }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const name = String(p.name || "").trim();
    const email = String(p.email || "").trim().toLowerCase();
    const role = String(p.role || "").trim();
    const password = String(p.password || "");
    const row = i + 1;
    const fail = (status: "skipped" | "failed", detail: string) => results.push({ row, email, status, detail });

    if (!name) { fail("failed", "Name is missing"); continue; }
    if (!EMAIL_RE.test(email)) { fail("failed", "Email isn't valid"); continue; }
    if (seen.has(email)) { fail("skipped", "Listed twice in the file"); continue; }
    seen.add(email);
    if (taken.has(email)) { fail("skipped", "Already has an account"); continue; }
    if (!roles.has(role)) { fail("failed", `Role "${role || "blank"}" isn't one of this workspace's roles`); continue; }
    if (password && password.length < 6) { fail("failed", "Password must be at least 6 characters"); continue; }

    try {
      await createWorkspaceUser({
        email,
        // Without a password in the file, nobody knows this one; the invite sets theirs.
        password: password || `${crypto.randomUUID()}${crypto.randomUUID()}`,
        name,
        role,
        tenantId,
      });
      let detail = password ? "Created with the password from the file" : "Created";
      if (!password) {
        try {
          detail = (await sendInviteEmail({ req, tenantId, email, name, invitedBy }))
            ? "Created, invite email sent"
            : "Created, but email isn't set up, so no invite was sent";
        } catch (err) {
          detail = `Created, but the invite email failed: ${(err as Error).message}`;
        }
      }
      results.push({ row, email, status: "created", detail });
    } catch (err) {
      fail("failed", (err as Error).message);
    }
  }

  await db.from("activity_logs").insert({
    tenant_id: tenantId,
    user_id: requester.id,
    user_name: invitedBy,
    action_type: "user",
    category: "users",
    description: `Imported users from a file: ${results.filter((r) => r.status === "created").length} created, ${results.filter((r) => r.status !== "created").length} not`,
    metadata: { results: results.map(({ row, email, status, detail }) => ({ row, email, status, detail })) },
    status: "success",
  } as never);

  return json({ results });
}

export const Route = createFileRoute("/api/public/import-users")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
