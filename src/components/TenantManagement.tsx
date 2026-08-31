import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Building2, Plus, Users, Edit2, UserPlus, Loader2, FolderKanban } from "lucide-react";

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
  const { currentUser } = useAuth();
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

      // Fetch stats per tenant
      const statsMap = new Map<string, TenantStats>();
      for (const tenant of data || []) {
        const { count: userCount } = await supabase.from("profiles").select("*", { count: "exact", head: true }).eq("tenant_id", tenant.id);
        const { count: projectCount } = await supabase.from("projects").select("*", { count: "exact", head: true }).eq("tenant_id", tenant.id);
        statsMap.set(tenant.id, {
          tenant_id: tenant.id,
          user_count: userCount || 0,
          project_count: projectCount || 0,
        });
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
        const { error } = await supabase.from("tenants").insert({
          name: tenantName,
          slug: tenantSlug,
          logo_url: tenantLogoUrl || null,
        });
        if (error) throw error;
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

      const { data, error } = await supabase.functions.invoke("create-user", {
        body: {
          email: managerEmail,
          password: managerPassword,
          name: managerName,
          team: "manager",
          tenant_id: selectedTenantForManager,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Manager ${managerName} created for tenant`);
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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
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
    </div>
  );
};
