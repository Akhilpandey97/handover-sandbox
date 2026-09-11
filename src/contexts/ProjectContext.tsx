import React, { createContext, useContext, ReactNode } from "react";
import { Project, ResponsibilityParty } from "@/data/projectsData";
import { TeamRole } from "@/data/teams";
import { useAuth } from "./AuthContext";
import {
  useProjectsQuery,
  useAddProject,
  useUpdateProject,
  useDeleteProject,
  useArchiveProject,
  useAcceptProject,
  useTransferProject,
  useRejectProject,
  useUpdateChecklist,
  useUpdateChecklistComment,
  useToggleResponsibility,
  useToggleChecklistResponsibility,
} from "@/hooks/useProjects";

// Lets a caller add its own feedback once the mutation has actually settled, instead of
// assuming success the moment it is fired.
interface MutationCallbacks {
  onSuccess?: () => void;
}

interface ProjectContextType {
  projects: Project[];
  isLoading: boolean;
  addProject: (project: Project) => void;
  updateProject: (project: Project, callbacks?: MutationCallbacks) => void;
  deleteProject: (projectId: string) => void;
  archiveProject: (projectId: string, archive: boolean) => void;
  acceptProject: (projectId: string) => void;
  transferProject: (projectId: string, notes?: string, assigneeId?: string) => void;
  rejectProject: (projectId: string, reason: string) => void;
  updateChecklist: (projectId: string, checklistId: string, completed: boolean) => void;
  updateChecklistComment: (projectId: string, checklistId: string, comment: string) => void;
  toggleResponsibility: (projectId: string, party: ResponsibilityParty) => void;
  toggleChecklistResponsibility: (projectId: string, checklistId: string, party: ResponsibilityParty) => void;
  getProjectsForTeam: (team: TeamRole) => Project[];
  getPendingProjects: (team: TeamRole) => Project[];
  getActiveProjects: (team: TeamRole) => Project[];
  getCompletedProjects: (team: TeamRole) => Project[];
  getAllProjects: () => Project[];
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider = ({ children }: { children: ReactNode }) => {
  const { currentUser } = useAuth();
  const { data: projects = [], isLoading } = useProjectsQuery();
  
  const addProjectMutation = useAddProject();
  const updateProjectMutation = useUpdateProject();
  const deleteProjectMutation = useDeleteProject();
  const archiveProjectMutation = useArchiveProject();
  const acceptProjectMutation = useAcceptProject();
  const transferProjectMutation = useTransferProject();
  const rejectProjectMutation = useRejectProject();
  const updateChecklistMutation = useUpdateChecklist();
  const updateChecklistCommentMutation = useUpdateChecklistComment();
  const toggleResponsibilityMutation = useToggleResponsibility();
  const toggleChecklistResponsibilityMutation = useToggleChecklistResponsibility();

  const addProject = (project: Project) => {
    addProjectMutation.mutate(project);
  };

  const updateProject = (updatedProject: Project, callbacks?: MutationCallbacks) => {
    updateProjectMutation.mutate(updatedProject, { onSuccess: callbacks?.onSuccess });
  };

  const deleteProject = (projectId: string) => {
    deleteProjectMutation.mutate(projectId);
  };

  const archiveProject = (projectId: string, archive: boolean) => {
    archiveProjectMutation.mutate({ projectId, archive });
  };

  const acceptProject = (projectId: string) => {
    if (!currentUser) return;
    acceptProjectMutation.mutate(projectId);
  };

  const transferProject = (projectId: string, notes?: string, assigneeId?: string) => {
    if (!currentUser) return;
    transferProjectMutation.mutate({ projectId, notes, assigneeId });
  };

  const rejectProject = (projectId: string, reason: string) => {
    if (!currentUser) return;
    rejectProjectMutation.mutate({ projectId, reason });
  };

  const updateChecklist = (projectId: string, checklistId: string, completed: boolean) => {
    if (!currentUser) return;
    updateChecklistMutation.mutate({ projectId, checklistId, completed });
  };

  const updateChecklistComment = (projectId: string, checklistId: string, comment: string) => {
    if (!currentUser) return;
    updateChecklistCommentMutation.mutate({ checklistId, comment });
  };

  const toggleResponsibility = (projectId: string, newParty: ResponsibilityParty) => {
    const project = projects.find(p => p.id === projectId);
    if (!project || project.currentResponsibility === newParty) return;
    toggleResponsibilityMutation.mutate({ 
      projectId, 
      party: newParty,
      currentPhase: project.currentPhase,
    });
  };

  const toggleChecklistResponsibility = (projectId: string, checklistId: string, newParty: ResponsibilityParty) => {
    const project = projects.find(p => p.id === projectId);
    const checklist = project?.checklist.find(c => c.id === checklistId);
    if (!checklist || checklist.currentResponsibility === newParty) return;
    toggleChecklistResponsibilityMutation.mutate({ checklistId, party: newParty });
  };

  const getProjectsForTeam = (team: TeamRole) => {
    if (team === "manager") return projects;
    return projects.filter((p) => p.currentOwnerTeam === team);
  };

  const getPendingProjects = (team: TeamRole) => {
    if (team === "manager") return projects.filter((p) => p.pendingAcceptance);
    return projects.filter((p) => p.currentOwnerTeam === team && p.pendingAcceptance);
  };

  const getActiveProjects = (team: TeamRole) => {
    if (team === "manager") return projects.filter((p) => !p.pendingAcceptance && p.currentPhase !== "completed");
    return projects.filter((p) => p.currentOwnerTeam === team && !p.pendingAcceptance && p.currentPhase !== "completed");
  };

  const getCompletedProjects = (team: TeamRole) => {
    return projects.filter((p) => p.currentPhase === "completed");
  };

  const getAllProjects = () => projects;

  return (
    <ProjectContext.Provider
      value={{
        projects,
        isLoading,
        addProject,
        updateProject,
        deleteProject,
        archiveProject,
        acceptProject,
        transferProject,
        rejectProject,
        updateChecklist,
        updateChecklistComment,
        toggleResponsibility,
        toggleChecklistResponsibility,
        getProjectsForTeam,
        getPendingProjects,
        getActiveProjects,
        getCompletedProjects,
        getAllProjects,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
};

export const useProjects = () => {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProjects must be used within a ProjectProvider");
  }
  return context;
};
