import { Project } from "@/data/projectsData";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLabels } from "@/contexts/LabelsContext";
import { useNavigate } from "@tanstack/react-router";

interface Props {
  title: string;
  description?: string;
  projects: Project[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ProjectListDialog = ({ title, description, projects, open, onOpenChange }: Props) => {
  const { teamLabels, stateLabels } = useLabels();
  const navigate = useNavigate();
  const list = projects || [];
  const totalArr = list.reduce((s, p) => s + (p.arr || 0), 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {description ? `${description} · ` : ""}
              {list.length} project{list.length === 1 ? "" : "s"} · {totalArr.toFixed(2)} Cr ARR
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">No projects in this segment.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Merchant</TableHead>
                    <TableHead>MID</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Owner Team</TableHead>
                    <TableHead className="text-right">ARR (Cr)</TableHead>
                    <TableHead>Expected Go-Live</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => { onOpenChange(false); navigate({ to: "/projects/$projectId", params: { projectId: p.id } }); }}>
                      <TableCell className="font-medium">{p.merchantName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.mid}</TableCell>
                      <TableCell className="text-sm">{stateLabels[p.projectState] || p.projectState}</TableCell>
                      <TableCell className="text-sm">{teamLabels[p.currentOwnerTeam] || p.currentOwnerTeam}</TableCell>
                      <TableCell className="text-right font-semibold">{(p.arr || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-sm">{p.dates.expectedGoLiveDate || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
};
