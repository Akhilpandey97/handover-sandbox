import { useState } from "react";
import { Project } from "@/data/projectsData";
import { teamLabels } from "@/data/teams";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { XCircle } from "lucide-react";

interface RejectTransferDialogProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: (reason: string) => void;
}

export const RejectTransferDialog = ({
  project,
  open,
  onOpenChange,
  onReject,
}: RejectTransferDialogProps) => {
  const [reason, setReason] = useState("");

  const getPreviousTeam = () => {
    if (project.currentOwnerTeam === "integration") return "mint";
    if (project.currentOwnerTeam === "ms") return "integration";
    return null;
  };

  const previousTeam = getPreviousTeam();

  const handleReject = () => {
    if (!reason.trim()) return;
    onReject(reason.trim());
    setReason("");
    onOpenChange(false);
  };

  const handleClose = () => {
    setReason("");
    onOpenChange(false);
  };

  if (!previousTeam) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="h-5 w-5" />
            Reject KT / Transfer
          </DialogTitle>
          <DialogDescription>
            Reject <strong>{project.merchantName}</strong> and send it back to{" "}
            <strong>{teamLabels[previousTeam]}</strong> for corrections.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Rejection Reason (required)</Label>
            <Textarea
              id="reject-reason"
              placeholder="Explain what needs to be corrected before re-transfer..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={!reason.trim()}
          >
            <XCircle className="h-4 w-4 mr-2" />
            Reject & Send Back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
