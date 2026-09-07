import { useState } from "react";
import { apiAuthHeaders } from "@/lib/api-invoke";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

interface EmailReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSubject: string;
  htmlBody: string;
}

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export const EmailReportDialog = ({ open, onOpenChange, defaultSubject, htmlBody }: EmailReportDialogProps) => {
  const [emails, setEmails] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [sending, setSending] = useState(false);

  const addEmail = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const p of parts) {
      if (isValidEmail(p) && !emails.includes(p)) valid.push(p);
      else if (!isValidEmail(p)) invalid.push(p);
    }
    if (valid.length) setEmails(prev => [...prev, ...valid]);
    if (invalid.length) toast.error(`Invalid: ${invalid.join(", ")}`);
    setInput("");
  };

  const removeEmail = (e: string) => setEmails(prev => prev.filter(x => x !== e));

  const handleSend = async () => {
    if (emails.length === 0) {
      toast.error("Add at least one recipient");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(
        `/api/public/send-movement-report`,
        {
          method: "POST",
          headers: await apiAuthHeaders(),
          body: JSON.stringify({ recipients: emails, subject, html: htmlBody }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      toast.success(`Report sent to ${emails.length} recipient${emails.length > 1 ? "s" : ""}`);
      onOpenChange(false);
      setEmails([]);
    } catch (err: any) {
      toast.error(err.message || "Failed to send report");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Send Report
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <Label>Recipients</Label>
            <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-[42px]">
              {emails.map(e => (
                <Badge key={e} variant="secondary" className="gap-1">
                  {e}
                  <button onClick={() => removeEmail(e)} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addEmail(input);
                  } else if (e.key === "Backspace" && !input && emails.length) {
                    removeEmail(emails[emails.length - 1]);
                  }
                }}
                onBlur={() => input && addEmail(input)}
                placeholder={emails.length ? "" : "Enter emails, comma or Enter to add"}
                className="flex-1 min-w-[160px] bg-transparent outline-none text-sm"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || emails.length === 0}>
            {sending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</> : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
