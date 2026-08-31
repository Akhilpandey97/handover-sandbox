import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface FormTemplate {
  id: string;
  name: string;
  description: string | null;
  tenant_id: string | null;
}

export interface FormField {
  id: string;
  template_id: string;
  category: string;
  question: string;
  field_type: string;
  options: string[];
  is_required: boolean;
  sort_order: number;
}

export interface FormAssignment {
  id: string;
  checklist_template_id: string;
  form_template_id: string;
}

export interface FormResponse {
  field_id: string;
  value: string | null;
}

export const useFormTemplates = () => {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("checklist_form_templates")
      .select("*")
      .order("created_at", { ascending: true });
    if (!error && data) setTemplates(data as FormTemplate[]);
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  return { templates, isLoading, refetch: fetchTemplates };
};

export const useFormFields = (templateId: string | null) => {
  const [fields, setFields] = useState<FormField[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFields = useCallback(async () => {
    if (!templateId) { setFields([]); setIsLoading(false); return; }
    setIsLoading(true);
    const { data, error } = await supabase
      .from("checklist_form_fields")
      .select("*")
      .eq("template_id", templateId)
      .order("sort_order", { ascending: true });
    if (!error && data) {
      setFields(data.map((f: any) => ({
        ...f,
        options: Array.isArray(f.options) ? f.options : [],
      })));
    }
    setIsLoading(false);
  }, [templateId]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  return { fields, isLoading, refetch: fetchFields };
};

export const useFormAssignments = () => {
  const [assignments, setAssignments] = useState<FormAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAssignments = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("checklist_form_assignments")
      .select("*");
    if (!error && data) setAssignments(data as FormAssignment[]);
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  return { assignments, isLoading, refetch: fetchAssignments };
};

export const useFormResponses = (projectId: string | undefined, checklistItemId: string | undefined, formTemplateId: string | undefined) => {
  const { currentUser } = useAuth();
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !checklistItemId || !formTemplateId) { setIsLoading(false); return; }
    const fetch = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("checklist_form_responses")
        .select("field_id, value")
        .eq("project_id", projectId)
        .eq("checklist_item_id", checklistItemId)
        .eq("form_template_id", formTemplateId);
      if (!error && data) {
        const map: Record<string, string> = {};
        data.forEach((r: any) => { if (r.value) map[r.field_id] = r.value; });
        setResponses(map);
      }
      setIsLoading(false);
    };
    fetch();
  }, [projectId, checklistItemId, formTemplateId]);

  const saveResponses = useCallback(async (
    projectId: string,
    checklistItemId: string,
    formTemplateId: string,
    fieldValues: Record<string, string>
  ) => {
    const tenantId = currentUser?.tenantId || null;
    const entries = Object.entries(fieldValues).filter(([, v]) => v !== undefined);

    for (const [field_id, value] of entries) {
      const { data: existing } = await supabase
        .from("checklist_form_responses")
        .select("id")
        .eq("project_id", projectId)
        .eq("checklist_item_id", checklistItemId)
        .eq("field_id", field_id)
        .maybeSingle();

      if (existing) {
        await supabase.from("checklist_form_responses")
          .update({ value })
          .eq("id", existing.id);
      } else {
        await supabase.from("checklist_form_responses").insert({
          project_id: projectId,
          checklist_item_id: checklistItemId,
          form_template_id: formTemplateId,
          field_id,
          value,
          tenant_id: tenantId,
        });
      }
    }
  }, [currentUser?.tenantId]);

  return { responses, setResponses, isLoading, saveResponses };
};
