import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ProjectWorkspaceView } from "@/pages/ProjectWorkspace";
import type { Project } from "@/data/projectsData";

/**
 * A project in a dialog — the same page you get at /projects/:id.
 *
 * Replaces a separate read-only details dialog that showed the same record in a
 * different layout: two surfaces meant every change had to be made twice, and
 * they had drifted apart.
 */
export const ProjectDialog = ({
  project,
  open,
  onOpenChange,
  projectIds,
  onNavigate,
}: {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sibling projects, for previous/next inside the dialog. */
  projectIds?: string[];
  onNavigate?: (projectId: string) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="h-[92vh] max-w-[1400px] gap-0 overflow-hidden p-0">
      <DialogTitle className="sr-only">{project?.merchantName || "Project"}</DialogTitle>
      {project && open ? (
        <ProjectWorkspaceView
          projectId={project.id}
          inModal
          onClose={() => onOpenChange(false)}
          projectIds={projectIds}
          onNavigate={onNavigate}
        />
      ) : null}
    </DialogContent>
  </Dialog>
);
