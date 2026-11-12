import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { tenantScope } from "@/lib/tenant-scope";

export interface ChecklistSet {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ChecklistSetRule {
  id: string;
  checklist_set_id: string;
  field: string;
  operator: string;
  value: string;
  sort_order: number;
}

export interface ChecklistTemplate {
  id: string;
  checklist_set_id: string | null;
  tenant_id: string | null;
  title: string;
  owner_team: string;
  standard_duration: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const RULE_FIELDS = [
  { value: "platform", label: "Platform" },
  { value: "category", label: "Category" },
  { value: "integration_type", label: "Integration Type" },
  { value: "pg_onboarding", label: "PG Onboarding" },
] as const;

export const RULE_OPERATORS = [
  { value: "eq", label: "is" },
  { value: "not_eq", label: "is not" },
  { value: "in", label: "is one of" },
] as const;

export const STAGE_SLUGS = ["mint", "integration", "ms", "completed"] as const;
export const TEAM_SLUGS = ["mint", "integration", "ms"] as const;

export type StageSlugs = typeof STAGE_SLUGS[number];
export type TeamSlugs = typeof TEAM_SLUGS[number];

export function getStageOptions(stageLabels: Record<string, string>) {
  return STAGE_SLUGS.map((v) => ({ value: v, label: stageLabels[v] || v }));
}

export function getTeamOptions(teamLabels: Record<string, string>) {
  return TEAM_SLUGS.map((v) => ({ value: v, label: teamLabels[v] || v }));
}

/** @deprecated use getStageOptions(stageLabels) for dynamic labels */
export const STAGE_OPTIONS = STAGE_SLUGS.map((v) => ({ value: v, label: v }));
/** @deprecated use getTeamOptions(teamLabels) for dynamic labels */
export const TEAM_OPTIONS = TEAM_SLUGS.map((v) => ({ value: v, label: v }));

export const useChecklistSets = () => {
  const { currentUser } = useAuth();
  const tenantId = tenantScope(currentUser?.tenantId);
  const [sets, setSets] = useState<ChecklistSet[]>([]);
  const [rules, setRules] = useState<ChecklistSetRule[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    const [setsRes, rulesRes, templatesRes] = await Promise.all([
      supabase.from("checklist_sets").select("*").eq("tenant_id", tenantId).order("sort_order"),
      supabase
        .from("checklist_set_rules")
        .select("*, checklist_sets!inner(tenant_id)")
        .eq("checklist_sets.tenant_id", tenantId)
        .order("sort_order"),
      supabase
        .from("checklist_templates")
        .select("*")
        .eq("tenant_id", tenantId)
        .not("checklist_set_id", "is", null)
        .order("sort_order"),
    ]);
    if (!setsRes.error && setsRes.data) setSets(setsRes.data as ChecklistSet[]);
    if (!rulesRes.error && rulesRes.data) setRules(rulesRes.data as ChecklistSetRule[]);
    if (!templatesRes.error && templatesRes.data)
      setTemplates(templatesRes.data as ChecklistTemplate[]);
    setIsLoading(false);
  }, [tenantId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const createSet = useCallback(
    async (name: string, description?: string) => {
      const maxOrder = sets.reduce((m, s) => Math.max(m, s.sort_order), -1);
      const isFirst = sets.length === 0;
      const { data, error } = await supabase
        .from("checklist_sets")
        .insert({
          tenant_id: tenantId,
          name,
          description: description ?? null,
          is_default: isFirst,
          sort_order: maxOrder + 1,
        })
        .select()
        .single();
      if (!error && data) {
        setSets((prev) => [...prev, data as ChecklistSet]);
        return data as ChecklistSet;
      }
      return null;
    },
    [sets, tenantId],
  );

  const updateSet = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ChecklistSet, "name" | "description" | "is_default" | "sort_order">>,
    ) => {
      const updates = { ...patch, updated_at: new Date().toISOString() };
      // When marking a set as default, clear other defaults first
      if (patch.is_default) {
        await supabase
          .from("checklist_sets")
          .update({ is_default: false })
          .eq("tenant_id", tenantId)
          .neq("id", id);
      }
      const { error } = await supabase.from("checklist_sets").update(updates).eq("id", id);
      if (!error) await fetchAll();
    },
    [tenantId, fetchAll],
  );

  const deleteSet = useCallback(async (id: string) => {
    const { error } = await supabase.from("checklist_sets").delete().eq("id", id);
    if (!error) {
      setSets((prev) => prev.filter((s) => s.id !== id));
      setRules((prev) => prev.filter((r) => r.checklist_set_id !== id));
    }
  }, []);

  const addRule = useCallback(
    async (setId: string, field: string, operator: string, value: string) => {
      const existing = rules.filter((r) => r.checklist_set_id === setId);
      const maxOrder = existing.reduce((m, r) => Math.max(m, r.sort_order), -1);
      const { data, error } = await supabase
        .from("checklist_set_rules")
        .insert({ checklist_set_id: setId, field, operator, value, sort_order: maxOrder + 1 })
        .select()
        .single();
      if (!error && data) setRules((prev) => [...prev, data as ChecklistSetRule]);
    },
    [rules],
  );

  const updateRule = useCallback(
    async (id: string, patch: Partial<Pick<ChecklistSetRule, "field" | "operator" | "value">>) => {
      const { error } = await supabase.from("checklist_set_rules").update(patch).eq("id", id);
      if (!error) setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [],
  );

  const deleteRule = useCallback(async (id: string) => {
    const { error } = await supabase.from("checklist_set_rules").delete().eq("id", id);
    if (!error) setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addTemplate = useCallback(
    async (
      setId: string,
      title: string,
      ownerTeam: string,
      standardDuration?: number | null,
    ) => {
      const existing = templates.filter((t) => t.checklist_set_id === setId);
      const maxOrder = existing.reduce((m, t) => Math.max(m, t.sort_order), -1);
      const { data, error } = await supabase
        .from("checklist_templates")
        .insert({
          tenant_id: tenantId,
          checklist_set_id: setId,
          title,
          stage: ownerTeam,
          owner_team: ownerTeam,
          standard_duration: standardDuration ?? null,
          sort_order: maxOrder + 1,
        })
        .select()
        .single();
      if (!error && data) setTemplates((prev) => [...prev, data as ChecklistTemplate]);
    },
    [templates, tenantId],
  );

  const updateTemplate = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<ChecklistTemplate, "title" | "owner_team" | "standard_duration">
      >,
    ) => {
      const updates = { ...patch, updated_at: new Date().toISOString() };
      const { error } = await supabase.from("checklist_templates").update(updates).eq("id", id);
      if (!error) setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    },
    [],
  );

  const deleteTemplate = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("checklist_templates")
      .update({ checklist_set_id: null })
      .eq("id", id);
    if (!error) setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    sets,
    rules,
    templates,
    isLoading,
    refresh: fetchAll,
    createSet,
    updateSet,
    deleteSet,
    addRule,
    updateRule,
    deleteRule,
    addTemplate,
    updateTemplate,
    deleteTemplate,
  };
};
