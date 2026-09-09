import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "@/lib/api-cors";
import { requireInternalCaller } from "@/lib/api-auth.server";

const SUPABASE_URL = process.env['SUPABASE_URL']!;
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

function ownerFor(size: string, arrRaw: number): string {
  const s = (size || "").toUpperCase();
  const arrL = arrRaw >= 1000 ? arrRaw / 100000 : arrRaw;
  // ENT -> Ankit; SME < 15L -> Deepak; SME >= 15L -> Rohit
  if (s === "ENTERPRISE" || s === "ENT") return "ankit@gokwik.co";
  if (s === "SME") return arrL < 15 ? "deepak.sharma@gokwik.co" : "rohit.singh@gokwik.co";
  return "";
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const denied = await requireInternalCaller(req, corsHeaders);
  if (denied) return denied;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { dryRun = false } = await req.json().catch(() => ({}));

  const { data: rows, error } = await supabase
    .from("shopify_sme_merchants")
    .select("id, brand_name, merchant_size, expected_arr, assigned_owner_email, shopify_url")
    .is("assigned_owner_email", null);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results: any[] = [];
  for (const r of rows || []) {
    if (!r.shopify_url || !String(r.shopify_url).trim()) { results.push({ id: r.id, brand: r.brand_name, skipped: "no shopify url" }); continue; }
    const owner = ownerFor(r.merchant_size, Number(r.expected_arr) || 0);
    if (!owner) { results.push({ id: r.id, brand: r.brand_name, skipped: "no bucket" }); continue; }

    if (dryRun) { results.push({ id: r.id, brand: r.brand_name, would_assign: owner }); continue; }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/assign-shopify-sme-owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ id: r.id, owner_email: owner }),
      });
      const ok = res.ok;
      const body = await res.text();
      results.push({ id: r.id, brand: r.brand_name, owner, ok, body: ok ? undefined : body });
    } catch (e) {
      results.push({ id: r.id, brand: r.brand_name, owner, ok: false, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/backfill-shopify-sme-assignments")({
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
