import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Mail, Sparkles, Loader2 } from "lucide-react";
import { Project, createDefaultChecklist } from "@/data/projectsData";
import { useProjects } from "@/contexts/ProjectContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

// Project fields that can receive mapped values
const PROJECT_FIELDS = [
  { key: "merchantName", label: "Merchant Name", type: "text" },
  { key: "mid", label: "MID", type: "text" },
  { key: "platform", label: "Platform", type: "text" },
  { key: "arr", label: "ARR", type: "number" },
  { key: "txnsPerDay", label: "Txns/Day", type: "number" },
  { key: "aov", label: "AOV", type: "number" },
  { key: "category", label: "Category", type: "text" },
  { key: "salesSpoc", label: "Sales SPOC", type: "text" },
  { key: "integrationType", label: "Integration Type", type: "text" },
  { key: "pgOnboarding", label: "PG Onboarding", type: "text" },
  { key: "brandUrl", label: "Brand URL", type: "text" },
  { key: "projectNotes", label: "Project Notes", type: "text" },
] as const;

function getAllEmailFields(email: ParsedEmail): { key: string; label: string; value: string }[] {
  const fields: { key: string; label: string; value: string }[] = [];
  
  // Standard fields
  const standardFields: { key: keyof ParsedEmail; label: string }[] = [
    { key: "brand_name", label: "Brand Name" },
    { key: "brand_url", label: "Brand URL" },
    { key: "platform", label: "Platform" },
    { key: "sub_platform", label: "Sub Platform" },
    { key: "arr", label: "ARR" },
    { key: "category", label: "Category" },
    { key: "txns_per_day", label: "Txns/Day" },
    { key: "aov", label: "AOV" },
    { key: "merchant_size", label: "Merchant Size" },
    { key: "city", label: "City" },
    { key: "sales_notes", label: "Sales Notes" },
  ];

  standardFields.forEach(f => {
    const val = email[f.key];
    if (val !== null && val !== undefined && String(val).trim() !== "") {
      let displayValue = String(val);
      // ARR comes in raw rupees from email; project field stores Crores
      if (f.key === "arr" && typeof val === "number") {
        displayValue = (val / 10000000).toFixed(2);
      }
      fields.push({ key: f.key, label: f.label, value: displayValue });
    }
  });

  // Dynamic parsed_fields
  if (email.parsed_fields) {
    Object.entries(email.parsed_fields).forEach(([key, value]) => {
      if (value && !standardFields.some(sf => sf.key === key)) {
        fields.push({ key: `parsed_${key}`, label: key, value: String(value) });
      }
    });
  }

  return fields;
}

interface EmailToProjectDialogProps {
  email: ParsedEmail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreated: () => void;
}

export const EmailToProjectDialog = ({ email, open, onOpenChange, onProjectCreated }: EmailToProjectDialogProps) => {
  const { addProject } = useProjects();
  const { currentUser } = useAuth();

  const emailFields = getAllEmailFields(email);

  // Mapping: emailFieldKey -> projectFieldKey
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMapped, setAiMapped] = useState(false);

  const updateMapping = (emailKey: string, projectKey: string) => {
    setMapping(prev => ({ ...prev, [emailKey]: projectKey }));
  };

  // AI auto-mapping
  const handleAiMap = async () => {
    setAiLoading(true);
    try {
      // Build indexed entries for unambiguous mapping
      const emailFieldEntries = emailFields.map((f, i) => ({
        id: `field_${i}`,
        label: f.label,
        value: f.value,
        originalKey: f.key,
      }));

      // Build simple, clear prompt lines
      const emailFieldsText = emailFieldEntries
        .map(e => `${e.id}: "${e.label}" = "${e.value}"`)
        .join("\n");
      const projectFieldsText = PROJECT_FIELDS
        .map(f => `${f.key}: "${f.label}"`)
        .join("\n");

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const res = await fetch(`/api/public/ai-project-insights`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          type: "map_email_fields",
          emailFields: emailFieldsText,
          projectFields: projectFieldsText,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `AI request failed: ${res.status}`);
      }
      const data = await res.json();

      const result = data?.result;
      if (result && typeof result === "object") {
        const newMapping: Record<string, string> = {};
        
        // Build a lookup from field_N -> originalKey
        const idToKey = new Map(emailFieldEntries.map(e => [e.id, e.originalKey]));
        const labelToKey = new Map(emailFieldEntries.map(e => [e.label.toLowerCase(), e.originalKey]));
        const origToKey = new Map(emailFieldEntries.map(e => [e.originalKey, e.originalKey]));

        for (const [returnedKey, projectKey] of Object.entries(result)) {
          if (typeof projectKey !== "string" || projectKey === "skip" || projectKey === "none") continue;
          if (!PROJECT_FIELDS.some(pf => pf.key === projectKey)) continue;

          // Try multiple match strategies
          const originalKey = 
            idToKey.get(returnedKey) ||                           // field_0, field_1, etc
            origToKey.get(returnedKey) ||                         // direct key match
            labelToKey.get(returnedKey.toLowerCase()) ||          // label match
            idToKey.get(returnedKey.replace(/[^a-z0-9_]/gi, "")); // cleaned match

          if (originalKey) {
            newMapping[originalKey] = projectKey;
          }
        }

        setMapping(newMapping);
        setAiMapped(true);
        if (Object.keys(newMapping).length > 0) {
          toast.success(`AI mapped ${Object.keys(newMapping).length} fields successfully`);
        } else {
          toast.warning("AI couldn't find matching fields. Please map manually.");
        }
      } else {
        toast.warning("AI returned empty mapping. Please map manually.");
      }
    } catch (e: any) {
      console.error("AI mapping error:", e);
      toast.error(e.message || "AI mapping failed");
    } finally {
      setAiLoading(false);
    }
  };

  // Compute final value for a project field
  const getFinalValue = (projectKey: string): string => {
    if (overrides[projectKey] !== undefined) return overrides[projectKey];
    for (const [eKey, pKey] of Object.entries(mapping)) {
      if (pKey === projectKey) {
        const field = emailFields.find(f => f.key === eKey);
        return field?.value || "";
      }
    }
    return "";
  };

  const handleCreate = async () => {
    const merchantName = getFinalValue("merchantName");
    if (!merchantName) {
      toast.error("Merchant Name is required");
      return;
    }

    const newProject: Project = {
      id: crypto.randomUUID(),
      merchantName,
      mid: getFinalValue("mid") || `EMAIL-${email.gmail_message_id.substring(0, 8)}`,
      currentPhase: "mint",
      currentOwnerTeam: "mint",
      arr: Number(getFinalValue("arr")) || 0,
      txnsPerDay: Number(getFinalValue("txnsPerDay")) || 0,
      aov: Number(getFinalValue("aov")) || 0,
      platform: getFinalValue("platform") || "Custom",
      integrationType: getFinalValue("integrationType") || "Standard",
      salesSpoc: getFinalValue("salesSpoc") || "",
      category: getFinalValue("category") || "",
      pgOnboarding: getFinalValue("pgOnboarding") || "",
      currentResponsibility: "neutral",
      pendingAcceptance: false,
      projectState: "not_started",
      goLivePercent: 0,
      dates: {
        kickOffDate: new Date().toISOString().split("T")[0],
        expectedGoLiveDate: undefined,
        goLiveDate: undefined,
      },
      links: {
        brandUrl: getFinalValue("brandUrl") || "",
        jiraLink: "",
        brdLink: "",
        mintChecklistLink: "",
        integrationChecklistLink: "",
      },
      notes: {
        mintNotes: "",
        projectNotes: getFinalValue("projectNotes") || "",
        currentPhaseComment: "Created from email — needs manager review",
        phase2Comment: "",
      },
      checklist: createDefaultChecklist(),
      transferHistory: [],
      responsibilityLog: [{
        id: `r-${Date.now()}`,
        party: "gokwik" as const,
        startedAt: new Date().toISOString(),
        phase: "mint" as const,
      }],
      assignedOwner: undefined,
      assignedOwnerName: undefined,
    };

    addProject(newProject);

    await supabase
      .from("parsed_emails")
      .update({ status: "project_created" })
      .eq("id", email.id);

    toast.success(`Project "${merchantName}" created — assign an owner from Projects tab`);
    onOpenChange(false);
    onProjectCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Map Email to Project — {email.brand_name || "Untitled"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="space-y-5">
            {/* AI Auto-Map Button */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleAiMap}
                disabled={aiLoading}
              >
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {aiLoading ? "AI Mapping…" : "Auto-Map with AI"}
              </Button>
              {aiMapped && <Badge variant="secondary" className="text-micro">AI mapped</Badge>}
            </div>

            {/* Field Mapping Section */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Field Mapping</h4>
              <div className="border rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr,auto,1fr,1fr] gap-0 text-xs font-medium text-muted-foreground bg-muted/50 px-3 py-2 border-b">
                  <span>Email Field</span>
                  <span></span>
                  <span>Maps To</span>
                  <span>Value</span>
                </div>
                {emailFields.map(ef => {
                  const mappedTo = mapping[ef.key] || "";
                  return (
                    <div key={ef.key} className="grid grid-cols-[1fr,auto,1fr,1fr] gap-2 items-center px-3 py-2 border-b last:border-b-0 hover:bg-muted/20">
                      <div className="text-sm">
                        <span className="font-medium">{ef.label}</span>
                        {ef.value && (
                          <Badge variant="secondary" className="ml-2 text-micro px-1.5 py-0 max-w-[120px] truncate">
                            {ef.value}
                          </Badge>
                        )}
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <Select value={mappedTo || "__skip__"} onValueChange={(v) => updateMapping(ef.key, v === "__skip__" ? "" : v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Skip" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__skip__">Skip</SelectItem>
                          {PROJECT_FIELDS.map(pf => (
                            <SelectItem key={pf.key} value={pf.key}>{pf.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground truncate">
                        {mappedTo ? ef.value || "—" : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Project Field Overrides */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Review & Override Project Fields</h4>
              <div className="grid grid-cols-2 gap-3">
                {PROJECT_FIELDS.map(pf => {
                  const val = overrides[pf.key] !== undefined ? overrides[pf.key] : getFinalValue(pf.key);
                  return (
                    <div key={pf.key}>
                      <Label className="text-xs text-muted-foreground">{pf.label}</Label>
                      <Input
                        className="h-8 text-sm mt-0.5"
                        type={pf.type === "number" ? "number" : "text"}
                        value={val}
                        onChange={e => setOverrides(prev => ({ ...prev, [pf.key]: e.target.value }))}
                        placeholder={pf.label}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate}>Create Project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
