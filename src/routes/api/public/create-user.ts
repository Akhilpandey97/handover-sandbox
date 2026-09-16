import { createFileRoute } from "@tanstack/react-router";

import { createClient } from "@supabase/supabase-js";
import { resolveUserScope } from "@/lib/api-auth.server";
import { createWorkspaceUser } from "@/lib/users.server";

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

    // The workspace being worked in and the role that applies there: during a
    // support session that's the customer's workspace, not the requester's own.
    const scope = await resolveUserScope(supabaseAdmin as any, requester.id);
    const isSuperAdmin = scope.roles.includes('super_admin');
    if (!scope.roles.some((r) => r === 'admin' || r === 'super_admin')) {
      return new Response(
        JSON.stringify({ error: 'Only tenant admins can create users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // New people join the workspace being worked in. Only a super admin may name
    // another one (Tenants → Add tenant admin).
    const resolvedTenantId = isSuperAdmin && tenant_id ? tenant_id : scope.tenantId;
    if (!resolvedTenantId) {
      return new Response(
        JSON.stringify({ error: 'No workspace to add this person to' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Shared with Buddy's invite action, so both write the same rows.
    let newUser: { id: string; email: string };
    try {
      newUser = await createWorkspaceUser({ email, password, name, role: team, tenantId: resolvedTenantId ?? null });
    } catch (createError) {
      console.error('Error creating user:', createError);
      return new Response(
        JSON.stringify({ error: (createError as Error).message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('User created successfully:', newUser.id, email, name, team);

    return new Response(
      JSON.stringify({ 
        success: true, 
        user: {
          id: newUser.id,
          email: newUser.email,
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
