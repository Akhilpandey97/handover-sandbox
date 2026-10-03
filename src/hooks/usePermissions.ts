import { useAuth } from "@/contexts/AuthContext";

/**
 * Role model
 * - super_admin : everything, across all workspaces
 * - admin       : tenant owner — all settings + users + integrations + API keys
 * - manager     : full project work; no settings, users or integrations
 * - team roles  : project work within their own scope
 */
export const usePermissions = () => {
  const { currentUser } = useAuth();
  const role = currentUser?.team ?? "";

  const isSuperAdmin = role === "super_admin";
  const isTenantAdmin = role === "admin";
  const isManager = role === "manager";

  return {
    role,
    isSuperAdmin,
    isTenantAdmin,
    isManager,
    /** Manager-level or above: settings, archived projects, admin dashboards */
    isManagerOrAbove: isManager || isTenantAdmin || isSuperAdmin,
    /** Create / edit / delete users, reset passwords, assign roles */
    canManageUsers: isTenantAdmin || isSuperAdmin,
    /** Integration credentials and CRM API keys */
    canManageIntegrations: isTenantAdmin || isSuperAdmin,
    /** Workspace branding (logo, name) */
    canManageBranding: isTenantAdmin || isSuperAdmin,
    /** The Settings area as a whole — admins only; managers run projects, not the workspace */
    canManageSettings: isTenantAdmin || isSuperAdmin,
    /** Create / edit organisations */
    canManageTenants: isSuperAdmin,
  };
};
