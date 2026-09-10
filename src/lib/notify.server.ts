import { adminClient } from "@/lib/tenant-integrations.server";

/**
 * Send the project-assignment email from a server route.
 *
 * Assignment emails were only ever sent by the two client dialogs, so assigning
 * through the assistant or a workflow changed the row and told nobody. This
 * calls the same endpoint those dialogs use rather than restating the template,
 * so all three send an identical email.
 *
 * Never throws: an assignment that succeeded must not be reported as failed
 * because the mail did not go.
 */
export async function notifyAssignment(
  req: Request,
  opts: {
    tenantId: string | null;
    projectId: string;
    ownerId: string;
    assignedBy?: string;
  },
): Promise<void> {
  try {
    const supabase = adminClient();
    const [{ data: owner }, { data: project }] = await Promise.all([
      supabase.from("profiles").select("name, email").eq("id", opts.ownerId).maybeSingle(),
      supabase.from("projects").select("merchant_name").eq("id", opts.projectId).maybeSingle(),
    ]);

    const email = (owner as { email?: string } | null)?.email;
    if (!email) return;

    const origin = new URL(req.url).origin;
    const auth = req.headers.get("authorization");
    const cron = req.headers.get("x-cron-token");

    await fetch(`${origin}/api/public/send-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Pass the caller's own credentials through: the endpoint accepts a
        // signed-in user or the scheduler, and this is acting for one of them.
        ...(auth ? { Authorization: auth } : {}),
        ...(cron ? { "x-cron-token": cron } : {}),
      },
      body: JSON.stringify({
        type: "project_assignment",
        tenantId: opts.tenantId,
        recipientEmail: email,
        recipientName: (owner as { name?: string } | null)?.name || "there",
        projectName: (project as { merchant_name?: string } | null)?.merchant_name || "a project",
        assignedBy: opts.assignedBy,
        projectId: opts.projectId,
      }),
    });
  } catch (err) {
    console.error("notifyAssignment failed:", (err as Error).message);
  }
}
