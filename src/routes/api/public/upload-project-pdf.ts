import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/csv",
  "text/plain",
  "application/json",
  "application/zip",
];

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = process.env['SUPABASE_URL'];
    const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("project_id") as string | null;
    const field = formData.get("field") as string | null;

    if (!file || !projectId || !field) {
      return new Response(JSON.stringify({ error: "Missing required fields: file, project_id, field" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ALLOWED_FIELDS = [
      "sow_link", "brd_link", "jira_link",
      "mint_checklist_link", "integration_checklist_link", "brand_url",
    ];
    if (!ALLOWED_FIELDS.includes(field)) {
      return new Response(JSON.stringify({ error: `Invalid field: ${field}. Allowed: ${ALLOWED_FIELDS.join(", ")}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return new Response(JSON.stringify({ error: "Unsupported file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, images, CSV, TXT, JSON, ZIP." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File too large. Max 20MB." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `projects/${projectId}/${field}/${timestamp}_${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("checklist-attachments")
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Bucket is private — store a long-lived signed link so the saved
    // document stays openable from the project record.
    const { data: urlData } = await supabase.storage
      .from("checklist-attachments")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365);

    const publicUrl = urlData?.signedUrl ?? storagePath;

    const { error: updateError } = await supabase
      .from("projects")
      .update({ [field]: publicUrl })
      .eq("id", projectId);

    if (updateError) {
      throw new Error(`Failed to update project: ${updateError.message}`);
    }

    return new Response(JSON.stringify({ url: publicUrl, field, project_id: projectId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Upload error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/upload-project-pdf")({
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
