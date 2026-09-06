import { useAuth } from "@/contexts/AuthContext";

/**
 * Role model
 * - super_admin : everything, across all workspaces
 * - admin       : tenant owner — all settings + users + integrations + API keys
 * - manager     : all operational tenant settings + full project work (no users/integrations)
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
    /** All other tenant settings */
    canManageSettings: isManager || isTenantAdmin || isSuperAdmin,
    /** Create / edit organisations */
    canManageTenants: isSuperAdmin,
  };
};
