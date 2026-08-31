import { useState } from "react";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Generates (or reuses) a shareable read-only customer portal link for a project.
 */
export const PortalLinkButton = ({ projectId }: { projectId: string }) => {
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  const buildLink = (token: string) => `${window.location.origin}/portal/${token}`;

  const generate = async () => {
    setIsWorking(true);
    try {
      const { data: existing } = await supabase
        .from("merchant_portal_tokens")
        .select("token")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.token) {
        setLink(buildLink(existing.token));
      } else {
        const { data, error } = await supabase
          .from("merchant_portal_tokens")
          .insert({
            project_id: projectId,
            tenant_id: currentUser?.tenantId || null,
            created_by: currentUser?.id || null,
          })
          .select("token")
          .single();
        if (error) throw error;
        setLink(buildLink(data.token));
      }
      setOpen(true);
    } catch (error) {
      console.error("Portal link error:", error);
      toast.error("Could not create the portal link");
    } finally {
      setIsWorking(false);
    }
  };

  const revoke = async () => {
    setIsWorking(true);
    const { error } = await supabase
      .from("merchant_portal_tokens")
      .update({ is_active: false })
      .eq("project_id", projectId)
      .eq("is_active", true);
    setIsWorking(false);
    if (error) {
      toast.error("Could not revoke the link");
      return;
    }
    setLink("");
    setOpen(false);
    toast.success("Portal link revoked");
  };

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 rounded-md px-3 text-sm font-semibold"
        onClick={generate}
        disabled={isWorking}
      >
        {isWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        Portal link
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Customer portal link</DialogTitle>
            <DialogDescription>
              Share this read-only page with the merchant. It shows live phase, go-live readiness and
              the checklist steps waiting on them — no login required.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" className="text-destructive" onClick={revoke} disabled={isWorking}>
              Revoke link
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PortalLinkButton;
