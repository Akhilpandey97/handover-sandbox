import { useState, useEffect } from "react";
import { useLabels } from "@/contexts/LabelsContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UserPlus, Users, RefreshCw, Key, Pencil, Trash2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

interface UserWithRole {
  id: string;
  name: string;
  email: string;
  team: string;
  created_at: string | null;
  last_login: string | null;
}

const teamColors: Record<string, string> = {
  mint: "bg-blue-500",
  integration: "bg-purple-500",
  ms: "bg-green-500",
  manager: "bg-orange-500",
  super_admin: "bg-red-500",
  gokwik_general: "bg-teal-500",
};

export const UserManagement = () => {
  const { teamLabels } = useLabels();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Form state for creating user
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [team, setTeam] = useState<string>("mint");

  // Set password dialog state
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedUserName, setSelectedUserName] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [isSettingPassword, setIsSettingPassword] = useState(false);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserWithRole | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTeam, setEditTeam] = useState<string>("mint");
  const [isEditing, setIsEditing] = useState(false);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<UserWithRole | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("*");

      if (rolesError) throw rolesError;

      const usersWithRoles: UserWithRole[] = (profiles || []).map(profile => {
        const userRole = roles?.find(r => r.user_id === profile.id);
        return {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          team: userRole?.role || profile.team,
          created_at: profile.created_at,
          last_login: (profile as any).last_login || null,
        };
      });

      setUsers(usersWithRoles);
    } catch (error: any) {
      console.error("Error fetching users:", error);
      toast.error("Failed to load users");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const getAuthToken = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("You must be logged in");
    return data.session.access_token;
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const token = await getAuthToken();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ email, password, name, team }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to create user');
      toast.success(`User ${name} created successfully!`);
      setIsOpen(false);
      setEmail(""); setPassword(""); setName(""); setTeam("mint");
      setTimeout(() => fetchUsers(), 500);
    } catch (error: any) {
      toast.error(error.message || "Failed to create user");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSettingPassword(true);
    try {
      const token = await getAuthToken();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: selectedUserId, newPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to set password');
      toast.success(`Password updated for ${selectedUserName}`);
      setPasswordDialogOpen(false); setNewPassword("");
    } catch (error: any) {
      toast.error(error.message || "Failed to set password");
    } finally {
      setIsSettingPassword(false);
    }
  };

  const openEditDialog = (user: UserWithRole) => {
    setEditUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditTeam(user.team);
    setEditDialogOpen(true);
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setIsEditing(true);
    try {
      const token = await getAuthToken();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/update-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: editUser.id, name: editName, email: editEmail, team: editTeam }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update user');
      toast.success(`User ${editName} updated successfully`);
      setEditDialogOpen(false);
      setTimeout(() => fetchUsers(), 500);
    } catch (error: any) {
      toast.error(error.message || "Failed to update user");
    } finally {
      setIsEditing(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;
    setIsDeleting(true);
    try {
      const token = await getAuthToken();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: deleteUser.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to delete user');
      toast.success(`User ${deleteUser.name} deleted`);
      setDeleteDialogOpen(false);
      setDeleteUser(null);
      setTimeout(() => fetchUsers(), 500);
    } catch (error: any) {
      toast.error(error.message || "Failed to delete user");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
            </CardTitle>
            <CardDescription>Manage team members and their roles</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchUsers} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><UserPlus className="h-4 w-4 mr-2" />Add User</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New User</DialogTitle>
                  <DialogDescription>Add a new team member to the system</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="create-name">Full Name</Label>
                    <Input id="create-name" placeholder="Enter full name" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-email">Email</Label>
                    <Input id="create-email" type="email" placeholder="Enter email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-password">Password</Label>
                    <Input id="create-password" type="password" placeholder="Min 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-team">Team</Label>
                    <Select value={team} onValueChange={(v) => setTeam(v)}>
                      <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
                      <SelectContent>
                        {Object.keys(teamLabels).map((role) => (
                          <SelectItem key={role} value={role}>{teamLabels[role as keyof typeof teamLabels]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={isCreating}>{isCreating ? "Creating..." : "Create User"}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No users found.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge className={`${teamColors[user.team]} text-white`}>
                      {teamLabels[user.team]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : "N/A"}
                  </TableCell>
                  <TableCell>
                    {user.last_login 
                      ? new Date(user.last_login).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(user)} title="Edit user">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedUserId(user.id); setSelectedUserName(user.name); setNewPassword(""); setPasswordDialogOpen(true); }} title="Set password">
                        <Key className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { setDeleteUser(user); setDeleteDialogOpen(true); }} title="Delete user">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Set Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Password</DialogTitle>
            <DialogDescription>Set a new password for {selectedUserName}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input id="new-password" type="password" placeholder="Min 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSettingPassword}>{isSettingPassword ? "Updating..." : "Update Password"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user details for {editUser?.name}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditUser} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-team">Team</Label>
              <Select value={editTeam} onValueChange={(v) => setEditTeam(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(teamLabels).map((role) => (
                    <SelectItem key={role} value={role}>{teamLabels[role as keyof typeof teamLabels]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isEditing}>{isEditing ? "Saving..." : "Save Changes"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{deleteUser?.name}</strong> ({deleteUser?.email})? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? "Deleting..." : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
