import { useState, useEffect } from "react";
import { useProjects } from "@/contexts/ProjectContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendNotification } from "@/utils/sendNotification";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, FolderKanban, User } from "lucide-react";
import { teamLabels, TeamRole } from "@/data/teams";
import type { Database } from "@/integrations/supabase/types";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  team: string;
}

export const ProjectAssignment = () => {
  const { projects } = useProjects();
  const queryClient = useQueryClient();
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [targetTeam, setTargetTeam] = useState<TeamRole>("mint");
  const [targetOwner, setTargetOwner] = useState<string>("");
  const [isAssigning, setIsAssigning] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  // Fetch team members when target team changes
  useEffect(() => {
    const fetchTeamMembers = async () => {
      setIsLoadingMembers(true);
      setTargetOwner(""); // Reset owner when team changes
      
      try {
        // Get profiles for the selected team
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id, name, email, team")
          .eq("team", targetTeam);

        if (profilesError) throw profilesError;

        // Also get users by their role from user_roles table
        const { data: userRoles, error: rolesError } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("role", targetTeam);

        if (rolesError) throw rolesError;

        // Combine: get all profiles that match either by team or by role
        const roleUserIds = userRoles?.map(r => r.user_id) || [];
        const allProfiles = profiles || [];
        
        // Get additional profiles for users with roles but different team in profile
        if (roleUserIds.length > 0) {
          const { data: additionalProfiles } = await supabase
            .from("profiles")
            .select("id, name, email, team")
            .in("id", roleUserIds);
          
          if (additionalProfiles) {
            additionalProfiles.forEach(p => {
              if (!allProfiles.find(ap => ap.id === p.id)) {
                allProfiles.push({ ...p, team: targetTeam });
              }
            });
          }
        }

        setTeamMembers(allProfiles);
      } catch (error) {
        console.error("Error fetching team members:", error);
        setTeamMembers([]);
      } finally {
        setIsLoadingMembers(false);
      }
    };

    fetchTeamMembers();
  }, [targetTeam]);

  // Show all projects for assignment
  const assignableProjects = projects;

  const toggleProject = (projectId: string) => {
    setSelectedProjects((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      return newSet;
    });
  };

  const toggleAll = () => {
    if (selectedProjects.size === assignableProjects.length) {
      setSelectedProjects(new Set());
    } else {
      setSelectedProjects(new Set(assignableProjects.map((p) => p.id)));
    }
  };

  const handleAssign = async () => {
    if (selectedProjects.size === 0) {
      toast.error("Please select at least one project");
      return;
    }

    setIsAssigning(true);
    try {
      const projectIds = Array.from(selectedProjects);

      // Build update object
      const updateData: Record<string, any> = {
        current_owner_team: targetTeam,
        pending_acceptance: true,
        updated_at: new Date().toISOString(),
      };

      // Add assigned owner if selected
      if (targetOwner) {
        updateData.assigned_owner = targetOwner;
      }

      // Update projects
      const { error } = await supabase
        .from("projects")
        .update(updateData as never)
        .in("id", projectIds);

      if (error) throw error;

      // Refresh projects
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      
      const ownerName = teamMembers.find(m => m.id === targetOwner)?.name;

      // Send email notifications to assigned owner
      if (targetOwner) {
        const owner = teamMembers.find(m => m.id === targetOwner);
        if (owner) {
          const selectedProjectNames = assignableProjects
            .filter(p => selectedProjects.has(p.id))
            .map(p => p.merchantName);
          for (const name of selectedProjectNames) {
            sendNotification({
              type: "project_assignment",
              recipientEmail: owner.email,
              recipientName: owner.name,
              projectName: name,
              assignedBy: "Manager",
            });
          }
        }
      }

      const assignmentMsg = targetOwner 
        ? `Assigned ${selectedProjects.size} projects to ${ownerName} (${teamLabels[targetTeam]})`
        : `Assigned ${selectedProjects.size} projects to ${teamLabels[targetTeam]}`;
      
      toast.success(assignmentMsg);
      setSelectedProjects(new Set());
    } catch (error: any) {
      console.error("Assignment error:", error);
      toast.error("Failed to assign projects: " + error.message);
    } finally {
      setIsAssigning(false);
    }
  };

  // Get owner name for display
  const getOwnerName = (ownerId: string | undefined) => {
    if (!ownerId) return null;
    const owner = teamMembers.find(m => m.id === ownerId);
    return owner?.name;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5" />
          Assign Projects to Team
        </CardTitle>
        <CardDescription>
          Select projects and assign them to a team and specific owner
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Target Team, Owner & Actions */}
        <div className="flex flex-wrap items-center gap-4 p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Assign to:</span>
            <Select value={targetTeam} onValueChange={(v) => setTargetTeam(v as TeamRole)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mint">MINT (Presales)</SelectItem>
                <SelectItem value="integration">Integration Team</SelectItem>
                <SelectItem value="ms">Merchant Success</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Owner:</span>
          <Select 
            value={targetOwner || "none"} 
            onValueChange={(v) => setTargetOwner(v === "none" ? "" : v)}
            disabled={isLoadingMembers}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder={isLoadingMembers ? "Loading..." : "Select owner (optional)"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No specific owner</SelectItem>
              {teamMembers.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name} ({member.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>

          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Button
            onClick={handleAssign}
            disabled={selectedProjects.size === 0 || isAssigning}
            className="gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            {isAssigning ? "Assigning..." : `Assign ${selectedProjects.size} Selected`}
          </Button>
        </div>

        {/* Projects Table */}
        {assignableProjects.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No projects available for assignment</p>
          </div>
        ) : (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedProjects.size === assignableProjects.length && assignableProjects.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>MID</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Current Team</TableHead>
                  <TableHead>Assigned Owner</TableHead>
                  <TableHead>Phase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignableProjects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedProjects.has(project.id)}
                        onCheckedChange={() => toggleProject(project.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{project.merchantName}</TableCell>
                    <TableCell className="text-muted-foreground">{project.mid}</TableCell>
                    <TableCell>{project.platform || "-"}</TableCell>
                    <TableCell>
                      {project.currentOwnerTeam ? (
                        <Badge variant="outline">
                          {teamLabels[project.currentOwnerTeam]}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Unassigned</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {(project as any).assignedOwner ? (
                        <Badge variant="default" className="bg-primary/80">
                          <User className="h-3 w-3 mr-1" />
                          {getOwnerName((project as any).assignedOwner) || "Assigned"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{project.currentPhase || "mint"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
