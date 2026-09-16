import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";
import { resolveUserScope } from "@/lib/api-auth.server";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, name, email, team } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = process.env['SUPABASE_URL']!;
    const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: requester }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !requester) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The workspace being worked in and the role that applies there: during a
    // support session that's the customer's workspace, not the requester's own.
    const scope = await resolveUserScope(supabaseAdmin as any, requester.id);
    const isSuperAdmin = scope.roles.includes('super_admin');
    if (!scope.roles.some((r) => r === 'admin' || r === 'super_admin')) {
      return new Response(
        JSON.stringify({ error: 'Only tenant admins can edit users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Admins, and super admins inside a customer's workspace, only touch that workspace's people.
    if (!isSuperAdmin || scope.supportGrantId) {
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles').select('tenant_id').eq('id', userId).single();
      if (!scope.tenantId || scope.tenantId !== targetProfile?.tenant_id) {
        return new Response(
          JSON.stringify({ error: 'You can only manage users in your own workspace' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Update profile
    const profileUpdate: Record<string, string> = {};
    if (name) profileUpdate.name = name;
    if (email) profileUpdate.email = email;
    if (team) profileUpdate.team = team;

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update(profileUpdate)
        .eq('id', userId);

      if (profileError) {
        return new Response(
          JSON.stringify({ error: profileError.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Update role if team changed
    if (team) {
      const { data: targetProfileForRole } = await supabaseAdmin
        .from('profiles').select('tenant_id').eq('id', userId).single();
      await supabaseAdmin
        .from('user_roles')
        .update({ role: team, tenant_id: targetProfileForRole?.tenant_id ?? null })
        .eq('user_id', userId);
    }

    // Update auth email if changed
    if (email) {
      await supabaseAdmin.auth.admin.updateUserById(userId, { email });
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export const Route = createFileRoute("/api/public/update-user")({
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
