import { getTenantIntegrations } from "@/lib/tenant-integrations.server";
import { projectUrl } from "@/lib/app-links.server";
import {
  type ActionDef,
  fail,
  loadPerson,
  loadProject,
  plainTextToHtml,
  projectLink,
  sendResendEmail,
} from "@/lib/buddy/actions.server";
import type { BuddyCaller } from "@/lib/buddy/scope.server";
import { PHASE_LABELS } from "@/lib/buddy/scope.server";
import { teamNameMap } from "@/lib/buddy/setup-read.server";
import { buddyLabels } from "@/lib/buddy/labels.server";

/**
 * Buddy's second set of actions: checklist and tasks, transfers, archiving,
 * risks, meeting links, email and notifications. Registered into the same
 * registry as the core actions, so previews, server checks, logging and undo
 * all work the same way.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_ORDER: Record<string, string> = { mint: "integration", integration: "ms" };
const RISK_CATEGORIES: Record<string, string> = {
  merchant_dependency: "Merchant dependency",
  external_dependency: "External dependency",
  internal_dependency: "Internal dependency",
  project_viability: "Project viability",
};
const SEVERITIES: Record<string, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const PRIORITIES: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const PROVIDERS: Record<string, string> = { google_meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams" };

const cleanEmails = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\s]+/) : [])
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean);

const whenIst = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }) + " IST";

async function loadItem(c: BuddyCaller, id: string) {
  if (!id) fail("No checklist item was given.");
  const { data } = await c.client
    .from("checklist_items")
    .select("id, title, project_id, completed, completed_at, completed_by, due_date")
    .eq("tenant_id", c.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!data) fail("That checklist item isn't in this workspace.");
  const item = data as any;
  const project = await loadProject(c, item.project_id, "id, merchant_name");
  return { item, project };
}

/** Call one of the app's own API routes as the same signed-in user. */
async function callOwnRoute(req: Request, path: string, body: unknown) {
  const origin = new URL(req.url).origin;
  const auth = req.headers.get("authorization");
  const res = await fetch(`${origin}/api/public/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data: data as Record<string, any> };
}

const MORE: Record<string, ActionDef> = {
  complete_checklist_item: {
    label: "Update checklist item",
    async preview(c, p) {
      const { item, project } = await loadItem(c, p.item_id);
      const done = p.done !== false;
      return {
        action: "complete_checklist_item",
        title: done ? "Mark checklist item done" : "Reopen checklist item",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Item", after: item.title },
          { label: "Status", before: item.completed ? "Done" : "Open", after: done ? "Done" : "Open" },
        ],
        warnings: !!item.completed === done ? [`This item is already ${done ? "done" : "open"}.`] : undefined,
        undoable: true,
      };
    },
    async execute(c, p) {
      const { item, project } = await loadItem(c, p.item_id);
      const done = p.done !== false;
      const { error } = await c.client
        .from("checklist_items")
        .update({ completed: done, completed_by: done ? c.name : null, completed_at: done ? new Date().toISOString() : null })
        .eq("id", item.id)
        .eq("tenant_id", c.tenantId);
      if (error) throw error;
      return {
        message: `"${item.title}" is ${done ? "done" : "open again"} on ${project.merchant_name}.`,
        link: { label: "Open checklist", href: `/projects/${project.id}?item=${item.id}` },
        undo: {
          table: "checklist_items",
          op: "update",
          rows: [{ id: item.id, before: { completed: item.completed, completed_by: item.completed_by, completed_at: item.completed_at } }],
        },
        log: { description: `Buddy marked "${item.title}" ${done ? "done" : "open"} on ${project.merchant_name}`, category: "checklist", entityType: "project", entityId: project.id },
      };
    },
  },

  set_checklist_due_date: {
    label: "Change due date",
    async preview(c, p) {
      const { item, project } = await loadItem(c, p.item_id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.due_date || ""))) fail("The due date must be a date (YYYY-MM-DD).");
      return {
        action: "set_checklist_due_date",
        title: "Change due date",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Item", after: item.title },
          { label: "Due", before: item.due_date ? fmt(item.due_date) : "Not set", after: fmt(p.due_date) },
        ],
        undoable: true,
      };
    },
    async execute(c, p) {
      const { item, project } = await loadItem(c, p.item_id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.due_date || ""))) fail("The due date must be a date (YYYY-MM-DD).");
      const { error } = await c.client.from("checklist_items").update({ due_date: p.due_date }).eq("id", item.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
      return {
        message: `"${item.title}" is now due ${fmt(p.due_date)}.`,
        link: { label: "Open checklist", href: `/projects/${project.id}?item=${item.id}` },
        undo: { table: "checklist_items", op: "update", rows: [{ id: item.id, before: { due_date: item.due_date } }] },
        log: { description: `Buddy moved "${item.title}" on ${project.merchant_name} to ${fmt(p.due_date)}`, category: "checklist", entityType: "project", entityId: project.id },
      };
    },
  },

  add_task: {
    label: "Add task",
    async preview(c, p) {
      const { item, project } = await loadItem(c, p.checklist_item_id);
      if (!p.title) fail("The task needs a title.");
      const assignee = p.assignee_id ? await loadPerson(c, p.assignee_id) : null;
      const priority = PRIORITIES[p.priority] ? p.priority : "medium";
      return {
        action: "add_task",
        title: "Add task",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Task", after: String(p.title) },
          { label: "Under", after: item.title },
          { label: "Assigned to", after: assignee?.name || "Nobody yet" },
          { label: "Due", after: p.due_date ? fmt(p.due_date) : "No date" },
          { label: "Priority", after: PRIORITIES[priority]! },
          ...(p.description ? [{ label: "Details", after: String(p.description) }] : []),
        ],
        notes: assignee ? [`${assignee.name} gets a notification.`] : undefined,
        undoable: true,
      };
    },
    async execute(c, p) {
      const { item, project } = await loadItem(c, p.checklist_item_id);
      if (!p.title) fail("The task needs a title.");
      const assignee = p.assignee_id ? await loadPerson(c, p.assignee_id) : null;
      if (p.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.due_date))) fail("The due date must be a date (YYYY-MM-DD).");
      const { data, error } = await c.client
        .from("checklist_tasks")
        .insert({
          checklist_item_id: item.id,
          project_id: project.id,
          title: String(p.title),
          description: p.description || null,
          assigned_to: assignee?.id || null,
          due_date: p.due_date || null,
          priority: PRIORITIES[p.priority] ? p.priority : "medium",
          status: "open",
          created_by: c.name,
          tenant_id: c.tenantId,
        })
        .select("id")
        .single();
      if (error) throw error;
      const taskId = (data as { id: string }).id;
      if (assignee && assignee.id !== c.userId) {
        await c.client.from("notifications").insert({
          user_id: assignee.id,
          type: "task_assigned",
          title: `New task assigned: ${p.title}`,
          body: p.due_date ? `Due ${p.due_date}` : p.description || null,
          actor_name: c.name,
          project_id: project.id,
          project_name: project.merchant_name,
          checklist_item_id: item.id,
          checklist_item_title: item.title,
          task_id: taskId,
          tenant_id: c.tenantId,
        });
      }
      return {
        message: `Task "${p.title}" added to ${project.merchant_name}${assignee ? ` for ${assignee.name}` : ""}.`,
        link: { label: "Open task", href: `/projects/${project.id}?item=${item.id}&task=${taskId}` },
        undo: { table: "checklist_tasks", op: "delete", rows: [{ id: taskId }] },
        log: { description: `Buddy added task "${p.title}" on ${project.merchant_name}`, category: "task", entityType: "project", entityId: project.id },
      };
    },
  },

  transfer_project: {
    label: "Transfer to next team",
    async preview(c, p) {
      const project = await loadProject(c, p.project_id, "id, merchant_name, current_owner_team, assigned_owner");
      // The workspace's own team names, not the built-in ones.
      const TEAM_LABELS = await teamNameMap(c);
      const next = TEAM_ORDER[project.current_owner_team];
      if (!next) fail(`${project.merchant_name} is with ${TEAM_LABELS[project.current_owner_team] || project.current_owner_team}, which has no next team.`);
      const assignee = p.assignee_id ? await loadPerson(c, p.assignee_id) : null;
      return {
        action: "transfer_project",
        title: "Transfer to next team",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Team", before: TEAM_LABELS[project.current_owner_team] || project.current_owner_team, after: TEAM_LABELS[next!] || next! },
          { label: "Owner", after: assignee?.name || "Picked by the receiving team" },
          ...(p.notes ? [{ label: "Notes", after: String(p.notes) }] : []),
        ],
        notes: [
          "The receiving team accepts or returns it.",
          ...(assignee ? [`${assignee.name} gets an email and a notification.`] : []),
        ],
        undoable: false,
      };
    },
    async execute(c, p, ctx) {
      const project = await loadProject(c, p.project_id, "id, merchant_name, current_owner_team");
      const TEAM_LABELS = await teamNameMap(c);
      const next = TEAM_ORDER[project.current_owner_team];
      if (!next) fail(`${project.merchant_name} has no next team to transfer to.`);
      const assignee = p.assignee_id ? await loadPerson(c, p.assignee_id) : null;
      const { error } = await c.client
        .from("projects")
        .update({ current_owner_team: next, current_phase: next, pending_acceptance: true, assigned_owner: assignee?.id || null })
        .eq("id", project.id)
        .eq("tenant_id", c.tenantId);
      if (error) throw error;
      const { error: tErr } = await c.client.from("transfer_history").insert({
        project_id: project.id,
        from_team: project.current_owner_team,
        to_team: next,
        transferred_by: c.name,
        notes: p.notes || null,
        tenant_id: c.tenantId,
      });
      if (tErr) throw tErr;
      if (assignee) {
        await c.client.from("notifications").insert({
          user_id: assignee.id,
          type: "project_transfer",
          title: `Project transferred to you: ${project.merchant_name}`,
          body: p.notes || `From ${TEAM_LABELS[project.current_owner_team]} to ${TEAM_LABELS[next!]}`,
          actor_name: c.name,
          project_id: project.id,
          project_name: project.merchant_name,
          tenant_id: c.tenantId,
        });
        await callOwnRoute(ctx.req, "send-notification", {
          type: "project_transfer",
          tenantId: c.tenantId,
          recipientEmail: assignee.email,
          recipientName: assignee.name,
          projectName: project.merchant_name,
          fromTeam: TEAM_LABELS[project.current_owner_team],
          toTeam: TEAM_LABELS[next!],
          notes: p.notes || undefined,
          projectId: project.id,
        }).catch(() => undefined);
      }
      return {
        message: `${project.merchant_name} is transferred to ${TEAM_LABELS[next!]} and waiting for them to accept.`,
        link: projectLink(project.id),
        log: { description: `Buddy transferred ${project.merchant_name} to ${TEAM_LABELS[next!]}`, category: "project", entityType: "project", entityId: project.id },
      };
    },
  },

  archive_project: {
    label: "Archive project",
    async preview(c, p) {
      const project = await loadProject(c, p.project_id, "id, merchant_name, archived");
      const archive = p.archive !== false;
      return {
        action: "archive_project",
        title: archive ? "Archive project" : "Restore project",
        target: { id: project.id, label: project.merchant_name },
        rows: [{ label: "Status", before: project.archived ? "Archived" : "Active", after: archive ? "Archived" : "Active" }],
        notes: archive ? ["Archived projects leave dashboards and lists. You can restore them from Archived."] : undefined,
        undoable: true,
      };
    },
    async execute(c, p) {
      const project = await loadProject(c, p.project_id, "id, merchant_name, archived, archived_at");
      const archive = p.archive !== false;
      const { error } = await c.client
        .from("projects")
        .update({ archived: archive, archived_at: archive ? new Date().toISOString() : null })
        .eq("id", project.id)
        .eq("tenant_id", c.tenantId);
      if (error) throw error;
      return {
        message: `${project.merchant_name} is ${archive ? "archived" : "restored"}.`,
        link: archive ? { label: "Open archived projects", href: "/archived" } : projectLink(project.id),
        undo: { table: "projects", op: "update", rows: [{ id: project.id, before: { archived: project.archived, archived_at: project.archived_at } }] },
        log: { description: `Buddy ${archive ? "archived" : "restored"} ${project.merchant_name}`, category: "project", entityType: "project", entityId: project.id },
      };
    },
  },

  flag_risk: {
    label: "Flag a risk",
    async preview(c, p) {
      const project = await loadProject(c, p.project_id, "id, merchant_name");
      if (!p.title) fail("The risk needs a title.");
      if (!SEVERITIES[p.severity]) fail("Severity must be low, medium, high or critical.");
      const category = RISK_CATEGORIES[p.category] ? p.category : "merchant_dependency";
      const assignee = p.assignee_id ? await loadPerson(c, p.assignee_id) : null;
      return {
        action: "flag_risk",
        title: "Flag a risk",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Risk", after: String(p.title) },
          { label: "Severity", after: SEVERITIES[p.severity]! },
          { label: "Category", after: RISK_CATEGORIES[category]! },
          ...(p.description ? [{ label: "Details", after: String(p.description) }] : []),
          ...(p.mitigation_plan ? [{ label: "Mitigation", after: String(p.mitigation_plan) }] : []),
          ...(assignee ? [{ label: "Owner", after: assignee.name }] : []),
        ],
        notes: ["Mitigation is due in 24 hours, as with risks added on the Risks page."],
        undoable: true,
      };
    },
    async execute(c, p) {
      const project = await loadProject(c, p.project_id, "id, merchant_name");
      if (!p.title) fail("The risk needs a title.");
      if (!SEVERITIES[p.severity]) fail("Severity must be low, medium, high or critical.");
      const assignee = p.assignee_id ? await loadPerson(c, p.assignee_id) : null;
      const { data, error } = await c.client
        .from("project_risks")
        .insert({
          project_id: project.id,
          title: String(p.title),
          description: p.description || null,
          category: RISK_CATEGORIES[p.category] ? p.category : "merchant_dependency",
          severity: p.severity,
          trigger_type: "manual",
          trigger_rule: null,
          mitigation_plan: p.mitigation_plan || null,
          mitigation_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          assigned_to: assignee?.id || null,
          status: "open",
          escalated: false,
          resolved_at: null,
          created_by: c.name,
          tenant_id: c.tenantId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return {
        message: `Risk "${p.title}" flagged on ${project.merchant_name}.`,
        link: { label: "Open risks", href: "/risks" },
        undo: { table: "project_risks", op: "delete", rows: [{ id: (data as { id: string }).id }] },
        log: { description: `Buddy flagged a ${p.severity} risk "${p.title}" on ${project.merchant_name}`, category: "risk", entityType: "project", entityId: project.id },
      };
    },
  },

  create_meeting_link: {
    label: "Create meeting link",
    async preview(c, p) {
      validateMeeting(p);
      const attendees = cleanEmails(p.attendees);
      let target: { id: string; label: string } | undefined;
      let itemTitle: string | null = null;
      if (p.checklist_item_id) {
        const { item, project } = await loadItem(c, p.checklist_item_id);
        target = { id: project.id, label: project.merchant_name };
        itemTitle = item.title;
      } else if (p.project_id) {
        const project = await loadProject(c, p.project_id, "id, merchant_name");
        target = { id: project.id, label: project.merchant_name };
      }
      const creds = await getTenantIntegrations(c.tenantId);
      const configured =
        p.provider === "zoom"
          ? !!(creds.zoom_account_id && creds.zoom_client_id && creds.zoom_client_secret)
          : p.provider === "teams"
            ? !!(creds.teams_tenant_id && creds.teams_client_id && creds.teams_client_secret)
            : !!(creds.google_oauth_client_id && creds.google_oauth_client_secret && (creds.google_calendar_refresh_token || creds.google_meet_refresh_token));
      const invite = p.send_invite !== false && attendees.length > 0 && !!itemTitle;
      return {
        action: "create_meeting_link",
        title: `Create ${PROVIDERS[p.provider]} link`,
        target,
        rows: [
          { label: "Title", after: String(p.title) },
          { label: "When", after: whenIst(p.scheduled_at) },
          { label: "Length", after: `${Number(p.duration_minutes) || 30} min` },
          { label: "Attendees", after: attendees.length ? attendees.join(", ") : "None" },
          ...(itemTitle ? [{ label: "Saved to", after: itemTitle }] : []),
          ...(p.agenda ? [{ label: "Agenda", after: String(p.agenda) }] : []),
        ],
        notes: [
          invite
            ? "The meeting is saved to the checklist item and attendees get a calendar invite by email."
            : itemTitle
              ? "The meeting is saved to the checklist item. No invite is sent."
              : "Buddy creates the link and shows it here. Name a checklist item to save the meeting and send invites.",
        ],
        warnings: configured ? undefined : [`${PROVIDERS[p.provider]} isn't set up for this workspace. An admin can add it under Settings → Integrations.`],
        undoable: false,
      };
    },
    async execute(c, p, ctx) {
      validateMeeting(p);
      const attendees = cleanEmails(p.attendees);
      const duration = Number(p.duration_minutes) || 30;
      const linkRes = await callOwnRoute(ctx.req, "create-meeting-link", {
        provider: p.provider,
        title: String(p.title),
        agenda: p.agenda || undefined,
        scheduled_at: new Date(p.scheduled_at).toISOString(),
        duration_minutes: duration,
        attendees,
      });
      if (!linkRes.ok || !linkRes.data.join_url) fail(linkRes.data.error || `Couldn't create the ${PROVIDERS[p.provider]} link.`);
      const joinUrl = String(linkRes.data.join_url);

      let saved = "";
      let projectId: string | undefined = p.project_id;
      if (p.checklist_item_id) {
        const { item, project } = await loadItem(c, p.checklist_item_id);
        projectId = project.id;
        const { data: meeting, error } = await c.client
          .from("checklist_meetings")
          .insert({
            checklist_item_id: item.id,
            project_id: project.id,
            title: String(p.title),
            agenda: p.agenda || null,
            provider: p.provider,
            join_url: joinUrl,
            provider_meeting_id: linkRes.data.provider_meeting_id || null,
            scheduled_at: new Date(p.scheduled_at).toISOString(),
            duration_minutes: duration,
            attendees,
            created_by: c.userId,
            created_by_name: c.name,
            tenant_id: c.tenantId,
          })
          .select("id")
          .single();
        if (error) throw error;
        saved = ` Saved to "${item.title}".`;
        if (p.send_invite !== false && attendees.length > 0) {
          const inviteRes = await callOwnRoute(ctx.req, "send-meeting-invite", {
            meeting_id: (meeting as { id: string }).id,
            project_name: project.merchant_name,
            checklist_item_title: item.title,
          });
          saved += inviteRes.ok ? " Invites sent." : ` The invite didn't send: ${inviteRes.data.error || "unknown error"}.`;
        }
      }

      return {
        message: `${PROVIDERS[p.provider]} link ready for ${whenIst(p.scheduled_at)}: ${joinUrl}.${saved}`,
        link: { label: "Open meeting link", href: joinUrl },
        log: {
          description: `Buddy created a ${PROVIDERS[p.provider]} link "${p.title}" for ${whenIst(p.scheduled_at)}`,
          category: "meeting",
          entityType: projectId ? "project" : "meeting",
          entityId: projectId || joinUrl,
        },
      };
    },
  },

  send_email: {
    label: "Send email",
    async preview(c, p) {
      const { to, cc } = validateEmail(p);
      const project = p.project_id ? await loadProject(c, p.project_id, "id, merchant_name") : null;
      const creds = await getTenantIntegrations(c.tenantId);
      return {
        action: "send_email",
        title: "Send email",
        target: project ? { id: project.id, label: project.merchant_name } : undefined,
        rows: [],
        email: { to, cc, subject: String(p.subject), body: String(p.body) },
        notes: project ? ["A copy is added to the project's notes timeline."] : undefined,
        warnings: creds.resend_api_key ? undefined : ["Email isn't set up for this workspace. An admin can add Resend under Settings → Integrations."],
        undoable: false,
      };
    },
    async execute(c, p) {
      const { to, cc } = validateEmail(p);
      const project = p.project_id ? await loadProject(c, p.project_id, "id, merchant_name") : null;
      await sendResendEmail(c, { to, cc, subject: String(p.subject), html: plainTextToHtml(String(p.body)), fromName: c.name });
      if (project) {
        await c.client.from("project_comment_logs").insert({
          project_id: project.id,
          author_name: `Buddy (for ${c.name})`,
          author_type: "ai",
          field_name: "email",
          content: `Email to ${to.join(", ")}: ${p.subject}\n\n${String(p.body).slice(0, 4000)}`,
          tenant_id: c.tenantId,
        });
      }
      return {
        message: `Email "${p.subject}" sent to ${to.join(", ")}.`,
        link: project ? projectLink(project.id) : undefined,
        log: {
          description: `Buddy sent an email "${p.subject}" to ${to.join(", ")}${project ? ` about ${project.merchant_name}` : ""}`,
          category: "email",
          entityType: project ? "project" : "email",
          entityId: project?.id || to.join(","),
        },
      };
    },
  },

  send_notification: {
    label: "Send notification",
    async preview(c, p) {
      const people = await loadPeople(c, p.user_ids);
      if (!p.title) fail("The notification needs a message.");
      const project = p.project_id ? await loadProject(c, p.project_id, "id, merchant_name") : null;
      return {
        action: "send_notification",
        title: "Send notification",
        target: project ? { id: project.id, label: project.merchant_name } : undefined,
        rows: [
          { label: "To", after: people.map((x) => x.name).join(", ") },
          { label: "Message", after: String(p.title) },
          ...(p.body ? [{ label: "Details", after: String(p.body) }] : []),
        ],
        notes: [p.also_email ? "Shows in their notification bell, and they get an email." : "Shows in their notification bell."],
        undoable: false,
      };
    },
    async execute(c, p) {
      const people = await loadPeople(c, p.user_ids);
      if (!p.title) fail("The notification needs a message.");
      const project = p.project_id ? await loadProject(c, p.project_id, "id, merchant_name") : null;
      const { error } = await c.client.from("notifications").insert(
        people.map((person) => ({
          user_id: person.id,
          type: "buddy",
          title: String(p.title),
          body: p.body || null,
          actor_name: c.name,
          project_id: project?.id || null,
          project_name: project?.merchant_name || null,
          tenant_id: c.tenantId,
        })),
      );
      if (error) throw error;
      let emailNote = "";
      if (p.also_email) {
        const creds = await getTenantIntegrations(c.tenantId);
        const link = project ? projectUrl(creds, project.id) : null;
        const recipients = people.map((x) => x.email).filter((e) => EMAIL_RE.test(e || ""));
        if (recipients.length) {
          await sendResendEmail(c, {
            to: recipients,
            subject: project ? `${p.title} · ${project.merchant_name}` : String(p.title),
            html: plainTextToHtml(`${p.body ? `${p.body}\n\n` : ""}${link ? `Open the project: ${link}\n\n` : ""}From ${c.name}, via Handover`),
            fromName: c.name,
          });
          emailNote = " They also got an email.";
        }
      }
      return {
        message: `Notified ${people.map((x) => x.name).join(", ")}.${emailNote}`,
        link: project ? projectLink(project.id) : undefined,
        log: {
          description: `Buddy notified ${people.map((x) => x.name).join(", ")}: ${p.title}`,
          category: "notification",
          entityType: project ? "project" : "notification",
          entityId: project?.id || people.map((x) => x.id).join(","),
        },
      };
    },
  },
};

function fmt(d: string) {
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function validateMeeting(p: Record<string, any>) {
  if (!PROVIDERS[p.provider]) fail("The meeting provider must be Google Meet, Zoom or Microsoft Teams.");
  if (!p.title) fail("The meeting needs a title.");
  const when = new Date(String(p.scheduled_at || ""));
  if (Number.isNaN(when.getTime())) fail("The meeting needs a date and time.");
  if (when.getTime() < Date.now() - 5 * 60 * 1000) fail("The meeting time is in the past.");
  const duration = Number(p.duration_minutes) || 30;
  if (duration < 5 || duration > 600) fail("Meetings must be between 5 minutes and 10 hours.");
  const attendees = cleanEmails(p.attendees);
  const bad = attendees.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) fail(`These aren't valid email addresses: ${bad.join(", ")}.`);
  if (attendees.length > 50) fail("A meeting can have at most 50 attendees.");
}

function validateEmail(p: Record<string, any>) {
  const to = cleanEmails(p.to);
  const cc = cleanEmails(p.cc);
  if (to.length === 0) fail("The email needs at least one recipient.");
  const bad = [...to, ...cc].filter((e) => !EMAIL_RE.test(e));
  if (bad.length) fail(`These aren't valid email addresses: ${bad.join(", ")}.`);
  if (to.length + cc.length > 10) fail("An email from Buddy can go to at most 10 people.");
  if (!String(p.subject || "").trim()) fail("The email needs a subject.");
  if (!String(p.body || "").trim()) fail("The email needs a message.");
  return { to, cc };
}

async function loadPeople(c: BuddyCaller, ids: unknown) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
  if (list.length === 0) fail("Nobody to notify was given.");
  if (list.length > 25) fail("Buddy can notify at most 25 people at once.");
  const { data } = await c.client.from("profiles").select("id, name, email").eq("tenant_id", c.tenantId).in("id", list);
  const people = (data || []) as { id: string; name: string; email: string }[];
  if (people.length === 0) fail("None of those people are in this workspace.");
  return people;
}

const MORE_DEFS: any[] = [
  {
    type: "function",
    function: {
      name: "complete_checklist_item",
      description: "Mark a checklist item done, or reopen it (done=false). Get item_id from get_project.",
      parameters: { type: "object", properties: { item_id: { type: "string" }, done: { type: "boolean" } }, required: ["item_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_checklist_due_date",
      description: "Change a checklist item's due date. Get item_id from get_project.",
      parameters: { type: "object", properties: { item_id: { type: "string" }, due_date: { type: "string", description: "YYYY-MM-DD" } }, required: ["item_id", "due_date"] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description: "Add a task under a checklist item, optionally assigned to a person. Get checklist_item_id from get_project and assignee_id from list_people.",
      parameters: {
        type: "object",
        properties: {
          checklist_item_id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          assignee_id: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["checklist_item_id", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_project",
      description: "Transfer a project to the next team in the handoff order (stage 1 → stage 2 → stage 3; get their names from get_workspace_setup). The receiving team must accept it. Optionally name the new owner.",
      parameters: {
        type: "object",
        properties: { project_id: { type: "string" }, assignee_id: { type: "string" }, notes: { type: "string", description: "Handover notes for the receiving team" } },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "archive_project",
      description: "Archive a project (archive=true, default) or restore an archived one (archive=false).",
      parameters: { type: "object", properties: { project_id: { type: "string" }, archive: { type: "boolean" } }, required: ["project_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_risk",
      description: "Log a risk on a project.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          category: { type: "string", enum: ["merchant_dependency", "external_dependency", "internal_dependency", "project_viability"] },
          description: { type: "string" },
          mitigation_plan: { type: "string" },
          assignee_id: { type: "string" },
        },
        required: ["project_id", "title", "severity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_meeting_link",
      description:
        "Create a real Google Meet, Zoom or Teams meeting link in the workspace's account. With checklist_item_id the meeting is saved to that checklist item and attendees get a calendar invite. scheduled_at is an ISO date-time with timezone offset; use +05:30 (IST) unless the user says otherwise. Ask for the time if it wasn't given.",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["google_meet", "zoom", "teams"] },
          title: { type: "string" },
          scheduled_at: { type: "string", description: "e.g. 2026-09-18T15:00:00+05:30" },
          duration_minutes: { type: "number" },
          attendees: { type: "array", items: { type: "string" }, description: "Email addresses" },
          agenda: { type: "string" },
          project_id: { type: "string" },
          checklist_item_id: { type: "string" },
          send_invite: { type: "boolean", description: "Email a calendar invite to attendees (default true)" },
        },
        required: ["provider", "title", "scheduled_at"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description:
        "Send an email, for example to a merchant contact (the project's contact_email from get_project) or a teammate. Write the complete subject and body. The user reviews and can edit it before it sends.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "array", items: { type: "string" } },
          cc: { type: "array", items: { type: "string" } },
          subject: { type: "string" },
          body: { type: "string", description: "Plain text; blank lines separate paragraphs" },
          project_id: { type: "string", description: "The project this email is about, if any" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_notification",
      description: "Send an in-app notification to teammates in Handover (their notification bell), optionally also by email. Get user ids from list_people.",
      parameters: {
        type: "object",
        properties: {
          user_ids: { type: "array", items: { type: "string" } },
          title: { type: "string", description: "Short message" },
          body: { type: "string" },
          project_id: { type: "string" },
          also_email: { type: "boolean" },
        },
        required: ["user_ids", "title"],
      },
    },
  },
];

// ── Tasks, checklist comments and checklist responsibility ─────────────────

const TASK_STATUSES: Record<string, string> = { open: "Open", in_progress: "In progress", done: "Done" };

async function loadTask(c: BuddyCaller, id: string) {
  if (!id) fail("No task was given.");
  const { data } = await c.client.from("checklist_tasks").select("*").eq("tenant_id", c.tenantId).eq("id", id).maybeSingle();
  if (!data) fail("That task isn't in this workspace.");
  const task = data as any;
  const project = await loadProject(c, task.project_id, "id, merchant_name");
  return { task, project };
}

const CHECKLIST_MORE: Record<string, ActionDef> = {
  update_task_status: {
    label: "Update task",
    async preview(c, p) {
      const { task, project } = await loadTask(c, p.task_id);
      if (!TASK_STATUSES[p.status]) fail("Task status must be open, in progress or done.");
      return {
        action: "update_task_status",
        title: p.status === "done" ? "Complete task" : "Change task status",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Task", after: task.title },
          { label: "Status", before: TASK_STATUSES[task.status] || task.status, after: TASK_STATUSES[p.status]! },
        ],
        warnings: task.status === p.status ? [`This task is already ${TASK_STATUSES[p.status]!.toLowerCase()}.`] : undefined,
        undoable: true,
      };
    },
    async execute(c, p) {
      const { task, project } = await loadTask(c, p.task_id);
      if (!TASK_STATUSES[p.status]) fail("Task status must be open, in progress or done.");
      const { error } = await c.client.from("checklist_tasks").update({ status: p.status }).eq("id", task.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
      return {
        message: `Task "${task.title}" is ${TASK_STATUSES[p.status]!.toLowerCase()}.`,
        link: { label: "Open task", href: `/projects/${project.id}?item=${task.checklist_item_id}&task=${task.id}` },
        undo: { table: "checklist_tasks", op: "update", rows: [{ id: task.id, before: { status: task.status } }] },
        log: { description: `Buddy set task "${task.title}" on ${project.merchant_name} to ${TASK_STATUSES[p.status]}`, category: "task", entityType: "project", entityId: project.id },
      };
    },
  },

  delete_task: {
    label: "Delete task",
    async preview(c, p) {
      const { task, project } = await loadTask(c, p.task_id);
      const assignee = task.assigned_to ? await c.client.from("profiles").select("name").eq("id", task.assigned_to).maybeSingle() : null;
      return {
        action: "delete_task",
        title: "Delete task",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Task", after: task.title },
          { label: "Status", after: TASK_STATUSES[task.status] || task.status },
          { label: "Assigned to", after: ((assignee as any)?.data?.name as string) || "Nobody" },
        ],
        warnings: ["The task is removed for everyone. Undo is available for 10 minutes."],
        undoable: true,
      };
    },
    async execute(c, p) {
      const { task, project } = await loadTask(c, p.task_id);
      const { error } = await c.client.from("checklist_tasks").delete().eq("id", task.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
      return {
        message: `Task "${task.title}" deleted from ${project.merchant_name}.`,
        link: { label: "Open checklist", href: `/projects/${project.id}?item=${task.checklist_item_id}` },
        undo: { table: "checklist_tasks", op: "insert", rows: [{ id: task.id, before: task }] },
        log: { description: `Buddy deleted task "${task.title}" on ${project.merchant_name}`, category: "task", entityType: "project", entityId: project.id },
      };
    },
  },

  add_checklist_comment: {
    label: "Comment on checklist item",
    async preview(c, p) {
      const { item, project } = await loadItem(c, p.item_id);
      if (!String(p.comment || "").trim()) fail("The comment is empty.");
      return {
        action: "add_checklist_comment",
        title: "Comment on checklist item",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Item", after: item.title },
          { label: "Comment", after: String(p.comment).trim() },
        ],
        notes: [`Posted as ${c.name}.`],
        undoable: true,
      };
    },
    async execute(c, p) {
      const { item, project } = await loadItem(c, p.item_id);
      const text = String(p.comment || "").trim();
      if (!text) fail("The comment is empty.");
      const { data, error } = await c.client
        .from("checklist_comments")
        .insert({ checklist_item_id: item.id, comment: text, user_id: c.userId, user_name: c.name, tenant_id: c.tenantId })
        .select("id")
        .single();
      if (error) throw error;
      const commentId = (data as { id: string }).id;
      return {
        message: `Comment posted on "${item.title}".`,
        link: { label: "Open comment", href: `/projects/${project.id}?item=${item.id}&comment=${commentId}` },
        undo: { table: "checklist_comments", op: "delete", rows: [{ id: commentId }] },
        log: { description: `Buddy commented on "${item.title}" for ${project.merchant_name}`, category: "checklist", entityType: "project", entityId: project.id },
      };
    },
  },

  toggle_item_responsibility: {
    label: "Change who holds a checklist item",
    async preview(c, p) {
      const { item, project } = await loadItem(c, p.item_id);
      const labels = (await buddyLabels(c)).responsibility;
      if (!labels[p.party]) fail("Who holds it must be internal team, merchant or neutral.");
      const { data: row } = await c.client.from("checklist_items").select("current_responsibility").eq("id", item.id).maybeSingle();
      const before = (row as { current_responsibility?: string } | null)?.current_responsibility || "neutral";
      return {
        action: "toggle_item_responsibility",
        title: "Change who holds a checklist item",
        target: { id: project.id, label: project.merchant_name },
        rows: [
          { label: "Item", after: item.title },
          { label: "Held by", before: labels[before] || before, after: labels[p.party]! },
        ],
        notes: ["The time each side held the item keeps counting from now."],
        undoable: true,
      };
    },
    async execute(c, p) {
      const { item, project } = await loadItem(c, p.item_id);
      const labels: Record<string, string> = { gokwik: "internal team", merchant: "merchant", neutral: "neutral" };
      if (!labels[p.party]) fail("Who holds it must be internal team, merchant or neutral.");
      const { data: row } = await c.client.from("checklist_items").select("current_responsibility").eq("id", item.id).maybeSingle();
      const before = (row as { current_responsibility?: string } | null)?.current_responsibility || "neutral";
      const now = new Date().toISOString();

      // Same bookkeeping as the checklist toggle: close the open log, start a new one.
      const { data: open } = await c.client
        .from("checklist_responsibility_logs")
        .select("id")
        .eq("checklist_item_id", item.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1);
      const openId = ((open || []) as { id: string }[])[0]?.id;
      if (openId) await c.client.from("checklist_responsibility_logs").update({ ended_at: now }).eq("id", openId);
      await c.client.from("checklist_responsibility_logs").insert({ checklist_item_id: item.id, party: p.party, started_at: now, tenant_id: c.tenantId });

      const { error } = await c.client.from("checklist_items").update({ current_responsibility: p.party }).eq("id", item.id).eq("tenant_id", c.tenantId);
      if (error) throw error;
      return {
        message: `"${item.title}" is now held by the ${labels[p.party]}.`,
        link: { label: "Open checklist", href: `/projects/${project.id}?item=${item.id}` },
        undo: { table: "checklist_items", op: "update", rows: [{ id: item.id, before: { current_responsibility: before } }] },
        log: { description: `Buddy set "${item.title}" on ${project.merchant_name} to held by the ${labels[p.party]}`, category: "checklist", entityType: "project", entityId: project.id },
      };
    },
  },
};

const CHECKLIST_DEFS: any[] = [
  {
    type: "function",
    function: {
      name: "update_task_status",
      description: "Change a task's status: open, in_progress or done (use done to complete it). Get task_id from get_project.",
      parameters: {
        type: "object",
        properties: { task_id: { type: "string" }, status: { type: "string", enum: ["open", "in_progress", "done"] } },
        required: ["task_id", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Delete a task. Get task_id from get_project.",
      parameters: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_checklist_comment",
      description: "Post a comment on a checklist item, as the user. Get item_id from get_project or from a tagged checklist item.",
      parameters: { type: "object", properties: { item_id: { type: "string" }, comment: { type: "string" } }, required: ["item_id", "comment"] },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_item_responsibility",
      description: "Set who holds one checklist item: gokwik (internal team), merchant, or neutral. For the whole project, use toggle_responsibility.",
      parameters: {
        type: "object",
        properties: { item_id: { type: "string" }, party: { type: "string", enum: ["gokwik", "merchant", "neutral"] } },
        required: ["item_id", "party"],
      },
    },
  },
];

/**
 * Exported by name and combined in registry.server.ts. Not registered as an
 * import side effect: package.json marks modules side-effect free, and the
 * bundler drops such registrations from production builds.
 */
export const MORE_ACTIONS: Record<string, ActionDef> = { ...MORE, ...CHECKLIST_MORE };
export const MORE_ACTION_TOOL_DEFS: any[] = [...MORE_DEFS, ...CHECKLIST_DEFS];
