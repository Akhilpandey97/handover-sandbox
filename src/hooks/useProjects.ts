import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Project, ProjectChecklist, ResponsibilityLog, ChecklistResponsibilityLog, TransferRecord, ResponsibilityParty, ProjectPhase, ProjectState } from "@/data/projectsData";
import type { TeamRole } from "@/data/teams";
import { teamLabels } from "@/data/teams";
import { sendNotification } from "@/utils/sendNotification";
import { logActivity } from "@/hooks/useActivityLogs";

// Transform database row to Project type
const transformDbProject = (row: any): Project => ({
  id: row.id,
  merchantName: row.merchant_name,
  mid: row.mid,
  platform: row.platform || "Custom",
  arr: Number(row.arr) || 0,
  txnsPerDay: row.txns_per_day || 0,
  aov: Number(row.aov) || 0,
  category: row.category || "",
  currentPhase: row.current_phase as ProjectPhase,
  currentOwnerTeam: row.current_owner_team as TeamRole,
  pendingAcceptance: row.pending_acceptance || false,
  goLivePercent: row.go_live_percent || 0,
  links: {
    brandUrl: row.brand_url || "",
    jiraLink: row.jira_link || "",
    brdLink: row.brd_link || "",
    mintChecklistLink: row.mint_checklist_link || "",
    integrationChecklistLink: row.integration_checklist_link || "",
    sowLink: row.sow_link || "",
  },
  dates: {
    kickOffDate: row.kick_off_date,
    goLiveDate: row.go_live_date || undefined,
    expectedGoLiveDate: row.expected_go_live_date || undefined,
  },
  notes: {
    mintNotes: row.mint_notes || "",
    projectNotes: row.project_notes || "",
    currentPhaseComment: row.current_phase_comment || "",
    phase2Comment: row.phase2_comment || "",
    opsComment: (row as any).ops_comment || "",
  },
  transferHistory: row.transfer_history || [],
  checklist: row.checklist_items || [],
  salesSpoc: row.sales_spoc || "",
  integrationType: row.integration_type || "Standard",
  pgOnboarding: row.pg_onboarding || "",
  currentResponsibility: (row.current_responsibility as ResponsibilityParty) || "neutral",
  responsibilityLog: row.responsibility_logs || [],
  assignedOwner: row.assigned_owner || undefined,
  projectState: (row.project_state as ProjectState) || "not_started",
  assignedOwnerName: row.assigned_owner_name || undefined,
  archived: (row as any).archived || false,
  archivedAt: (row as any).archived_at || undefined,
  contactEmail: (row as any).contact_email || undefined,
  configId: (row as any).config_id || undefined,
  updatedAt: row.updated_at || undefined,
  sandboxMid: (row as any).sandbox_mid || undefined,
  sandboxAppId: (row as any).sandbox_app_id || undefined,
  sandboxAppSecret: (row as any).sandbox_app_secret || undefined,
  sandboxBaseUrl: (row as any).sandbox_base_url || undefined,
  sandboxConfigId: (row as any).sandbox_config_id || undefined,
  sandboxKwikpassJweKey: (row as any).sandbox_kwikpass_jwe_key || undefined,
  prodMid: (row as any).prod_mid || undefined,
  prodAppId: (row as any).prod_app_id || undefined,
  prodAppSecret: (row as any).prod_app_secret || undefined,
  prodBaseUrl: (row as any).prod_base_url || undefined,
  prodConfigId: (row as any).prod_config_id || undefined,
  prodKwikpassJweKey: (row as any).prod_kwikpass_jwe_key || undefined,
  mcpConfigId: (row as any).mcp_config_id || undefined,
  enableMcpDocument: (row as any).enable_mcp_document || false,
  enableKp: (row as any).enable_kp || false,
  kpProdJweKey: (row as any).kp_prod_jwe_key || undefined,
  kpSandboxJweKey: (row as any).kp_sandbox_jwe_key || 'zH4NRP1HMALxxCFnRZABFA7GOJtzU_gIj02alfL1lvI',
  mandatoryApis: Array.isArray((row as any).mandatory_apis) ? (row as any).mandatory_apis : [],
  faqHelp: Array.isArray((row as any).faq_help) ? (row as any).faq_help : [],
  paymentSimulatorLink: (row as any).payment_simulator_link || undefined,
});

// Transform checklist item from database
const transformDbChecklistItem = (row: any): ProjectChecklist => ({
  id: row.id,
  title: row.title,
  completed: row.completed || false,
  completedBy: row.completed_by || undefined,
  completedAt: row.completed_at || undefined,
  phase: row.phase as ProjectPhase,
  ownerTeam: (row.owner_team || "mint").toLowerCase() as TeamRole,
  currentResponsibility: (row.current_responsibility as ResponsibilityParty) || "neutral",
  responsibilityLog: row.responsibility_logs || [],
  comment: row.comment || undefined,
  commentBy: row.comment_by || undefined,
  commentAt: row.comment_at || undefined,
  isTask: row.is_task || false,
  dueDate: row.due_date || undefined,
});

// Fetch all projects with related data
export const useProjectsQuery = () => {
  const { currentUser } = useAuth();

  return useQuery({
    queryKey: ["projects", currentUser?.id],
    enabled: !!currentUser,
    staleTime: 3 * 60_000, // 3 min — this pulls 5 tables, keep DB IO low
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const PAGE_SIZE = 1000;

      const fetchAllChecklistItems = async () => {
        const all: any[] = [];
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data, error } = await supabase
            .from("checklist_items")
            .select("*")
            // IMPORTANT: ordering only by sort_order will group many projects together and,
            // combined with the 1000-row limit, can drop later checklist rows (e.g. Integration).
            .order("project_id", { ascending: true })
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

          if (error) throw error;
          all.push(...(data || []));
          if (!data || data.length < PAGE_SIZE) break;
        }
        return all;
      };

      // Fetch projects
      const { data: projects, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (projectsError) throw projectsError;

      // Fetch profiles for owner name lookup
      const { data: profiles } = await supabase.from("profiles").select("id, name");
      const profileMap = new Map<string, string>();
      profiles?.forEach(p => profileMap.set(p.id, p.name));

      // Fetch all checklist items (paginated to avoid 1000-row limit dropping Integration rows)
      const checklistItems = await fetchAllChecklistItems();

      // Fetch project responsibility logs
      const { data: projectLogs, error: projectLogsError } = await supabase
        .from("project_responsibility_logs")
        .select("*")
        .order("started_at", { ascending: true });

      if (projectLogsError) throw projectLogsError;

      // Fetch checklist responsibility logs
      const { data: checklistLogs, error: checklistLogsError } = await supabase
        .from("checklist_responsibility_logs")
        .select("*")
        .order("started_at", { ascending: true });

      if (checklistLogsError) throw checklistLogsError;

      // Fetch transfer history
      const { data: transfers, error: transfersError } = await supabase
        .from("transfer_history")
        .select("*")
        .order("transferred_at", { ascending: true });

      if (transfersError) throw transfersError;

      // Group data by project
      const checklistByProject = new Map<string, any[]>();
      const logsByProject = new Map<string, any[]>();
      const logsByChecklist = new Map<string, any[]>();
      const transfersByProject = new Map<string, any[]>();

      // Pre-group checklist logs by checklist_item_id for O(1) lookup
      const checklistLogsByItem = new Map<string, any[]>();
      checklistLogs?.forEach((log) => {
        const logs = checklistLogsByItem.get(log.checklist_item_id) || [];
        logs.push({
          id: log.id,
          party: log.party,
          startedAt: log.started_at,
          endedAt: log.ended_at || undefined,
        });
        checklistLogsByItem.set(log.checklist_item_id, logs);
      });

      checklistItems?.forEach((item) => {
        const projectChecklists = checklistByProject.get(item.project_id) || [];
        projectChecklists.push({
          ...item,
          responsibility_logs: checklistLogsByItem.get(item.id) || [],
        });
        checklistByProject.set(item.project_id, projectChecklists);
      });

      projectLogs?.forEach((log) => {
        const logs = logsByProject.get(log.project_id) || [];
        logs.push({
          id: log.id,
          party: log.party,
          startedAt: log.started_at,
          endedAt: log.ended_at || undefined,
          phase: log.phase,
        });
        logsByProject.set(log.project_id, logs);
      });

      transfers?.forEach((transfer) => {
        const projectTransfers = transfersByProject.get(transfer.project_id) || [];
        projectTransfers.push({
          id: transfer.id,
          fromTeam: transfer.from_team,
          toTeam: transfer.to_team,
          transferredBy: transfer.transferred_by,
          acceptedBy: transfer.accepted_by || undefined,
          transferredAt: transfer.transferred_at,
          acceptedAt: transfer.accepted_at || undefined,
          notes: transfer.notes || undefined,
        });
        transfersByProject.set(transfer.project_id, projectTransfers);
      });

      // Transform and combine
      return (projects || []).map((project) => {
        const checklistForProject = checklistByProject.get(project.id) || [];
        const items = checklistForProject.map(transformDbChecklistItem);
        // Auto-calculate Expected Go-Live from the latest checklist due date
        // when it has not been set manually on the project.
        const derivedExpectedGoLive = items
          .filter((i) => !i.isTask && i.dueDate)
          .map((i) => i.dueDate as string)
          .sort()
          .pop()
          ?.slice(0, 10);
        return transformDbProject({
          ...project,
          expected_go_live_date: project.expected_go_live_date || derivedExpectedGoLive || null,
          checklist_items: items,
          responsibility_logs: logsByProject.get(project.id) || [],
          transfer_history: transfersByProject.get(project.id) || [],
          assigned_owner_name: project.assigned_owner ? profileMap.get(project.assigned_owner) : undefined,
        });
      });
    },
  });
};

// Add project mutation
export const useAddProject = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async (project: Project) => {
      // Insert project with tenant_id from current user
      const { data: newProject, error: projectError } = await supabase
        .from("projects")
        .insert({
          merchant_name: project.merchantName,
          mid: project.mid,
          platform: project.platform,
          arr: project.arr,
          txns_per_day: project.txnsPerDay,
          aov: project.aov,
          category: project.category,
          current_phase: project.currentPhase,
          current_owner_team: project.currentOwnerTeam,
          pending_acceptance: project.pendingAcceptance,
          go_live_percent: project.goLivePercent,
          brand_url: project.links.brandUrl,
          jira_link: project.links.jiraLink,
          brd_link: project.links.brdLink,
          mint_checklist_link: project.links.mintChecklistLink,
          integration_checklist_link: project.links.integrationChecklistLink,
          sow_link: project.links.sowLink,
          kick_off_date: project.dates.kickOffDate,
          go_live_date: project.dates.goLiveDate,
          expected_go_live_date: project.dates.expectedGoLiveDate,
          mint_notes: project.notes.mintNotes,
          project_notes: project.notes.projectNotes,
          current_phase_comment: project.notes.currentPhaseComment,
          phase2_comment: project.notes.phase2Comment,
          sales_spoc: project.salesSpoc,
          integration_type: project.integrationType,
          pg_onboarding: project.pgOnboarding,
          current_responsibility: project.currentResponsibility,
          project_state: project.projectState,
           contact_email: project.contactEmail || null,
           config_id: project.configId || null,
           tenant_id: currentUser?.tenantId || null,
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // Checklist items are seeded automatically by the database trigger on projects insert.

      // Insert initial responsibility log
      if (project.responsibilityLog.length > 0) {
        const logsToInsert = project.responsibilityLog.map((log) => ({
          project_id: newProject.id,
          party: log.party,
          phase: log.phase,
          started_at: log.startedAt,
          ended_at: log.endedAt || null,
          tenant_id: currentUser?.tenantId || null,
        }));

        const { error: logError } = await supabase
          .from("project_responsibility_logs")
          .insert(logsToInsert);

        if (logError) throw logError;
      }

      return newProject;
    },
    onSuccess: (newProject) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created successfully");
      logActivity({ action_type: "user", category: "project", description: `Created project "${newProject.merchant_name}"`, entity_type: "project", entity_id: newProject.id });
    },
    onError: (error) => {
      console.error("Error creating project:", error);
      toast.error("Failed to create project");
    },
  });
};

// Diff helper for project updates
const diffProject = (oldP: Project | undefined, newP: Project): { field: string; from: string; to: string }[] => {
  if (!oldP) return [];
  const changes: { field: string; from: string; to: string }[] = [];
  const check = (label: string, oldVal: any, newVal: any) => {
    const o = oldVal == null ? "" : String(oldVal);
    const n = newVal == null ? "" : String(newVal);
    if (o !== n) changes.push({ field: label, from: o, to: n });
  };
  check("Merchant Name", oldP.merchantName, newP.merchantName);
  check("MID", oldP.mid, newP.mid);
  check("Platform", oldP.platform, newP.platform);
  check("ARR", oldP.arr, newP.arr);
  check("Txns/Day", oldP.txnsPerDay, newP.txnsPerDay);
  check("AOV", oldP.aov, newP.aov);
  check("Category", oldP.category, newP.category);
  check("Phase", oldP.currentPhase, newP.currentPhase);
  check("Owner Team", oldP.currentOwnerTeam, newP.currentOwnerTeam);
  check("Project State", oldP.projectState, newP.projectState);
  check("Go-Live %", oldP.goLivePercent, newP.goLivePercent);
  check("Sales SPOC", oldP.salesSpoc, newP.salesSpoc);
  check("Integration Type", oldP.integrationType, newP.integrationType);
  check("PG Onboarding", oldP.pgOnboarding, newP.pgOnboarding);
  check("Responsibility", oldP.currentResponsibility, newP.currentResponsibility);
  check("Contact Email", oldP.contactEmail, newP.contactEmail);
  check("Kick Off Date", oldP.dates.kickOffDate, newP.dates.kickOffDate);
  check("Go-Live Date", oldP.dates.goLiveDate, newP.dates.goLiveDate);
  check("Expected Go-Live", oldP.dates.expectedGoLiveDate, newP.dates.expectedGoLiveDate);
  check("Brand URL", oldP.links.brandUrl, newP.links.brandUrl);
  check("Jira Link", oldP.links.jiraLink, newP.links.jiraLink);
  check("BRD Link", oldP.links.brdLink, newP.links.brdLink);
  check("SOW Link", oldP.links.sowLink, newP.links.sowLink);
  check("MINT Checklist Link", oldP.links.mintChecklistLink, newP.links.mintChecklistLink);
  check("Integration Checklist Link", oldP.links.integrationChecklistLink, newP.links.integrationChecklistLink);
  check("MINT Notes", oldP.notes.mintNotes, newP.notes.mintNotes);
  check("Project Notes", oldP.notes.projectNotes, newP.notes.projectNotes);
  check("Phase Comment", oldP.notes.currentPhaseComment, newP.notes.currentPhaseComment);
  check("Phase 2 Comment", oldP.notes.phase2Comment, newP.notes.phase2Comment);
  check("Archived", oldP.archived, newP.archived);
  return changes;
};

// Update project mutation
export const useUpdateProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (project: Project) => {
      // Grab the old version for diffing
      const oldProjects = queryClient.getQueryData<Project[]>(["projects"]);
      const oldProject = oldProjects?.find(p => p.id === project.id);

      // Auto-set Actual Go-Live date the moment a project transitions to "live"
      if (
        project.projectState === "live" &&
        oldProject?.projectState !== "live" &&
        !project.dates.goLiveDate
      ) {
        const today = new Date().toISOString().split("T")[0];
        project.dates = { ...project.dates, goLiveDate: today };
      }


      const { error } = await supabase
        .from("projects")
        .update({
          merchant_name: project.merchantName,
          mid: project.mid,
          platform: project.platform,
          arr: project.arr,
          txns_per_day: project.txnsPerDay,
          aov: project.aov,
          category: project.category,
          current_phase: project.currentPhase,
          current_owner_team: project.currentOwnerTeam,
          pending_acceptance: project.pendingAcceptance,
          go_live_percent: project.goLivePercent,
          brand_url: project.links.brandUrl,
          jira_link: project.links.jiraLink,
          brd_link: project.links.brdLink,
          mint_checklist_link: project.links.mintChecklistLink,
          integration_checklist_link: project.links.integrationChecklistLink,
          sow_link: project.links.sowLink,
          kick_off_date: project.dates.kickOffDate,
          go_live_date: project.dates.goLiveDate,
          expected_go_live_date: project.dates.expectedGoLiveDate,
          mint_notes: project.notes.mintNotes,
          project_notes: project.notes.projectNotes,
          current_phase_comment: project.notes.currentPhaseComment,
          phase2_comment: project.notes.phase2Comment,
          sales_spoc: project.salesSpoc,
          integration_type: project.integrationType,
          pg_onboarding: project.pgOnboarding,
          current_responsibility: project.currentResponsibility,
          project_state: project.projectState,
           archived: project.archived || false,
           archived_at: project.archivedAt || null,
           contact_email: project.contactEmail || null,
           config_id: project.configId || null,
           sandbox_mid: project.sandboxMid || null,
           sandbox_app_id: project.sandboxAppId || null,
           sandbox_app_secret: project.sandboxAppSecret || null,
           sandbox_base_url: project.sandboxBaseUrl || null,
           sandbox_config_id: project.sandboxConfigId || null,
           sandbox_kwikpass_jwe_key: project.sandboxKwikpassJweKey || null,
           prod_mid: project.prodMid || null,
           prod_app_id: project.prodAppId || null,
           prod_app_secret: project.prodAppSecret || null,
           prod_base_url: project.prodBaseUrl || null,
           prod_config_id: project.prodConfigId || null,
           prod_kwikpass_jwe_key: project.prodKwikpassJweKey || null,
            mcp_config_id: project.mcpConfigId || null,
            enable_mcp_document: project.enableMcpDocument || false,
            enable_kp: project.enableKp || false,
            kp_prod_jwe_key: project.kpProdJweKey || null,
            kp_sandbox_jwe_key: project.kpSandboxJweKey || 'zH4NRP1HMALxxCFnRZABFA7GOJtzU_gIj02alfL1lvI',
            mandatory_apis: project.mandatoryApis ?? [],
             faq_help: (project.faqHelp ?? []) as any,
             payment_simulator_link: project.paymentSimulatorLink || null,
         })
        .eq("id", project.id);

      if (error) throw error;
      return { project, changes: diffProject(oldProject, project) };
    },
    onSuccess: ({ project, changes }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      const changesSummary = changes.length > 0
        ? changes.map(c => `${c.field}: "${c.from || '—'}" → "${c.to || '—'}"`).join("; ")
        : "No field changes detected";
      const description = changes.length > 0
        ? `Updated ${changes.map(c => c.field).join(", ")} on "${project.merchantName}"`
        : `Updated project "${project.merchantName}"`;
      logActivity({
        action_type: "user",
        category: "project",
        description,
        entity_type: "project",
        entity_id: project.id,
        metadata: { changes },
      });
    },
    onError: (error) => {
      console.error("Error updating project:", error);
      toast.error("Failed to update project");
    },
  });
};

// Archive / unarchive project mutation (soft delete)
export const useArchiveProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, archive }: { projectId: string; archive: boolean }) => {
      const { error } = await supabase
        .from("projects")
        .update({
          archived: archive,
          archived_at: archive ? new Date().toISOString() : null,
        } as any)
        .eq("id", projectId);
      if (error) throw error;
      return { projectId, archive };
    },
    onSuccess: ({ projectId, archive }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(archive ? "Project archived" : "Project restored");
      logActivity({ action_type: "user", category: "project", description: archive ? "Archived project" : "Unarchived project", entity_type: "project", entity_id: projectId });
    },
    onError: (error) => {
      console.error("Error archiving project:", error);
      toast.error("Failed to update project");
    },
  });
};

// Delete project mutation
export const useDeleteProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      // Delete checklist responsibility logs first
      const { data: checklistItems } = await supabase
        .from("checklist_items")
        .select("id")
        .eq("project_id", projectId);

      if (checklistItems && checklistItems.length > 0) {
        const checklistIds = checklistItems.map(c => c.id);
        await supabase
          .from("checklist_responsibility_logs")
          .delete()
          .in("checklist_item_id", checklistIds);

        await supabase
          .from("checklist_comments")
          .delete()
          .in("checklist_item_id", checklistIds);
      }

      // Unlink parsed emails referencing this project
      await supabase
        .from("parsed_emails")
        .update({ project_id: null })
        .eq("project_id", projectId);

      // Delete related records
      await supabase.from("checklist_items").delete().eq("project_id", projectId);
      await supabase.from("project_responsibility_logs").delete().eq("project_id", projectId);
      await supabase.from("transfer_history").delete().eq("project_id", projectId);

      // Delete project
      const { error } = await supabase.from("projects").delete().eq("id", projectId);
      if (error) throw error;

      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted successfully");
      logActivity({ action_type: "user", category: "project", description: `Deleted project`, entity_type: "project", entity_id: projectId });
    },
    onError: (error) => {
      console.error("Error deleting project:", error);
      toast.error("Failed to delete project");
    },
  });
};

// Accept project mutation
export const useAcceptProject = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async (projectId: string) => {
      // Update project
      const { error: projectError } = await supabase
        .from("projects")
        .update({ pending_acceptance: false })
        .eq("id", projectId);

      if (projectError) throw projectError;

      // Update the latest transfer record
      const { data: transfers, error: fetchError } = await supabase
        .from("transfer_history")
        .select("*")
        .eq("project_id", projectId)
        .is("accepted_by", null)
        .order("transferred_at", { ascending: false })
        .limit(1);

      if (fetchError) throw fetchError;

      if (transfers && transfers.length > 0) {
        const { error: updateError } = await supabase
          .from("transfer_history")
          .update({
            accepted_by: currentUser?.name || "Unknown",
            accepted_at: new Date().toISOString(),
          })
          .eq("id", transfers[0].id);

        if (updateError) throw updateError;
      }

      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project accepted successfully");
      logActivity({ action_type: "user", category: "transfer", description: `Accepted project transfer`, entity_type: "project", entity_id: projectId });
    },
    onError: (error) => {
      console.error("Error accepting project:", error);
      toast.error("Failed to accept project");
    },
  });
};

// Transfer project mutation
export const useTransferProject = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, notes, assigneeId }: { projectId: string; notes?: string; assigneeId?: string }) => {
      if (!currentUser) throw new Error("Not authenticated");

      const getNextTeam = (current: TeamRole): TeamRole | null => {
        if (current === "mint") return "integration";
        if (current === "integration") return "ms";
        return null;
      };

      const nextTeam = getNextTeam(currentUser.team);
      if (!nextTeam) throw new Error("Cannot transfer from this team");

      const nextPhase = nextTeam === "integration" ? "integration" : nextTeam === "ms" ? "ms" : undefined;

      // Update project with new owner
      const { error: projectError } = await supabase
        .from("projects")
        .update({
          current_owner_team: nextTeam,
          current_phase: nextPhase,
          pending_acceptance: true,
          assigned_owner: assigneeId || null,
        })
        .eq("id", projectId);

      if (projectError) throw projectError;

      // Create transfer record
      const { error: transferError } = await supabase
        .from("transfer_history")
        .insert({
          project_id: projectId,
          from_team: currentUser.team,
          to_team: nextTeam,
          transferred_by: currentUser.name,
          notes,
          tenant_id: currentUser.tenantId || null,
        });

      if (transferError) throw transferError;

      // Send email notification to assigned owner (if any)
      if (assigneeId) {
        const { data: recipientProfile } = await supabase
          .from("profiles")
          .select("name, email")
          .eq("id", assigneeId)
          .single();

        if (recipientProfile) {
          // Fetch project name
          const { data: proj } = await supabase
            .from("projects")
            .select("merchant_name")
            .eq("id", projectId)
            .single();

          sendNotification({
            type: "project_transfer",
            recipientEmail: recipientProfile.email,
            recipientName: recipientProfile.name,
            projectName: proj?.merchant_name || "Unknown",
            fromTeam: teamLabels[currentUser.team] || currentUser.team,
            toTeam: teamLabels[nextTeam] || nextTeam,
            notes: notes || undefined,
            projectId,
            appUrl: window.location.origin,
          });
        }
      }

      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project transferred successfully");
      logActivity({ action_type: "user", category: "transfer", description: `Transferred project`, entity_type: "project", entity_id: projectId });
    },
    onError: (error) => {
      console.error("Error transferring project:", error);
      toast.error("Failed to transfer project");
    },
  });
};

// Reject project transfer — sends project back to previous team
export const useRejectProject = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, reason }: { projectId: string; reason: string }) => {
      if (!currentUser) throw new Error("Not authenticated");

      const getPreviousTeam = (current: TeamRole): TeamRole | null => {
        if (current === "integration") return "mint";
        if (current === "ms") return "integration";
        return null;
      };

      const previousTeam = getPreviousTeam(currentUser.team);
      if (!previousTeam) throw new Error("Cannot reject from this team");

      const previousPhase = previousTeam as "mint" | "integration" | "ms";

      // Find the last transfer record to get the previous owner
      const { data: lastTransfer } = await supabase
        .from("transfer_history")
        .select("transferred_by, from_team")
        .eq("project_id", projectId)
        .eq("to_team", currentUser.team)
        .order("transferred_at", { ascending: false })
        .limit(1)
        .single();

      // Look up the previous assigned_owner from the project's history
      // We need to find who owned it before — check the transferred_by user's profile
      let previousOwnerId: string | null = null;
      if (lastTransfer?.transferred_by) {
        const { data: prevOwnerProfile } = await supabase
          .from("profiles")
          .select("id")
          .eq("name", lastTransfer.transferred_by)
          .limit(1)
          .single();
        previousOwnerId = prevOwnerProfile?.id || null;
      }

      // Update project back to previous team, active (not pending), with previous owner
      const { error: projectError } = await supabase
        .from("projects")
        .update({
          current_owner_team: previousTeam,
          current_phase: previousPhase,
          pending_acceptance: false,
          assigned_owner: previousOwnerId,
        })
        .eq("id", projectId);

      if (projectError) throw projectError;

      // Create transfer record for the rejection
      const { error: transferError } = await supabase
        .from("transfer_history")
        .insert({
          project_id: projectId,
          from_team: currentUser.team,
          to_team: previousTeam,
          transferred_by: currentUser.name,
          notes: `REJECTED: ${reason}`,
          tenant_id: currentUser.tenantId || null,
        });

      if (transferError) throw transferError;

      // Send rejection email to previous owner
      if (previousOwnerId) {
        const { data: recipientProfile } = await supabase
          .from("profiles")
          .select("name, email")
          .eq("id", previousOwnerId)
          .single();

        const { data: proj } = await supabase
          .from("projects")
          .select("merchant_name")
          .eq("id", projectId)
          .single();

        if (recipientProfile) {
          sendNotification({
            type: "project_rejection",
            recipientEmail: recipientProfile.email,
            recipientName: recipientProfile.name,
            projectName: proj?.merchant_name || "Unknown",
            fromTeam: teamLabels[currentUser.team] || currentUser.team,
            toTeam: teamLabels[previousTeam] || previousTeam,
            notes: reason,
            projectId,
            appUrl: window.location.origin,
          });
        }
      }

      return projectId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project rejected and sent back");
    },
    onError: (error) => {
      console.error("Error rejecting project:", error);
      toast.error("Failed to reject project");
    },
  });
};

// Update checklist item mutation
export const useUpdateChecklist = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async ({
      projectId,
      checklistId,
      completed,
    }: {
      projectId: string;
      checklistId: string;
      completed: boolean;
    }) => {
      const { error } = await supabase
        .from("checklist_items")
        .update({
          completed,
          completed_by: completed ? currentUser?.name : null,
          completed_at: completed ? new Date().toISOString() : null,
        })
        .eq("id", checklistId);

      if (error) throw error;

      // When completing an item, auto-neutral it and close its open time-tracking logs
      if (completed) {
        // Close open responsibility log for this specific item
        const { data: openLogs } = await supabase
          .from("checklist_responsibility_logs")
          .select("id")
          .eq("checklist_item_id", checklistId)
          .is("ended_at", null);

        if (openLogs && openLogs.length > 0) {
          for (const log of openLogs) {
            await supabase
              .from("checklist_responsibility_logs")
              .update({ ended_at: new Date().toISOString() })
              .eq("id", log.id);
          }
        }

        // Set item to neutral
        await supabase
          .from("checklist_items")
          .update({ current_responsibility: "neutral" })
          .eq("id", checklistId);
      }

      return { projectId, checklistId, completed };
    },
    onMutate: async ({ projectId, checklistId, completed }) => {
      await queryClient.cancelQueries({ queryKey: ["projects"] });
      const previous = queryClient.getQueryData<Project[]>(["projects"]);
      queryClient.setQueryData<Project[]>(["projects"], (old) =>
        old?.map((p) =>
          p.id === projectId
            ? {
                ...p,
                checklist: p.checklist.map((c) =>
                  c.id === checklistId
                    ? { ...c, completed, completedBy: completed ? currentUser?.name : undefined, completedAt: completed ? new Date().toISOString() : undefined }
                    : c
                ),
              }
            : p
        )
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["projects"], context.previous);
      console.error("Error updating checklist:", error);
      toast.error("Failed to update checklist");
    },
    onSettled: async (_data, _error, variables) => {
      // The optimistic cache already holds the new value. Refetching the whole
      // projects list on every tick makes the checkbox feel laggy, so on success
      // we only mark the data stale and let the next mount/focus refresh it.
      queryClient.invalidateQueries({
        queryKey: ["projects"],
        refetchType: _error ? "active" : "none",
      });
      if (!_error && variables) {
        const { data: itemRow } = await supabase
          .from("checklist_items")
          .select("title, team")
          .eq("id", variables.checklistId)
          .maybeSingle();
        const itemTitle = (itemRow as any)?.title || "checklist item";
        const itemTeam = (itemRow as any)?.team || "";
        const action = variables.completed ? "Completed" : "Unchecked";
        logActivity({
          action_type: "user",
          category: "checklist",
          description: `${action} checklist item: "${itemTitle}"${itemTeam ? ` (${itemTeam})` : ""}`,
          entity_type: "project",
          entity_id: variables.projectId,
          metadata: {
            checklistItemId: variables.checklistId,
            itemTitle,
            itemTeam,
            completed: variables.completed,
            changes: [{
              field: itemTitle,
              from: variables.completed ? "unchecked" : "completed",
              to: variables.completed ? "completed" : "unchecked",
            }],
          },
        });
      }
    },
  });
};

// Update checklist comment mutation
export const useUpdateChecklistComment = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async ({
      checklistId,
      comment,
    }: {
      checklistId: string;
      comment: string;
    }) => {
      const { error } = await supabase
        .from("checklist_items")
        .update({
          comment,
          comment_by: currentUser?.name,
          comment_at: new Date().toISOString(),
        })
        .eq("id", checklistId);

      if (error) throw error;
      return { checklistId, comment };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      console.error("Error updating comment:", error);
      toast.error("Failed to update comment");
    },
  });
};

// Toggle project responsibility mutation
export const useToggleResponsibility = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async ({
      projectId,
      party,
      currentPhase,
    }: {
      projectId: string;
      party: ResponsibilityParty;
      currentPhase: ProjectPhase;
    }) => {
      // Close current log entry
      const { data: currentLogs, error: fetchError } = await supabase
        .from("project_responsibility_logs")
        .select("*")
        .eq("project_id", projectId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1);

      if (fetchError) throw fetchError;

      if (currentLogs && currentLogs.length > 0) {
        const { error: updateError } = await supabase
          .from("project_responsibility_logs")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", currentLogs[0].id);

        if (updateError) throw updateError;
      }

      // Create new log entry
      const { error: insertError } = await supabase
        .from("project_responsibility_logs")
        .insert({
          project_id: projectId,
          party,
          phase: currentPhase,
          started_at: new Date().toISOString(),
          tenant_id: currentUser?.tenantId || null,
        });

      if (insertError) throw insertError;

      // Update project current responsibility
      const { error: projectError } = await supabase
        .from("projects")
        .update({ current_responsibility: party })
        .eq("id", projectId);

      if (projectError) throw projectError;

      return { projectId, party };
    },
    onMutate: async ({ projectId, party }) => {
      await queryClient.cancelQueries({ queryKey: ["projects"] });
      const previous = queryClient.getQueryData(["projects"]);
      queryClient.setQueryData(["projects"], (old: any[] | undefined) => {
        if (!old) return old;
        return old.map((p: any) =>
          p.id === projectId ? { ...p, current_responsibility: party } : p
        );
      });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["projects"], context.previous);
      }
      console.error("Error toggling responsibility:", error);
      toast.error("Failed to update responsibility");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project_responsibility_logs"] });
    },
  });
};

// Toggle checklist responsibility mutation
export const useToggleChecklistResponsibility = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  return useMutation({
    mutationFn: async ({
      checklistId,
      party,
    }: {
      checklistId: string;
      party: ResponsibilityParty;
    }) => {
      // Close current log entry
      const { data: currentLogs, error: fetchError } = await supabase
        .from("checklist_responsibility_logs")
        .select("*")
        .eq("checklist_item_id", checklistId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1);

      if (fetchError) throw fetchError;

      if (currentLogs && currentLogs.length > 0) {
        const { error: updateError } = await supabase
          .from("checklist_responsibility_logs")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", currentLogs[0].id);

        if (updateError) throw updateError;
      }

      // Create new log entry
      const { error: insertError } = await supabase
        .from("checklist_responsibility_logs")
        .insert({
          checklist_item_id: checklistId,
          party,
          started_at: new Date().toISOString(),
          tenant_id: currentUser?.tenantId || null,
        });

      if (insertError) throw insertError;

      // Update checklist item current responsibility
      const { error: checklistError } = await supabase
        .from("checklist_items")
        .update({ current_responsibility: party })
        .eq("id", checklistId);

      if (checklistError) throw checklistError;

      return { checklistId, party };
    },
    onMutate: async ({ checklistId, party }) => {
      await queryClient.cancelQueries({ queryKey: ["projects"] });
      const previous = queryClient.getQueryData<Project[]>(["projects"]);
      queryClient.setQueryData<Project[]>(["projects"], (old) => {
        if (!old) return old;
        return old.map((project) => ({
          ...project,
          checklist: project.checklist.map((item) =>
            item.id === checklistId ? { ...item, currentResponsibility: party } : item
          ),
        }));
      });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["projects"], context.previous);
      }
      console.error("Error toggling checklist responsibility:", error);
      toast.error("Failed to update responsibility");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["checklist_responsibility_logs"] });
    },
  });
};
