import { useState, useEffect } from "react";
import { Project } from "@/data/projectsData";
import { TeamRole } from "@/data/teams";
import { useLabels } from "@/contexts/LabelsContext";
import { supabase } from "@/integrations/supabase/client";
import { sendNotification } from "@/utils/sendNotification";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { User, CheckCircle2, Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  team: string;
}

export interface AssignOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Single project mode
  project?: Project;
  // Bulk mode
  projectIds?: string[];
  onAssigned?: () => void;
}

export const AssignOwnerDialog = ({ project, open, onOpenChange, projectIds, onAssigned }: AssignOwnerDialogProps) => {
  const queryClient = useQueryClient();
  const { teamLabels } = useLabels();
  const isBulk = !!projectIds && projectIds.length > 0;
  const [targetTeam, setTargetTeam] = useState<TeamRole>(project?.currentOwnerTeam || "mint");
  const [targetOwner, setTargetOwner] = useState<string>(project?.assignedOwner || "");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (project) {
      setTargetTeam(project.currentOwnerTeam);
      setTargetOwner(project.assignedOwner || "");
    } else {
      setTargetTeam("mint");
      setTargetOwner("");
    }
  }, [open, project]);

  useEffect(() => {
    if (!open) return;
    const fetchMembers = async () => {
      setIsLoading(true);
      try {
        // Fetch team members for selected team
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name, email, team")
          .eq("team", targetTeam);

        const { data: userRoles } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("role", targetTeam);

        const allProfiles = [...(profiles || [])];
        const roleUserIds = userRoles?.map(r => r.user_id) || [];

        if (roleUserIds.length > 0) {
          const { data: extra } = await supabase
            .from("profiles")
            .select("id, name, email, team")
            .in("id", roleUserIds);
          extra?.forEach(p => {
            if (!allProfiles.find(ap => ap.id === p.id)) {
              allProfiles.push({ ...p, team: targetTeam });
            }
          });
        }

        // Also fetch all managers regardless of team
        const { data: managerRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "manager");

        const managerIds = managerRoles?.map(r => r.user_id) || [];
        if (managerIds.length > 0) {
          const { data: managerProfiles } = await supabase
            .from("profiles")
            .select("id, name, email, team")
            .in("id", managerIds);
          managerProfiles?.forEach(p => {
            if (!allProfiles.find(ap => ap.id === p.id)) {
              allProfiles.push(p);
            }
          });
        }

        setTeamMembers(allProfiles);
      } catch {
        setTeamMembers([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMembers();
  }, [targetTeam, open]);

  const handleAssign = async () => {
    setIsAssigning(true);
    try {
      const updateData: Record<string, any> = {
        current_owner_team: targetTeam,
        updated_at: new Date().toISOString(),
        assigned_owner: targetOwner || null,
        pending_acceptance: true,
      };

      if (isBulk) {
        // Bulk assign
        const { error } = await supabase
          .from("projects")
          .update(updateData as never)
          .in("id", projectIds!);

        if (error) throw error;

        const owner = teamMembers.find(m => m.id === targetOwner);
        if (owner) {
          // Send notification for bulk
          sendNotification({
            type: "project_assignment",
            recipientEmail: owner.email,
            recipientName: owner.name,
            projectName: `${projectIds!.length} projects`,
            assignedBy: "Manager",
          });
        }

        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        toast.success(`Assigned ${projectIds!.length} project(s) to ${owner?.name || teamLabels[targetTeam]}`);
        onAssigned?.();
      } else if (project) {
        // Single assign
        const { error } = await supabase
          .from("projects")
          .update(updateData as never)
          .eq("id", project.id);

        if (error) throw error;

        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        const owner = teamMembers.find(m => m.id === targetOwner);

        if (owner) {
          sendNotification({
            type: "project_assignment",
            recipientEmail: owner.email,
            recipientName: owner.name,
            projectName: project.merchantName,
            assignedBy: "Manager",
            projectId: project.id,
            appUrl: window.location.origin,
          });
        }

        toast.success(
          owner
            ? `Assigned ${project.merchantName} to ${owner.name} (${teamLabels[targetTeam]})`
            : `Assigned ${project.merchantName} to ${teamLabels[targetTeam]}`
        );
      }

      onOpenChange(false);
    } catch (error: any) {
      toast.error("Failed to assign: " + error.message);
    } finally {
      setIsAssigning(false);
    }
  };

  const title = isBulk ? `Bulk Assign ${projectIds!.length} Project(s)` : "Assign Project";
  const description = isBulk
    ? `Assign ${projectIds!.length} selected project(s) to a team and owner.`
    : project
    ? <>Assign <span className="font-semibold text-foreground">{project.merchantName}</span> to a team and owner.</>
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="text-sm text-muted-foreground">{description}</div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Team</label>
            <Select value={targetTeam} onValueChange={(v) => { setTargetTeam(v as TeamRole); setTargetOwner(""); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mint">{teamLabels.mint}</SelectItem>
                <SelectItem value="integration">{teamLabels.integration}</SelectItem>
                <SelectItem value="ms">{teamLabels.ms}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Owner</label>
            <Select
              value={targetOwner || "none"}
              onValueChange={(v) => setTargetOwner(v === "none" ? "" : v)}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? "Loading..." : "Select owner"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No specific owner</SelectItem>
                {teamMembers.filter(m => m.team === targetTeam).map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
                {teamMembers.some(m => m.team !== targetTeam) && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-1">Managers</div>
                    {teamMembers.filter(m => m.team !== targetTeam).map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name} <span className="text-muted-foreground text-xs">({member.team})</span>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleAssign} disabled={isAssigning} className="w-full gap-2">
            {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {isAssigning ? "Assigning..." : "Assign"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
