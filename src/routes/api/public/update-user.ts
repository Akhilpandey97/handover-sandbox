import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";

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

    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', requester.id)
      .single();

    if (roleError || (roleData?.role !== 'admin' && roleData?.role !== 'super_admin')) {
      return new Response(
        JSON.stringify({ error: 'Only tenant admins can edit users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isSuperAdmin = roleData?.role === 'super_admin';
    if (!isSuperAdmin) {
      const { data: requesterProfile } = await supabaseAdmin
        .from('profiles').select('tenant_id').eq('id', requester.id).single();
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles').select('tenant_id').eq('id', userId).single();
      if (!requesterProfile?.tenant_id || requesterProfile.tenant_id !== targetProfile?.tenant_id) {
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
