import { supabase } from "@/integrations/supabase/client";

/**
 * Headers for calling /api/public/* routes as the signed-in user.
 *
 * The publishable key is not a JWT, so tenantIdFromRequest() cannot resolve a
 * tenant from it and the route falls back to platform env vars — which is why
 * per-tenant Integrations settings appear to be ignored. Send the session token
 * instead for any route that reads tenant credentials.
 */
export async function apiAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Drop-in replacement for supabase.functions.invoke that calls the app's own
 * /api/public/<name> route with the current user's bearer token.
 */
export async function invokeApi<T = any>(
  name: string,
  options: { body?: unknown; method?: string } = {},
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const res = await fetch(`/api/public/${name}`, {
      method: options.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;

    if (!res.ok) {
      return { data: null, error: { message: parsed?.error || `Request failed (${res.status})` } };
    }
    return { data: parsed as T, error: null };
  } catch (err) {
    return { data: null, error: { message: (err as Error).message } };
  }
}
