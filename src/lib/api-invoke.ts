import { supabase } from "@/integrations/supabase/client";

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
