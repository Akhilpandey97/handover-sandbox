import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

async function generateAndUploadExcel(adminClient: any, session: any) {
  const { data: allFields } = await adminClient
    .from("checklist_form_fields")
    .select("id, question, category")
    .eq("template_id", session.form_template_id)
    .order("sort_order", { ascending: true });

  const { data: allResponses } = await adminClient
    .from("brd_responses")
    .select("field_id, value")
    .eq("session_id", session.id);

  const responseMap: Record<string, string> = {};
  (allResponses || []).forEach((r: any) => {
    if (r.value) responseMap[r.field_id] = r.value;
  });

  const excelRows = [["Category", "Question", "Response"]];
  (allFields || []).forEach((f: any) => {
    excelRows.push([f.category || "General", f.question, responseMap[f.id] || ""]);
  });

  const ws = XLSX.utils.aoa_to_sheet(excelRows);
  ws["!cols"] = [{ wch: 20 }, { wch: 50 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BRD Responses");
  const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Use a stable filename so we overwrite each time
  const fileName = `brd_${session.projects?.mid || session.id}.xlsx`;
  await adminClient.storage
    .from("brd-exports")
    .upload(fileName, xlsxBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });

  const { data: urlData } = adminClient.storage.from("brd-exports").getPublicUrl(fileName);
  const csvUrl = urlData.publicUrl;

  // Update session and project brd_link
  await adminClient.from("brd_sessions")
    .update({ csv_url: csvUrl, updated_at: new Date().toISOString() })
    .eq("id", session.id);

  await adminClient.from("projects")
    .update({ brd_link: csvUrl, updated_at: new Date().toISOString() })
    .eq("id", session.project_id);

  return csvUrl;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response(JSON.stringify({ error: "Token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session, error: sessionError } = await adminClient
      .from("brd_sessions")
      .select("*, projects(merchant_name, mid)")
      .eq("token", token)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: "Invalid or expired BRD link" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET
    if (req.method === "GET") {
      const { data: fields } = await adminClient
        .from("checklist_form_fields")
        .select("id, question, field_type, options, is_required, category, sort_order")
        .eq("template_id", session.form_template_id)
        .order("sort_order", { ascending: true });

      const { data: formTemplate } = await adminClient
        .from("checklist_form_templates")
        .select("name, description")
        .eq("id", session.form_template_id)
        .single();

      const { data: existingResponses } = await adminClient
        .from("brd_responses")
        .select("field_id, value")
        .eq("session_id", session.id);

      const responsesMap: Record<string, string> = {};
      (existingResponses || []).forEach((r: any) => {
        if (r.value) responsesMap[r.field_id] = r.value;
      });

      return new Response(JSON.stringify({
        session: {
          id: session.id,
          status: session.status,
          merchantName: session.projects?.merchant_name || "Unknown",
          mid: session.projects?.mid || "",
          completed_at: session.completed_at,
          csv_url: session.csv_url,
        },
        form: {
          name: formTemplate?.name || "BRD Form",
          description: formTemplate?.description || "",
        },
        fields: fields || [],
        responses: responsesMap,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST
    if (req.method === "POST") {
      if (session.status === "completed") {
        return new Response(JSON.stringify({ error: "This BRD has already been completed" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { responses, complete } = await req.json();

      if (session.status === "pending") {
        await adminClient.from("brd_sessions")
          .update({ status: "in_progress", updated_at: new Date().toISOString() })
          .eq("id", session.id);
      }

      // Upsert responses
      if (responses && typeof responses === "object") {
        for (const [field_id, value] of Object.entries(responses)) {
          const { data: existing } = await adminClient
            .from("brd_responses")
            .select("id")
            .eq("session_id", session.id)
            .eq("field_id", field_id)
            .maybeSingle();

          if (existing) {
            await adminClient.from("brd_responses")
              .update({ value: value as string, updated_at: new Date().toISOString() })
              .eq("id", existing.id);
          } else {
            await adminClient.from("brd_responses").insert({
              session_id: session.id,
              field_id,
              value: value as string,
              tenant_id: session.tenant_id,
            });
          }
        }
      }

      // Generate Excel only on completion (or on explicit export request).
      // Doing it on every keystroke save makes the form painfully slow because
      // it re-reads all fields + responses, builds a workbook, and uploads to storage.
      if (complete) {
        const csvUrl = await generateAndUploadExcel(adminClient, session);
        await adminClient.from("brd_sessions")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id);

        return new Response(JSON.stringify({
          success: true,
          message: "BRD completed successfully",
          csv_url: csvUrl,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, message: "Responses saved" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("brd-form-api error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/brd-form-api")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      PUT: ({ request }) => handler(request),
      PATCH: ({ request }) => handler(request),
      DELETE: ({ request }) => handler(request),
      OPTIONS: ({ request }) => handler(request),
    },
  },
});
