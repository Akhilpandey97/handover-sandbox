import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tenantScope } from "@/lib/tenant-scope";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTeams } from "@/hooks/useTeams";
import { useLabels } from "@/contexts/LabelsContext";
import { projectStateLabels } from "@/data/projectsData";
import { WORKFLOW_EVENTS, WORKFLOW_FIELDS, WORKFLOW_FREQUENCIES } from "@/data/workflowConfig";

/**
 * Typed editors for a workflow's trigger and action config.
 *
 * These were raw JSON textareas, which meant a workflow could be saved with a
 * misspelt key, an owner id that belongs to nobody, or a field name the action
 * cannot write — all of which look fine until the workflow silently does
 * nothing. Every value here comes from a list, so the config can only be
 * shaped the way the runtime expects.
 */

export type ConfigValue = Record<string, unknown>;

const useProfiles = () => {
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string; team: string | null }>>([]);
  useEffect(() => {
    let cancelled = false;
    supabase.from("profiles").select("id, name, team").eq("tenant_id", tenantId).order("name").then(({ data }) => {
      if (!cancelled) setProfiles((data || []) as typeof profiles);
    });
    return () => { cancelled = true; };
  }, [tenantId]);
  return profiles;
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
    {children}
  </div>
);

export const TriggerConfigFields = ({
  triggerType, value, onChange,
}: { triggerType: string; value: ConfigValue; onChange: (v: ConfigValue) => void }) => {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const str = (k: string) => (typeof value[k] === "string" ? (value[k] as string) : "");

  if (triggerType === "event") {
    return (
      <div className="space-y-3">
        <Field label="When this happens">
          <Select value={str("event_name")} onValueChange={(v) => onChange({ event_name: v })}>
            <SelectTrigger><SelectValue placeholder="Choose an event" /></SelectTrigger>
            <SelectContent>
              {WORKFLOW_EVENTS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {str("event_name") === "checklist_completed" && (
          <Field label="Only for steps named (optional)">
            <Input value={str("checklist_title")} onChange={(e) => set("checklist_title", e.target.value)} placeholder="Any step, or part of a name like “Go-live”" />
          </Field>
        )}
        {str("event_name") === "go_live_date_passed" && (
          <p className="text-xs text-muted-foreground">Checked every 10 minutes. Runs once per project for each expected go-live date that passes before the project is live.</p>
        )}
      </div>
    );
  }

  if (triggerType === "field_change") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="When this field changes">
          <Select value={str("field")} onValueChange={(v) => set("field", v)}>
            <SelectTrigger><SelectValue placeholder="Choose a field" /></SelectTrigger>
            <SelectContent>
              {WORKFLOW_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="To this value (optional)">
          {str("field") === "project_state" ? (
            <Select value={str("to_value")} onValueChange={(v) => set("to_value", v)}>
              <SelectTrigger><SelectValue placeholder="Any value" /></SelectTrigger>
              <SelectContent>
                {Object.entries(projectStateLabels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input value={str("to_value")} onChange={(e) => set("to_value", e.target.value)} placeholder="Any value" />
          )}
        </Field>
      </div>
    );
  }

  if (triggerType === "time_based") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Check">
          <Select value={str("frequency") || "daily"} onValueChange={(v) => set("frequency", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {WORKFLOW_FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="When a project has been in its state for (days)">
          <Input
            type="number"
            min={0}
            value={typeof value.days_in_state === "number" ? String(value.days_in_state) : ""}
            onChange={(e) => set("days_in_state", e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder="e.g. 3"
          />
        </Field>
        <Field label="Only projects in state">
          <Select value={str("project_state") || "any"} onValueChange={(v) => set("project_state", v === "any" ? undefined : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any state except live</SelectItem>
              {Object.entries(projectStateLabels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <p className="col-span-2 text-xs text-muted-foreground">
          Checked every 10 minutes. Runs when a project reaches this many days in its state, then again each check period while it stays there.
        </p>
      </div>
    );
  }

  return (
    <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      A manual workflow runs only when someone asks. Ask Buddy, for example “Run this workflow on BrewCraft and Planwise”.
    </p>
  );
};

export const ActionConfigFields = ({
  actionType, value, onChange,
}: { actionType: string; value: ConfigValue; onChange: (v: ConfigValue) => void }) => {
  const profiles = useProfiles();
  const { allTeams } = useTeams();
  const { getLabel } = useLabels();
  const set = (patch: ConfigValue) => onChange({ ...value, ...patch });
  const str = (k: string) => (typeof value[k] === "string" ? (value[k] as string) : "");

  if (actionType === "assign_owner") {
    return (
      <Field label={getLabel("field_assigned_owner")}>
        <Select
          value={str("owner_id")}
          onValueChange={(v) => {
            // Store the name alongside the id: the activity log reads it, and
            // it keeps the entry legible if the profile is later removed.
            const p = profiles.find((x) => x.id === v);
            set({ owner_id: v, owner_name: p?.name || "" });
          }}
        >
          <SelectTrigger><SelectValue placeholder="Choose a person" /></SelectTrigger>
          <SelectContent>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  if (actionType === "transfer_project") {
    return (
      <Field label="Transfer to team">
        <Select value={str("to_team")} onValueChange={(v) => set({ to_team: v })}>
          <SelectTrigger><SelectValue placeholder="Choose a team" /></SelectTrigger>
          <SelectContent>
            {allTeams.map((t) => <SelectItem key={t.slug} value={t.slug}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  if (actionType === "update_field") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Set this field">
          <Select value={str("field")} onValueChange={(v) => set({ field: v, value: "" })}>
            <SelectTrigger><SelectValue placeholder="Choose a field" /></SelectTrigger>
            <SelectContent>
              {WORKFLOW_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="To">
          {str("field") === "project_state" ? (
            <Select value={str("value")} onValueChange={(v) => set({ value: v })}>
              <SelectTrigger><SelectValue placeholder="Choose a value" /></SelectTrigger>
              <SelectContent>
                {Object.entries(projectStateLabels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : str("field") === "current_owner_team" ? (
            <Select value={str("value")} onValueChange={(v) => set({ value: v })}>
              <SelectTrigger><SelectValue placeholder="Choose a team" /></SelectTrigger>
              <SelectContent>
                {allTeams.map((t) => <SelectItem key={t.slug} value={t.slug}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : str("field") === "assigned_owner" ? (
            <Select value={str("value")} onValueChange={(v) => set({ value: v })}>
              <SelectTrigger><SelectValue placeholder="Choose a person" /></SelectTrigger>
              <SelectContent>
                {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input value={str("value")} onChange={(e) => set({ value: e.target.value })} placeholder="New value" />
          )}
        </Field>
      </div>
    );
  }

  if (actionType === "send_notification") {
    return (
      <div className="space-y-3">
        <Field label="Notify">
          <Select value={str("recipient") || "assigned_owner"} onValueChange={(v) => set({ recipient: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="assigned_owner">The project's assigned owner</SelectItem>
              <SelectItem value="managers">All managers</SelectItem>
              {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Message">
          <Input value={str("message")} onChange={(e) => set({ message: e.target.value })} placeholder="What should the notification say?" />
        </Field>
      </div>
    );
  }

  return null;
};
