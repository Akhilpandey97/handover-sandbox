import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeApi } from "@/lib/api-invoke";
import { useAuth } from "@/contexts/AuthContext";
import { SYSTEM_TEAMS } from "@/hooks/useTeams";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStartTenantAccess, type SupportAccessRole } from "@/hooks/useTenantAccess";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Building2, Plus, Users, Edit2, UserPlus, Loader2, FolderKanban, ShieldCheck } from "lucide-react";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TenantStats {
  tenant_id: string;
  user_count: number;
  project_count: number;
}

export const TenantManagement = () => {
  const [accessTarget, setAccessTarget] = useState<Tenant | null>(null);
  const [accessDays, setAccessDays] = useState("7");
  const [accessReason, setAccessReason] = useState("");
  const [accessGrantee, setAccessGrantee] = useState("self");
  const [accessRole, setAccessRole] = useState<SupportAccessRole>("manager");
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);
  const startAccess = useStartTenantAccess();
  const { currentUser } = useAuth();
  const homeTenantId = currentUser?.homeTenantId ?? null;

  // Who the access can be given to. Setup work is usually done by someone other
  // than whoever grants it — but always someone on your own team, never a
  // member of another customer. The database enforces the same rule.
  useEffect(() => {
    if (!homeTenantId) return;
    let cancelled = false;
    supabase.from("profiles").select("id, name").eq("tenant_id", homeTenantId).order("name").then(({ data }) => {
      if (!cancelled) {
        setStaff(((data || []) as Array<{ id: string; name: string }>).filter((u) => u.id !== currentUser?.id));
      }
    });
    return () => { cancelled = true; };
  }, [homeTenantId, currentUser?.id]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantStats, setTenantStats] = useState<Map<string, TenantStats>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isManagerDialogOpen, setIsManagerDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [selectedTenantForManager, setSelectedTenantForManager] = useState<string>("");

  // Form state
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenantLogoUrl, setTenantLogoUrl] = useState("");

  // Manager form
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [managerName, setManagerName] = useState("");
  const [isCreatingManager, setIsCreatingManager] = useState(false);

  const fetchTenants = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setTenants(data || []);

      // Counts across every workspace come from one server-side function: the
      // database keeps a super admin's direct reads inside the current workspace.
      const statsMap = new Map<string, TenantStats>();
      const { data: stats, error: statsError } = await (supabase as any).rpc("tenant_stats");
      if (!statsError) {
        for (const s of (stats || []) as Array<{ tenant_id: string; user_count: number; project_count: number }>) {
          statsMap.set(s.tenant_id, {
            tenant_id: s.tenant_id,
            user_count: Number(s.user_count) || 0,
            project_count: Number(s.project_count) || 0,
          });
        }
      } else {
        // Database without tenant_stats() yet: count per tenant as before.
        for (const tenant of data || []) {
          const { count: userCount } = await supabase.from("profiles").select("*", { count: "exact", head: true }).eq("tenant_id", tenant.id);
          const { count: projectCount } = await supabase.from("projects").select("*", { count: "exact", head: true }).eq("tenant_id", tenant.id);
          statsMap.set(tenant.id, {
            tenant_id: tenant.id,
            user_count: userCount || 0,
            project_count: projectCount || 0,
          });
        }
      }
      setTenantStats(statsMap);
    } catch (error) {
      console.error("Error fetching tenants:", error);
      toast.error("Failed to load tenants");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  };

  const handleSaveTenant = async () => {
    if (!tenantName.trim() || !tenantSlug.trim()) {
      toast.error("Name and slug are required");
      return;
    }

    try {
      if (editingTenant) {
        const { error } = await supabase
          .from("tenants")
          .update({
            name: tenantName,
            slug: tenantSlug,
            logo_url: tenantLogoUrl || null,
          })
          .eq("id", editingTenant.id);
        if (error) throw error;
        toast.success("Tenant updated successfully");
      } else {
        // The new workspace's default teams belong to it, not to the workspace
        // being worked in, so the database creates both together.
        const { error: rpcError } = await (supabase as any).rpc("create_tenant", {
          _name: tenantName,
          _slug: tenantSlug,
          _logo_url: tenantLogoUrl || null,
        });

        // PGRST202: the function is not deployed yet. Create it the old way.
        if (rpcError && rpcError.code !== "PGRST202") throw rpcError;
        if (rpcError) {
          const { data: newTenant, error } = await supabase
            .from("tenants")
            .insert({
              name: tenantName,
              slug: tenantSlug,
              logo_url: tenantLogoUrl || null,
            })
            .select("id")
            .single();
          if (error) throw error;

          const { error: teamsError } = await supabase.from("teams").insert(
            SYSTEM_TEAMS.map((t) => ({
              name: t.name,
              slug: t.slug,
              color: t.color,
              is_system: true,
              sort_order: t.sort_order,
              tenant_id: newTenant.id,
            }))
          );
          if (teamsError) throw teamsError;
        }

        toast.success("Tenant created successfully");
      }

      setIsDialogOpen(false);
      resetForm();
      fetchTenants();
    } catch (error: any) {
      toast.error(error.message || "Failed to save tenant");
    }
  };

  const handleToggleActive = async (tenant: Tenant) => {
    try {
      const { error } = await supabase
        .from("tenants")
        .update({ is_active: !tenant.is_active })
        .eq("id", tenant.id);
      if (error) throw error;
      toast.success(`Tenant ${!tenant.is_active ? "activated" : "deactivated"}`);
      fetchTenants();
    } catch (error: any) {
      toast.error(error.message || "Failed to toggle tenant");
    }
  };

  const handleCreateManager = async () => {
    if (!managerEmail || !managerPassword || !managerName || !selectedTenantForManager) {
      toast.error("All fields are required");
      return;
    }

    setIsCreatingManager(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await invokeApi("create-user", {
        body: {
          email: managerEmail,
          password: managerPassword,
          name: managerName,
          team: "admin",
          tenant_id: selectedTenantForManager,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Admin ${managerName} created for tenant`);
      setIsManagerDialogOpen(false);
      setManagerEmail("");
      setManagerPassword("");
      setManagerName("");
      setSelectedTenantForManager("");
      fetchTenants();
    } catch (error: any) {
      toast.error(error.message || "Failed to create manager");
    } finally {
      setIsCreatingManager(false);
    }
  };

  const resetForm = () => {
    setTenantName("");
    setTenantSlug("");
    setTenantLogoUrl("");
    setEditingTenant(null);
  };

  const openEditDialog = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setTenantName(tenant.name);
    setTenantSlug(tenant.slug);
    setTenantLogoUrl(tenant.logo_url || "");
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="portal-heading flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Tenant Management
              </CardTitle>
              <CardDescription>
                Create and manage tenants for different organisations. Each tenant has isolated data and settings.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsManagerDialogOpen(true)} className="gap-2">
                <UserPlus className="h-4 w-4" />
                Add Tenant Manager
              </Button>
              <Button onClick={openCreateDialog} className="gap-2">
                <Plus className="h-4 w-4" />
                New Tenant
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tenants.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No tenants yet. Create your first tenant to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead className="text-center">Projects</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((tenant) => {
                  const stats = tenantStats.get(tenant.id);
                  return (
                    <TableRow key={tenant.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Building2 className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{tenant.name}</p>
                            {tenant.logo_url && (
                              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{tenant.logo_url}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-sm bg-muted px-2 py-1 rounded">{tenant.slug}</code>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span>{stats?.user_count || 0}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <FolderKanban className="h-4 w-4 text-muted-foreground" />
                          <span>{stats?.project_count || 0}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={tenant.is_active ? "default" : "secondary"}>
                          {tenant.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(tenant.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Set up this account"
                            onClick={() => setAccessTarget(tenant)}
                          >
                            <ShieldCheck className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEditDialog(tenant)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Switch
                            checked={tenant.is_active}
                            onCheckedChange={() => handleToggleActive(tenant)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Tenant Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTenant ? "Edit Tenant" : "Create New Tenant"}</DialogTitle>
            <DialogDescription>
              {editingTenant ? "Update tenant details." : "Create a new tenant for an organisation."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Organisation Name</Label>
              <Input
                value={tenantName}
                onChange={(e) => {
                  setTenantName(e.target.value);
                  if (!editingTenant) setTenantSlug(generateSlug(e.target.value));
                }}
                placeholder="Acme Corp"
              />
            </div>
            <div className="space-y-2">
              <Label>Slug (URL identifier)</Label>
              <Input
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="acme-corp"
              />
            </div>
            <div className="space-y-2">
              <Label>Logo URL (optional)</Label>
              <Input
                value={tenantLogoUrl}
                onChange={(e) => setTenantLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveTenant}>
              {editingTenant ? "Update" : "Create"} Tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Manager Dialog */}
      <Dialog open={isManagerDialogOpen} onOpenChange={setIsManagerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Tenant Manager</DialogTitle>
            <DialogDescription>
              Create a manager account for a tenant. This manager will be able to manage users and projects within their tenant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tenant</Label>
              <Select value={selectedTenantForManager} onValueChange={setSelectedTenantForManager}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.filter(t => t.is_active).map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Manager Name</Label>
              <Input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="John Doe" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} placeholder="john@acme.com" />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={managerPassword} onChange={(e) => setManagerPassword(e.target.value)} placeholder="••••••••" minLength={6} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsManagerDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateManager} disabled={isCreatingManager}>
              {isCreatingManager ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</> : "Create Manager"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Support access: deliberate, time-boxed, and on the record. */}
      <Dialog open={!!accessTarget} onOpenChange={(o) => { if (!o) { setAccessTarget(null); setAccessReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set up {accessTarget?.name}</DialogTitle>
            <DialogDescription>
              The app will read and write as this workspace until the access expires or you leave it.
              A record of this is kept and is visible to them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Who gets access</Label>
              <Select value={accessGrantee} onValueChange={setAccessGrantee}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Me — enter now</SelectItem>
                  {staff.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Works as</Label>
              <Select value={accessRole} onValueChange={(v) => setAccessRole(v as SupportAccessRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager — projects, checklists and users</SelectItem>
                  <SelectItem value="admin">Admin — also integrations, credentials and API keys</SelectItem>
                  <SelectItem value="gokwik_general">General — view only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Replaces their own role inside this workspace for as long as the access lasts.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Access for</Label>
              <Select value={accessDays} onValueChange={setAccessDays}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Reason</Label>
              <Input
                value={accessReason}
                onChange={(e) => setAccessReason(e.target.value)}
                placeholder="e.g. Initial workspace setup"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessTarget(null)}>Cancel</Button>
            <Button
              disabled={!accessReason.trim() || startAccess.isPending}
              onClick={() => accessTarget && startAccess.mutate({
                tenantId: accessTarget.id,
                tenantName: accessTarget.name,
                days: Number(accessDays),
                reason: accessReason.trim(),
                role: accessRole,
                grantTo: accessGrantee === "self" ? undefined : accessGrantee,
              }, { onSuccess: () => setAccessTarget(null) })}
            >
              {startAccess.isPending ? "Granting…" : accessGrantee === "self" ? "Enter workspace" : "Grant access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};