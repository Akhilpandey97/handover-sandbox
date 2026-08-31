import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useProjects } from "@/contexts/ProjectContext";
import { useLabels } from "@/contexts/LabelsContext";
import { supabase } from "@/integrations/supabase/client";
import { Project, createDefaultChecklist } from "@/data/projectsData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Mail, RefreshCw, Plus, Eye, CheckCircle2, X, Loader2, Inbox } from "lucide-react";
import { format } from "date-fns";
import { EmailToProjectDialog } from "./EmailToProjectDialog";


interface ParsedEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  sender: string;
  received_at: string;
  brand_name: string | null;
  brand_url: string | null;
  platform: string | null;
  sub_platform: string | null;
  arr: number | null;
  category: string | null;
  txns_per_day: number | null;
  aov: number | null;
  merchant_size: string | null;
  city: string | null;
  sales_notes: string | null;
  parsed_fields: Record<string, string> | null;
  status: string;
  project_id: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-600 border-blue-200",
  reviewed: "bg-amber-500/10 text-amber-600 border-amber-200",
  project_created: "bg-green-500/10 text-green-600 border-green-200",
  dismissed: "bg-muted text-muted-foreground border-muted",
};

export const ParsedEmailsTab = () => {
  const { currentUser } = useAuth();
  const { addProject, projects } = useProjects();
  const { labels } = useLabels();
  const [emails, setEmails] = useState<ParsedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  
  const [selectedEmail, setSelectedEmail] = useState<ParsedEmail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [mappingEmail, setMappingEmail] = useState<ParsedEmail | null>(null);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("parsed_emails")
      .select("*")
      .order("received_at", { ascending: false });
    if (!error && data) {
      setEmails(data as unknown as ParsedEmail[]);
    }
    setLoading(false);
  }, []);






  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const handlePollEmails = async () => {
    if (!currentUser?.tenantId) {
      toast.error("No tenant context available");
      return;
    }
    setPolling(true);
    try {
      const url = `/api/public/poll-emails`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ tenant_id: currentUser.tenantId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Email poll complete");
        await fetchEmails();
      } else {
        toast.error(data.error || "Failed to poll emails");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to poll emails");
    } finally {
      setPolling(false);
    }
  };

  const handleCreateProject = (email: ParsedEmail) => {
    setMappingEmail(email);
  };

  const handleDismiss = async (emailId: string) => {
    await supabase
      .from("parsed_emails")
      .update({ status: "dismissed" })
      .eq("id", emailId);
    toast.info("Email dismissed");
    await fetchEmails();
  };

  const openDetail = (email: ParsedEmail) => {
    setSelectedEmail(email);
    setDetailOpen(true);
  };

  const newCount = emails.filter((e) => e.status === "new").length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Parsed Emails
                {newCount > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {newCount} new
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                New emails are automatically deduplicated, added as projects, and round-robin assigned to MINT owners.
              </CardDescription>

            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handlePollEmails}
                disabled={polling}
                size="sm"
                className="gap-1.5"
              >
                {polling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {polling ? "Polling..." : "Poll Gmail"}
              </Button>
            </div>

          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Inbox className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">No parsed emails yet.</p>
              <p className="text-sm text-muted-foreground/70">Click "Poll Gmail" to check for new matching emails.</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead>Brand Name</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">ARR</TableHead>
                    <TableHead className="text-right">Txns/Day</TableHead>
                    <TableHead className="text-right">AOV</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emails.map((email) => (
                    <TableRow key={email.id} className={email.status === "new" ? "bg-blue-500/5" : ""}>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[email.status] || ""}>
                          {email.status === "project_created" ? "Created" : email.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {email.brand_name || "—"}
                        {email.city && (
                          <span className="text-xs text-muted-foreground ml-1">({email.city})</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {email.platform || "—"}
                        {email.sub_platform && email.sub_platform !== email.platform && (
                          <span className="text-xs text-muted-foreground ml-1">/ {email.sub_platform}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {email.arr ? `₹${(email.arr / 100000).toFixed(1)}L` : "—"}
                      </TableCell>
                      <TableCell className="text-right">{email.txns_per_day || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {email.aov ? `₹${email.aov.toFixed(0)}` : "—"}
                      </TableCell>
                      <TableCell>{email.category || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(email.received_at), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openDetail(email)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {email.status === "new" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                                onClick={() => handleCreateProject(email)}
                                title="Create Project"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDismiss(email.id)}
                                title="Dismiss"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          {email.status === "project_created" && (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {selectedEmail?.brand_name || "Email Details"}
            </DialogTitle>
          </DialogHeader>
          {selectedEmail && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Subject</p>
                    <p className="text-sm font-medium">{selectedEmail.subject}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Sender</p>
                    <p className="text-sm">{selectedEmail.sender}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Received</p>
                    <p className="text-sm">{format(new Date(selectedEmail.received_at), "dd MMM yyyy, HH:mm")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge variant="outline" className={statusColors[selectedEmail.status] || ""}>
                      {selectedEmail.status}
                    </Badge>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <h4 className="text-sm font-semibold mb-2">Parsed Fields</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedEmail.parsed_fields &&
                      Object.entries(selectedEmail.parsed_fields).map(([key, value]) => (
                        <div key={key} className="bg-muted/50 rounded-md p-2">
                          <p className="text-xs text-muted-foreground">{key}</p>
                          <p className="text-sm">{value || "—"}</p>
                        </div>
                      ))}
                  </div>
                </div>

                {selectedEmail.sales_notes && (
                  <div className="border-t pt-3">
                    <h4 className="text-sm font-semibold mb-2">Notes</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                      {selectedEmail.sales_notes}
                    </p>
                  </div>
                )}

                {selectedEmail.status === "new" && (
                  <div className="border-t pt-3 flex gap-2">
                    <Button
                      onClick={() => {
                        handleCreateProject(selectedEmail);
                        setDetailOpen(false);
                      }}
                      className="gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      Create Project
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        handleDismiss(selectedEmail.id);
                        setDetailOpen(false);
                      }}
                    >
                      <X className="h-4 w-4 mr-1.5" />
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
      {/* Email to Project Mapping Dialog */}
      {mappingEmail && (
        <EmailToProjectDialog
          email={mappingEmail}
          open={!!mappingEmail}
          onOpenChange={(open) => { if (!open) setMappingEmail(null); }}
          onProjectCreated={() => {
            setMappingEmail(null);
            fetchEmails();
          }}
        />
      )}
    </div>
  );
};
