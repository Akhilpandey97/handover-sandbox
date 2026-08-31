import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, password, name, team, tenant_id } = await req.json();

    // Validate required fields
    if (!email || !password || !name || !team) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: email, password, name, team' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Enforce @gokwik.co email domain for gokwik_general role
    if (team === 'gokwik_general' && !email.endsWith('@gokwik.co')) {
      return new Response(
        JSON.stringify({ error: 'GoKwik General role requires a @gokwik.co email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the requesting user is a manager
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role to check if requester is manager
    const supabaseUrl = process.env['SUPABASE_URL']!;
    const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get the requesting user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: requester }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !requester) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if requester is a manager
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', requester.id)
      .single();

    if (roleError || (roleData?.role !== 'manager' && roleData?.role !== 'super_admin')) {
      return new Response(
        JSON.stringify({ error: 'Only managers can create users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create the new user using admin API (doesn't affect current session)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name,
        team,
        tenant_id: tenant_id || null,
      },
    });

    if (createError) {
      console.error('Error creating user:', createError);
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Manually insert into profiles table (in case trigger doesn't fire)
    // Determine tenant_id: use provided tenant_id, or fall back to requester's tenant
    let resolvedTenantId = tenant_id;
    if (!resolvedTenantId) {
      const { data: requesterProfile } = await supabaseAdmin
        .from('profiles')
        .select('tenant_id')
        .eq('id', requester.id)
        .single();
      resolvedTenantId = requesterProfile?.tenant_id;
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        email: email,
        name: name,
        team: team,
        tenant_id: resolvedTenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Don't fail the whole operation, but log the error
    }

    // Check if user already has a role entry
    const { data: existingRole } = await supabaseAdmin
      .from('user_roles')
      .select('id')
      .eq('user_id', newUser.user.id)
      .single();

    if (existingRole) {
      // Update existing role
      const { error: updateRoleError } = await supabaseAdmin
        .from('user_roles')
        .update({ role: team, tenant_id: resolvedTenantId })
        .eq('user_id', newUser.user.id);

      if (updateRoleError) {
        console.error('Error updating user role:', updateRoleError);
      }
    } else {
      // Insert new role
      const { error: insertRoleError } = await supabaseAdmin
        .from('user_roles')
        .insert({
          user_id: newUser.user.id,
          role: team,
          tenant_id: resolvedTenantId,
          created_at: new Date().toISOString(),
        });

      if (insertRoleError) {
        console.error('Error inserting user role:', insertRoleError);
      }
    }

    console.log('User created successfully:', newUser.user.id, email, name, team);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: {
          id: newUser.user.id,
          email: newUser.user.email,
          name,
          team,
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error in create-user function:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export const Route = createFileRoute("/api/public/create-user")({
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
