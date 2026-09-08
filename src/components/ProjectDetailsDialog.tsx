import { useState } from "react";
import { Project, calculateTimeFromChecklist, calculateProjectResponsibilityFromChecklist, formatDuration } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomFields, useCustomFieldValues } from "@/hooks/useCustomFields";
import { useProjectEmails } from "@/hooks/useProjectEmails";
import { CustomFieldsDisplay } from "./CustomFieldsRenderer";
import { EmailThreadTimeline } from "./EmailThreadTimeline";
import { JiraTicketsSection } from "./JiraTicketsSection";
import { RiskBadge } from "./RiskBadge";
import { formatGoLiveDate } from "./GoLiveDate";
import { useProjectRiskVerdicts } from "@/hooks/useProjectRiskVerdicts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  Building2,
  Calendar,
  Clock,
  DollarSign,
  ExternalLink,
  Globe,
  Link2,
  Mail,
  MapPin,
  Minus,
  RefreshCw,
  Sparkles,
  TrendingUp,
  User,
  Users,
  Share2,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProjectDetailsDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ProjectDetailsDialog = ({
  project,
  open,
  onOpenChange,
}: ProjectDetailsDialogProps) => {
  const { currentUser } = useAuth();
  const { getLabel, teamLabels, responsibilityLabels } = useLabels();
  const [sharingPortal, setSharingPortal] = useState(false);
  const [sendingMagic, setSendingMagic] = useState(false);
  const { fields: customFields } = useCustomFields();
  const { verdicts: riskVerdicts } = useProjectRiskVerdicts();

  const handleSharePortal = async () => {
    if (!project) return;
    setSharingPortal(true);
    try {
      // Check for existing active token
      const { data: existing } = await supabase
        .from("merchant_portal_tokens")
        .select("token")
        .eq("project_id", project.id)
        .eq("is_active", true)
        .maybeSingle();

      let token = existing?.token;
      if (!token) {
        const { data: newToken, error } = await supabase
          .from("merchant_portal_tokens")
          .insert({
            project_id: project.id,
            tenant_id: currentUser?.tenantId,
            created_by: currentUser?.id,
          })
          .select("token")
          .single();
        if (error) throw error;
        token = newToken.token;
      }

      const url = `${window.location.origin}/portal?token=${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Portal link copied to clipboard!", { description: "Share this link with the merchant." });
    } catch (err: any) {
      toast.error("Failed to generate portal link", { description: err.message });
    } finally {
      setSharingPortal(false);
    }
  };

  const handleSendMagicLink = async () => {
    if (!project) return;
    if (!project.contactEmail) {
      toast.error("No merchant contact email set", { description: "Add a Merchant Contact Email in Edit Project first." });
      return;
    }
    setSendingMagic(true);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`/api/public/merchant-portal-data/send-magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ project_id: project.id }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Failed");
      toast.success("Magic link sent!", { description: `Sent to ${result.sent_to}` });
    } catch (err: any) {
      toast.error("Failed to send magic link", { description: err.message });
    } finally {
      setSendingMagic(false);
    }
  };

  const { values: customValues } = useCustomFieldValues(project?.id);
  const {
    threads,
    emailContext,
    isLoadingThreads,
    isLoadingContext,
    isRefreshing,
    refreshEmails,
    generateAiContext,
  } = useProjectEmails(project?.id);

  if (!project) return null;

  const computedResponsibility = calculateProjectResponsibilityFromChecklist(project.checklist);
  const timeByParty = calculateTimeFromChecklist(project.checklist);

  const DetailRow = ({ icon: Icon, label, value, isLink }: { icon: any; label: string; value?: string; isLink?: boolean }) => (
    <div className="flex items-start gap-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {isLink && value ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
            Open Link <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <p className="text-sm font-medium truncate">{value || "Not specified"}</p>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[95vw] h-[95vh] max-h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <span className="inline-flex items-center gap-2">
                {project.merchantName}
                <RiskBadge projectId={project.id} verdict={riskVerdicts[project.id]} />
              </span>
              <p className="text-sm font-normal text-muted-foreground mt-0.5">
                {getLabel("field_mid")}: {project.mid}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSendMagicLink} disabled={sendingMagic} className="gap-1.5 text-xs">
                <Mail className="h-3.5 w-3.5" />
                {sendingMagic ? "Sending..." : "Send Magic Link"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSharePortal} disabled={sharingPortal} className="gap-1.5 text-xs">
                <Share2 className="h-3.5 w-3.5" />
                {sharingPortal ? "Generating..." : "Share Portal Link"}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* Computed Responsibility Display */}
            <div className="p-4 rounded-lg border bg-card space-y-3 text-center">
              <div className="flex items-center justify-center gap-3">
                <h4 className="text-sm font-semibold flex items-center justify-center gap-2">
                  <Clock className="h-4 w-4" />
                  Action Pending On
                </h4>
                <Badge
                  variant="secondary"
                  className={
                    computedResponsibility === "gokwik"
                      ? "bg-primary/10 text-primary"
                      : computedResponsibility === "merchant"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {computedResponsibility === "gokwik" && <Building2 className="h-3 w-3 mr-1" />}
                  {computedResponsibility === "merchant" && <Users className="h-3 w-3 mr-1" />}
                  {computedResponsibility === "neutral" && <Minus className="h-3 w-3 mr-1" />}
                  {responsibilityLabels[computedResponsibility] || computedResponsibility}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Auto-calculated based on checklist item assignments
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-center">
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" />
                  {responsibilityLabels.gokwik} Time
                </div>
                <p className="text-lg font-bold text-primary">{formatDuration(timeByParty.gokwik)}</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-center">
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" />
                  {responsibilityLabels.merchant} Time
                </div>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{formatDuration(timeByParty.merchant)}</p>
              </div>
            </div>

            <Separator />

            {/* Business Metrics */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Business Metrics
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">{getLabel("field_arr")}</p>
                  <p className="text-lg font-bold">{project.arr} cr</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">{getLabel("field_txns_per_day")}</p>
                  <p className="text-lg font-bold">{project.txnsPerDay}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">{getLabel("field_aov")}</p>
                  <p className="text-lg font-bold">₹{project.aov.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-xs text-muted-foreground">{getLabel("field_go_live_percent")}</p>
                  <p className="text-lg font-bold">{project.goLivePercent}%</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Project Info */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Project Information
              </h4>
              <div className="grid grid-cols-2 gap-x-4">
                <DetailRow icon={Globe} label={getLabel("field_platform")} value={project.platform} />
                <DetailRow icon={Building2} label={getLabel("field_category")} value={project.category} />
                <DetailRow icon={User} label={getLabel("field_sales_spoc")} value={project.salesSpoc} />
                <DetailRow icon={TrendingUp} label={getLabel("field_integration_type")} value={project.integrationType} />
                <DetailRow icon={Building2} label={getLabel("field_pg_onboarding")} value={project.pgOnboarding} />
                <DetailRow icon={User} label="Current Owner" value={teamLabels[project.currentOwnerTeam]} />
              </div>
            </div>

            <Separator />

            {/* Dates */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Important Dates
              </h4>
              <div className="grid grid-cols-2 gap-x-4">
                <DetailRow
                  icon={Calendar}
                  label={getLabel("field_kick_off_date")}
                  value={format(new Date(project.dates.kickOffDate), "dd MMM yyyy")}
                />
                <DetailRow
                  icon={Calendar}
                  label={getLabel("field_expected_go_live_date")}
                  value={formatGoLiveDate(project, (d) => format(new Date(d), "dd MMM yyyy"), "TBD")}
                />
                <DetailRow
                  icon={Calendar}
                  label={getLabel("field_actual_go_live_date")}
                  value={project.dates.goLiveDate ? format(new Date(project.dates.goLiveDate), "dd MMM yyyy") : "TBD"}
                />
              </div>
            </div>

            <Separator />

            {/* Links */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Links
              </h4>
              <div className="grid grid-cols-2 gap-x-4">
                <DetailRow icon={Globe} label={getLabel("field_brand_url")} value={project.links.brandUrl} isLink />
                <DetailRow icon={Link2} label={getLabel("field_jira_link")} value={project.links.jiraLink} isLink />
                <DetailRow icon={Link2} label={getLabel("field_brd_link")} value={project.links.brdLink} isLink />
                <DetailRow icon={Link2} label={getLabel("field_mint_checklist_link")} value={project.links.mintChecklistLink} isLink />
                <DetailRow icon={Link2} label={getLabel("field_integration_checklist_link")} value={project.links.integrationChecklistLink} isLink />
                <DetailRow icon={Link2} label="SOW Link" value={project.links.sowLink} isLink />
              </div>
            </div>

            <Separator />

            {/* Custom Fields */}
            <CustomFieldsDisplay fields={customFields} values={customValues} />

            <Separator />

            {/* Notes */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Notes</h4>
              <div className="space-y-3">
                {project.notes.mintNotes && (
                  <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">{getLabel("field_mint_notes")}</p>
                    <p className="text-sm">{project.notes.mintNotes}</p>
                  </div>
                )}
                {project.notes.projectNotes && (
                  <div className="p-3 rounded-lg bg-muted/50 border">
                    <p className="text-xs font-medium text-muted-foreground mb-1">{getLabel("field_project_notes")}</p>
                    <p className="text-sm">{project.notes.projectNotes}</p>
                  </div>
                )}
                {project.notes.currentPhaseComment && (
                  <div className="p-3 rounded-lg bg-muted/50 border">
                    <p className="text-xs font-medium text-muted-foreground mb-1">{getLabel("field_current_phase_comment")}</p>
                    <p className="text-sm whitespace-pre-wrap">{project.notes.currentPhaseComment}</p>
                  </div>
                )}
                {project.notes.phase2Comment && (
                  <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900">
                    <p className="text-xs font-medium text-purple-700 dark:text-purple-400 mb-1">{getLabel("field_phase2_comment")}</p>
                    <p className="text-sm whitespace-pre-wrap">{project.notes.phase2Comment}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Transfer History */}
            {project.transferHistory.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-semibold mb-3">Transfer History</h4>
                  <div className="space-y-3">
                    {project.transferHistory.map((transfer, idx) => (
                      <div key={transfer.id} className="relative pl-6 pb-3 border-l-2 border-muted last:border-transparent">
                        <div className="absolute left-[-5px] top-0 h-2 w-2 rounded-full bg-primary" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            {teamLabels[transfer.fromTeam]} → {teamLabels[transfer.toTeam]}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Transferred by {transfer.transferredBy} on{" "}
                            {format(new Date(transfer.transferredAt), "dd MMM yyyy, HH:mm")}
                          </p>
                          {transfer.acceptedBy && (
                            <p className="text-xs text-green-600">
                              Accepted by {transfer.acceptedBy} on{" "}
                              {format(new Date(transfer.acceptedAt!), "dd MMM yyyy, HH:mm")}
                            </p>
                          )}
                          {transfer.notes && (
                            <p className="text-xs text-muted-foreground italic">"{transfer.notes}"</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

            <Separator />

            {/* Email Conversations */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email Conversations
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshEmails}
                  disabled={isRefreshing || !project.contactEmail}
                  className="gap-1 h-7 text-xs"
                >
                  <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
                  {isRefreshing ? "Fetching..." : "Refresh"}
                </Button>
              </div>

              {!project.contactEmail && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-lg bg-muted/50 border">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  No contact email set. Edit the project to add a merchant contact email.
                </div>
              )}

              {isLoadingThreads && (
                <div className="text-xs text-muted-foreground py-4 text-center">Loading threads...</div>
              )}

              {!isLoadingThreads && threads.length === 0 && project.contactEmail && (
                <div className="text-xs text-muted-foreground py-4 text-center">
                  No email threads found. Click Refresh to fetch from Gmail.
                </div>
              )}

              <div className={`space-y-2 ${threads.length > 5 ? "max-h-[420px] overflow-y-auto pr-2" : ""}`}>
                {threads.map((thread) => (
                  <EmailThreadTimeline key={thread.id} thread={thread} />
                ))}
              </div>
            </div>

            <Separator />

            {/* Jira Tickets */}
            <JiraTicketsSection projectId={project.id} merchantName={project.merchantName} />

            <Separator />

            {/* Action Items (AI-generated from emails + Jira) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Action Items
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateAiContext}
                  disabled={isLoadingContext || threads.length === 0}
                  className="gap-1 h-7 text-xs"
                >
                  <Sparkles className={`h-3 w-3 ${isLoadingContext ? "animate-pulse" : ""}`} />
                  {isLoadingContext ? "Generating..." : "Generate"}
                </Button>
              </div>

              {threads.length === 0 && !emailContext && (
                <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50 border">
                  Fetch email threads first, then click Generate to extract pending action items from emails and Jira.
                </div>
              )}

              {emailContext && (
                <div className="space-y-3">
                  {emailContext.summary && (
                    <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">Summary</p>
                      <p className="text-sm">{emailContext.summary}</p>
                    </div>
                  )}

                  {emailContext.actionItems.length > 0 ? (
                    <div className={`space-y-2 ${emailContext.actionItems.length > 5 ? "max-h-[420px] overflow-y-auto pr-2" : ""}`}>
                      {emailContext.actionItems.map((item, idx) => {
                        const priority = (item.priority || "medium").toLowerCase();
                        const priorityColor =
                          priority === "high"
                            ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900"
                            : priority === "low"
                            ? "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300 border-slate-200 dark:border-slate-800"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900";
                        const owner = item.owner || "Unknown";
                        const ownerColor =
                          owner === "GoKwik"
                            ? "bg-primary/10 text-primary border-primary/20"
                            : owner === "Merchant"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-900"
                            : "bg-muted text-muted-foreground border-border";
                        return (
                          <div key={idx} className="p-3 rounded-lg border bg-card">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-sm font-medium leading-snug">{item.title}</p>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${priorityColor}  font-medium`}>
                                  {priority}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ownerColor} font-medium`}>
                                  {owner === "GoKwik" ? responsibilityLabels.gokwik : owner}
                                </span>
                              </div>
                            </div>
                            {item.description && (
                              <p className="text-xs text-muted-foreground">{item.description}</p>
                            )}
                            {(item.source || item.reference) && (
                              <p className="text-[10px] text-muted-foreground mt-1.5">
                                {item.source && <span className="tracking-normal">{item.source}</span>}
                                {item.source && item.reference && " · "}
                                {item.reference}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/50 border">
                      No pending action items detected from emails and Jira.
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Generated from {emailContext.emailCount} email thread{emailContext.emailCount !== 1 ? "s" : ""} + Jira tickets
                    {" · "}
                    {format(new Date(emailContext.generatedAt), "dd MMM yyyy, HH:mm")}
                  </p>
                </div>
              )}
            </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};