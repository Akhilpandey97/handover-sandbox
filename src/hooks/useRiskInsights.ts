import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Project } from "@/data/projectsData";
import { RiskVerdict, findingsHash } from "@/data/riskRules";

export interface RiskInsight {
  project_id: string;
  findings_hash: string;
  why: string;
  recommendation: string;
  generated_at: string;
}

/**
 * Cached AI explanations. The verdict and its reasons are deterministic and
 * always available, so nothing here ever gates the risk badge — this only adds
 * prose on top.
 */
export const useRiskInsights = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId || null;
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: insights = {} } = useQuery({
    queryKey: ["project_risk_insights", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, RiskInsight>> => {
      const { data, error } = await supabase
        .from("project_risk_insights" as never)
        .select("project_id, findings_hash, why, recommendation, generated_at");
      if (error) throw error;
      const map: Record<string, RiskInsight> = {};
      for (const row of (data || []) as unknown as RiskInsight[]) map[row.project_id] = row;
      return map;
    },
  });

  /** A cached explanation is only valid while the findings that produced it hold. */
  const insightFor = useCallback(
    (projectId: string, verdict: RiskVerdict): RiskInsight | null => {
      const cached = insights[projectId];
      if (!cached) return null;
      return cached.findings_hash === findingsHash(verdict) ? cached : null;
    },
    [insights],
  );

  const generate = useCallback(
    async (projects: Project[], verdicts: Record<string, RiskVerdict>) => {
      const stale = projects.filter((p) => {
        const v = verdicts[p.id];
        return v && v.level === "high" && !insightFor(p.id, v);
      });
      if (stale.length === 0) {
        toast.info("Explanations are already up to date");
        return;
      }

      setIsGenerating(true);
      try {
        const merged: Record<string, RiskInsight> = {};
        // Chunked so one slow call cannot stall the whole batch.
        for (let i = 0; i < stale.length; i += 12) {
          const chunk = stale.slice(i, i + 12);
          const res = await fetch("/api/public/ai-project-insights", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]}`,
              apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
            },
            body: JSON.stringify({
              type: "risk_explanation",
              items: chunk.map((p) => ({
                id: p.id,
                merchantName: p.merchantName,
                projectState: p.projectState,
                reasons: verdicts[p.id]!.findings.map((f) => f.detail),
              })),
            }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || "AI request failed");

          const rows = (payload.result || []) as { id: string; why: string; recommendation: string }[];
          for (const r of rows) {
            merged[r.id] = {
              project_id: r.id,
              findings_hash: findingsHash(verdicts[r.id]!),
              why: r.why,
              recommendation: r.recommendation,
              generated_at: new Date().toISOString(),
            };
          }
        }

        const rows = Object.values(merged);
        if (rows.length > 0) {
          await supabase.from("project_risk_insights" as never).upsert(
            rows.map((r) => ({ ...r, tenant_id: tenantId, model: "google/gemini-2.5-flash" })) as never,
            { onConflict: "project_id" },
          );
          await queryClient.invalidateQueries({ queryKey: ["project_risk_insights", tenantId] });
        }
        toast.success(`Explained ${rows.length} at-risk project${rows.length === 1 ? "" : "s"}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to generate explanations");
      } finally {
        setIsGenerating(false);
      }
    },
    [insightFor, tenantId, queryClient],
  );

  return { insightFor, generate, isGenerating };
};
