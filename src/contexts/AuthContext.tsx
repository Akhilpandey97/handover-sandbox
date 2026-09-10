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

interface AuthContextType {
  currentUser: AuthUser | null;
  session: Session | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (email: string, password: string, name: string, team: TeamRole) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Never let a slow/hanging network call block the app shell forever
  const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

  // Fetch user profile and role
  const fetchUserProfile = async (userId: string): Promise<AuthUser | null> => {
    try {
      // Fetch profile
      const { data: profile, error: profileError } = await withTimeout(
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle() as any,
        8000,
        { data: null, error: { message: "timeout" } } as any,
      );

      if (profileError || !profile) {
        console.error("Error fetching profile:", profileError);
        return null;
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
        id: (profile as any).id,
        name: (profile as any).name,
        email: (profile as any).email,
        team: team,
        tenantId: (supportTenant as string | null) ?? homeTenantId,
        homeTenantId,
        supportTenantId: (supportTenant as string | null) ?? null,
      };
    } catch (error) {
      console.error("Error in fetchUserProfile:", error);
      return null;
    }
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
          const userProfile = await fetchUserProfile(session.user.id);
          if (!mounted) return;
          // Keep the previous user if the lookup failed/timed out instead of logging out
          if (userProfile) setCurrentUser(userProfile);
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
          const userProfile = await fetchUserProfile(session.user.id);
          if (!mounted) return;
          setCurrentUser(userProfile);
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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data.user) {
        const userProfile = await fetchUserProfile(data.user.id);
        setCurrentUser(userProfile);
        
        // Update last_login timestamp
        await supabase.from("profiles").update({ last_login: new Date().toISOString() }).eq("id", data.user.id);
        logActivity({ action_type: "user", category: "auth", description: `User logged in: ${email}` });
      }

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
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        session,
        login,
        signup,
        logout,
        isAuthenticated: currentUser !== null,
        isLoading,
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
