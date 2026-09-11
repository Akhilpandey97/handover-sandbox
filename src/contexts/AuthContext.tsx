import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/hooks/useActivityLogs";
import { User, Session } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { TeamRole } from "@/data/teams";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  team: TeamRole;
  /**
   * The tenant the app should read and write. While a support session is open
   * this is the customer's tenant, so everything downstream lands in the right
   * workspace without each caller having to know about support access.
   */
  tenantId: string | null;
  /** The person's own tenant, unchanged by a support session. */
  homeTenantId: string | null;
  /** Set only while working inside someone else's workspace. */
  supportTenantId: string | null;
}

interface GoogleSignInResult {
  success: boolean;
  error?: string;
  /** Set when the handoff had to leave this tab behind; see loginWithGoogle. */
  openedInNewTab?: boolean;
}

interface AuthContextType {
  currentUser: AuthUser | null;
  session: Session | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<GoogleSignInResult>;
  signup: (email: string, password: string, name: string, team: TeamRole) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * Set when someone authenticated successfully but has no Handover account —
   * the likely outcome of signing in with a Google account an admin has not set
   * up yet. Without this the sign-in screen would just silently reappear.
   */
  accessError: string | null;
}

/**
 * A missing profile and an unreachable database look the same to a caller but
 * must be handled differently: the first means no access, the second means try
 * again later and on no account sign the person out.
 */
type ProfileLookup =
  { status: "ok"; user: AuthUser } | { status: "missing" } | { status: "unavailable" };

const NO_ACCOUNT_MESSAGE =
  "That account isn't set up for Handover yet. Ask a workspace admin to add you under Settings → Users, then sign in again.";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  // Never let a slow/hanging network call block the app shell forever
  const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

  // Fetch user profile and role
  const fetchUserProfile = async (userId: string): Promise<ProfileLookup> => {
    try {
      // Fetch profile
      const { data: profile, error: profileError } = await withTimeout(
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle() as any,
        8000,
        { data: null, error: { message: "timeout" } } as any,
      );

      if (profileError || !profile) {
        if (profileError) {
          console.error("Error fetching profile:", profileError);
          return { status: "unavailable" };
        }
        // The lookup worked and there is genuinely no profile for this account.
        return { status: "missing" };
      }

      // Fetch role from user_roles table
      const { data: roleData } = await withTimeout(
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle() as any,
        8000,
        { data: null, error: null } as any,
      );

      const team = ((roleData as any)?.role || (profile as any).team) as TeamRole;

      // Resolved server-side, so an expired or revoked grant simply stops
      // working — the client is never asked to be honest about it.
      const { data: supportTenant } = await withTimeout(
        (supabase as any).rpc("active_support_tenant", { _user_id: userId }),
        8000,
        { data: null, error: null } as any,
      );

      const homeTenantId = (profile as any).tenant_id ?? null;
      return {
        status: "ok",
        user: {
          id: (profile as any).id,
          name: (profile as any).name,
          email: (profile as any).email,
          team: team,
          tenantId: (supportTenant as string | null) ?? homeTenantId,
          homeTenantId,
          supportTenantId: (supportTenant as string | null) ?? null,
        },
      };
    } catch (error) {
      console.error("Error in fetchUserProfile:", error);
      return { status: "unavailable" };
    }
  };

  const recordLogin = async (userId: string, email: string) => {
    await supabase.from("profiles").update({ last_login: new Date().toISOString() }).eq("id", userId);
    logActivity({ action_type: "user", category: "auth", description: `User logged in: ${email}` });
  };

  /**
   * Authenticated with the identity provider, but there is no account here. End
   * the session so the app never sits signed-in-but-empty, and say why.
   */
  const denyAccess = async () => {
    setAccessError(NO_ACCOUNT_MESSAGE);
    await supabase.auth.signOut();
    setCurrentUser(null);
  };

  // Track the profile we already resolved so transient failures never sign the user out
  const currentUserRef = React.useRef<AuthUser | null>(null);
  currentUserRef.current = currentUser;

  useEffect(() => {
    let mounted = true;
    // Hard safety net: never keep the splash spinner longer than 10s
    const splashTimer = setTimeout(() => {
      if (mounted) setIsLoading(false);
    }, 10000);

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);

        // Only an explicit sign-out clears the user
        if (event === "SIGNED_OUT" || !session?.user) {
          if (event === "SIGNED_OUT" || !session) {
            setCurrentUser(null);
          }
          setIsLoading(false);
          return;
        }

        // Token refreshes / tab focus events must not re-fetch or reset an existing profile
        if (currentUserRef.current?.id === session.user.id) {
          setIsLoading(false);
          return;
        }

        // Defer profile fetch to avoid blocking the auth callback
        setTimeout(async () => {
          const lookup = await fetchUserProfile(session.user.id);
          if (!mounted) return;
          if (lookup.status === "ok") {
            setCurrentUser(lookup.user);
            setAccessError(null);
            // Password sign-in records this itself; this covers the SSO redirect,
            // which lands here rather than in login().
            if (session.user.app_metadata?.provider !== "email") {
              void recordLogin(lookup.user.id, lookup.user.email);
            }
          } else if (lookup.status === "missing") {
            await denyAccess();
          }
          // "unavailable" keeps the previous user rather than logging them out
          setIsLoading(false);
        }, 0);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!mounted) return;
        setSession(session);
        if (session?.user) {
          const lookup = await fetchUserProfile(session.user.id);
          if (!mounted) return;
          if (lookup.status === "ok") setCurrentUser(lookup.user);
          else if (lookup.status === "missing") await denyAccess();
        }
      })
      .catch((e) => console.error("getSession failed:", e))
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
      clearTimeout(splashTimer);
      subscription.unsubscribe();
    };
  }, []);


  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setAccessError(null);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data.user) {
        const lookup = await fetchUserProfile(data.user.id);
        if (lookup.status === "missing") {
          await denyAccess();
          return { success: false, error: NO_ACCOUNT_MESSAGE };
        }
        if (lookup.status === "ok") {
          setCurrentUser(lookup.user);
          await recordLogin(data.user.id, email);
        }
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  /**
   * Hands off to Google and returns via the redirect, where detectSessionInUrl
   * picks the session up and onAuthStateChange resolves the profile.
   *
   * Google refuses to render its consent screen inside an iframe, so when the
   * app is framed — the Lovable editor preview — we take the handoff to a new
   * top-level tab instead of navigating the frame into a dead end.
   */
  const loginWithGoogle = async (): Promise<GoogleSignInResult> => {
    try {
      setAccessError(null);
      const framed = typeof window !== "undefined" && window.parent !== window;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          // Let people pick an account instead of silently reusing the one
          // their browser happens to be signed into.
          queryParams: { prompt: "select_account" },
          // Drive the navigation ourselves so the framed case can escape.
          skipBrowserRedirect: true,
        },
      });

      if (error) return { success: false, error: error.message };
      if (!data?.url) {
        return { success: false, error: "Google sign-in is not configured for this workspace" };
      }

      if (framed) {
        const opened = window.open(data.url, "_blank", "noopener,noreferrer");
        if (!opened) {
          return {
            success: false,
            error: "Allow pop-ups to sign in with Google, or open the app in its own tab",
          };
        }
        return { success: true, openedInNewTab: true };
      }

      window.location.href = data.url;
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const signup = async (
    email: string, 
    password: string, 
    name: string, 
    team: TeamRole
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            name,
            team,
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    logActivity({ action_type: "user", category: "auth", description: `User logged out` });
    await supabase.auth.signOut();
    setCurrentUser(null);
    setSession(null);
    setAccessError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        session,
        login,
        loginWithGoogle,
        signup,
        logout,
        isAuthenticated: currentUser !== null,
        isLoading,
        accessError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
