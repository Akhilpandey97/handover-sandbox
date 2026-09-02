import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TeamRole } from "@/data/teams";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { useTeams } from "@/hooks/useTeams";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Save,
  X,
  ClipboardList,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Upload,
  Users,
} from "lucide-react";

interface ChecklistTemplate {
  id: string;
  title: string;
  ownerTeam: TeamRole;
  phase: string;
  sortOrder: number;
  standardDuration: number | null;
}

// Fetch checklist templates from dedicated table
const useChecklistTemplates = (isSuperAdmin: boolean) => {
  return useQuery({
    queryKey: ["checklist-templates", isSuperAdmin],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_templates")
        .select("id, title, owner_team, phase, sort_order, standard_duration")
        .order("sort_order", { ascending: true });

      if (error) throw error;

      const mapped = (data || []).map((item) => ({
        id: item.id,
        title: item.title,
        ownerTeam: item.owner_team as TeamRole,
        phase: item.phase,
        sortOrder: item.sort_order ?? 0,
        standardDuration: item.standard_duration ?? null,
      }));

      // Super admins see templates across every tenant — collapse duplicates
      // (same team + title) so edits apply once and propagate everywhere.
      if (!isSuperAdmin) return mapped;
      const seen = new Set<string>();
      return mapped.filter((t) => {
        const key = `${t.ownerTeam}|${t.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  });
};


export const ChecklistManagement = () => {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.team === "super_admin";
  const { data: templates = [], isLoading } = useChecklistTemplates(isSuperAdmin);
  const { teamLabels } = useLabels();

  // Tenants this admin may write to: all tenants for super admins, own tenant otherwise.
  const resolveTargetTenantIds = async (): Promise<string[]> => {
    if (isSuperAdmin) {
      const { data } = await supabase.from("tenants").select("id");
      const ids = (data || []).map((t) => t.id);
      return ids.length > 0 ? ids : (currentUser?.tenantId ? [currentUser.tenantId] : []);
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id as string).single();
    return profile?.tenant_id ? [profile.tenant_id] : [];
  };

  const [activeTeam, setActiveTeam] = useState<TeamRole>("mint");
  const [editingItem, setEditingItem] = useState<ChecklistTemplate | null>(null);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemDuration, setNewItemDuration] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ChecklistTemplate | null>(null);
  const [csvUploadOpen, setCsvUploadOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<{ title: string; team: TeamRole }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter templates by team
  const teamTemplates = templates.filter((t) => t.ownerTeam === activeTeam);

  // Add new checklist item to templates table AND all existing projects
  const addItemMutation = useMutation({
    mutationFn: async ({ title, team, standardDuration }: { title: string; team: TeamRole; standardDuration: number | null }) => {
      const maxOrder = teamTemplates.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1;
      const phase = team === "manager" ? "ms" : team;

      // Target tenants (all tenants when super admin)
      const tenantIds = await resolveTargetTenantIds();

      const { error: templateError } = await supabase
        .from("checklist_templates")
        .insert(tenantIds.map((tenantId) => ({
          title,
          owner_team: team,
          phase: phase as "mint" | "integration" | "ms",
          sort_order: maxOrder,
          tenant_id: tenantId,
          standard_duration: standardDuration,
        })));
      if (templateError) throw templateError;

      // Also add to all existing projects in the target tenants
      const { data: projects, error: projectsError } = await supabase
        .from("projects")
        .select("id, tenant_id")
        .in("tenant_id", tenantIds);
      if (projectsError) throw projectsError;


      const itemsToInsert = (projects || []).map((p) => ({
        project_id: p.id,
        title,
        owner_team: team,
        phase: phase as "mint" | "integration" | "ms",
        sort_order: maxOrder,
        completed: false,
        current_responsibility: "neutral" as const,
        tenant_id: p.tenant_id,
      }));

      if (itemsToInsert.length > 0) {
        const { error } = await supabase.from("checklist_items").insert(itemsToInsert);
        if (error) throw error;
      }

      return { title, team };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Checklist item added to all projects");
      setIsAddDialogOpen(false);
      setNewItemTitle("");
      setNewItemDuration("");
    },
    onError: (error) => {
      console.error("Error adding checklist item:", error);
      toast.error("Failed to add checklist item");
    },
  });

  // Update checklist item title in templates AND across all projects
  const updateItemMutation = useMutation({
    mutationFn: async ({ oldTitle, newTitle, team, templateId, standardDuration }: { oldTitle: string; newTitle: string; team: TeamRole; templateId?: string; standardDuration?: number | null }) => {
      if (templateId) {
        const updateData: any = { title: newTitle };
        if (standardDuration !== undefined) updateData.standard_duration = standardDuration;
        // Super admin edits apply to the matching template in every tenant
        const tq = supabase.from("checklist_templates").update(updateData);
        await (isSuperAdmin
          ? tq.eq("title", oldTitle).eq("owner_team", team)
          : tq.eq("id", templateId));
      }

      const { error } = await supabase
        .from("checklist_items")
        .update({ title: newTitle })
        .eq("title", oldTitle)
        .eq("owner_team", team);
      if (error) throw error;
      return { oldTitle, newTitle, team };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Checklist item updated");
      setEditingItem(null);
    },
    onError: (error) => {
      console.error("Error updating checklist item:", error);
      toast.error("Failed to update checklist item");
    },
  });

  // Delete checklist item from templates AND all projects
  const deleteItemMutation = useMutation({
    mutationFn: async ({ title, team, templateId }: { title: string; team: TeamRole; templateId?: string }) => {
      if (templateId) {
        await supabase.from("checklist_templates").delete().eq("id", templateId);
      }
      const { error } = await supabase
        .from("checklist_items")
        .delete()
        .eq("title", title)
        .eq("owner_team", team);
      if (error) throw error;
      return { title, team };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Checklist item removed from all projects");
      setDeleteConfirm(null);
    },
    onError: (error) => {
      console.error("Error deleting checklist item:", error);
      toast.error("Failed to delete checklist item");
    },
  });

  // Reorder checklist items
  const reorderMutation = useMutation({
    mutationFn: async ({ title, team, direction }: { title: string; team: TeamRole; direction: "up" | "down" }) => {
      const currentItems = teamTemplates;
      const currentIndex = currentItems.findIndex((t) => t.title === title);
      
      if (currentIndex === -1) return;
      
      const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= currentItems.length) return;

      const currentItem = currentItems[currentIndex];
      const swapItem = currentItems[swapIndex];

      // Swap sort orders in templates table
      await supabase.from("checklist_templates").update({ sort_order: swapItem.sortOrder }).eq("id", currentItem.id);
      await supabase.from("checklist_templates").update({ sort_order: currentItem.sortOrder }).eq("id", swapItem.id);

      // Also swap in checklist_items
      await supabase
        .from("checklist_items")
        .update({ sort_order: swapItem.sortOrder })
        .eq("title", currentItem.title)
        .eq("owner_team", team);

      await supabase
        .from("checklist_items")
        .update({ sort_order: currentItem.sortOrder })
        .eq("title", swapItem.title)
        .eq("owner_team", team);

      return { title, team, direction };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      console.error("Error reordering checklist:", error);
      toast.error("Failed to reorder checklist");
    },
  });

  const handleCSVFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n").filter(l => l.trim());
      // Expect CSV: title,team (team is optional, defaults to activeTeam)
      const teamAliases: Record<string, TeamRole> = {
        mint: "mint", integration: "integration", ms: "ms",
        MINT: "mint", Integration: "integration", MS: "ms",
      };
      const items: { title: string; team: TeamRole }[] = [];
      const startIdx = lines[0]?.toLowerCase().includes("title") ? 1 : 0;
      for (let i = startIdx; i < lines.length; i++) {
        const parts = lines[i].split(",").map(p => p.trim().replace(/^"|"$/g, ""));
        const title = parts[0];
        if (!title) continue;
        const team = teamAliases[parts[1]] || activeTeam;
        items.push({ title, team });
      }
      if (items.length === 0) {
        toast.error("No valid items found in CSV");
        return;
      }
      setCsvPreview(items);
      setCsvUploadOpen(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const bulkImportMutation = useMutation({
    mutationFn: async (items: { title: string; team: TeamRole }[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id as string).single();
      const tenantId = profile?.tenant_id;

      const existingTitles = new Set(templates.map(t => `${t.ownerTeam}|${t.title}`));
      const newItems = items.filter(i => !existingTitles.has(`${i.team}|${i.title}`));

      if (newItems.length === 0) throw new Error("All items already exist");

      // Get max sort orders per team
      const teamMaxOrders: Record<string, number> = {};
      templates.forEach(t => {
        teamMaxOrders[t.ownerTeam] = Math.max(teamMaxOrders[t.ownerTeam] ?? -1, t.sortOrder);
      });

      const templateInserts = newItems.map((item, idx) => {
        const phase = item.team === "manager" ? "ms" : item.team;
        teamMaxOrders[item.team] = (teamMaxOrders[item.team] ?? -1) + 1;
        return {
          title: item.title,
          owner_team: item.team,
          phase: phase as "mint" | "integration" | "ms",
          sort_order: teamMaxOrders[item.team],
          tenant_id: tenantId,
        };
      });

      const { error: tErr } = await supabase.from("checklist_templates").insert(templateInserts);
      if (tErr) throw tErr;

      // Add to all existing projects in this tenant only
      const { data: projects } = await supabase.from("projects").select("id, tenant_id").eq("tenant_id", tenantId as string);
      if (projects && projects.length > 0) {
        const checklistInserts = projects.flatMap(p =>
          templateInserts.map(t => ({
            project_id: p.id,
            title: t.title,
            owner_team: t.owner_team,
            phase: t.phase,
            sort_order: t.sort_order,
            completed: false,
            current_responsibility: "neutral" as const,
            tenant_id: p.tenant_id,
          }))
        );
        const { error } = await supabase.from("checklist_items").insert(checklistInserts);
        if (error) throw error;
      }

      return newItems.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`${count} checklist items imported to all projects`);
      setCsvUploadOpen(false);
      setCsvPreview([]);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to import checklist items");
    },
  });

  const handleAddItem = () => {
    if (!newItemTitle.trim()) {
      toast.error("Please enter a title");
      return;
    }
    const dur = newItemDuration.trim() ? parseInt(newItemDuration.trim(), 10) : null;
    addItemMutation.mutate({ title: newItemTitle.trim(), team: activeTeam, standardDuration: isNaN(dur as any) ? null : dur });
  };

  const handleUpdateItem = () => {
    if (!editingItem) return;
    const newTitle = editingItem.title.trim();
    if (!newTitle) {
      toast.error("Title cannot be empty");
      return;
    }
    // Find original title
    const original = templates.find((t) => t.id === editingItem.id);
    if (original && (original.title !== newTitle || original.standardDuration !== editingItem.standardDuration)) {
      updateItemMutation.mutate({ oldTitle: original.title, newTitle, team: activeTeam, templateId: editingItem.id, standardDuration: editingItem.standardDuration });
    } else {
      setEditingItem(null);
    }
  };

  // Dynamic teams management
  const [dynamicTeams, setDynamicTeams] = useState<{ id: string; name: string; slug: string; color: string; is_system: boolean }[]>([]);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState("#3b82f6");
  const [deleteTeamConfirm, setDeleteTeamConfirm] = useState<{ id: string; name: string; slug: string } | null>(null);

  useEffect(() => {
    const fetchTeams = async () => {
      const { data } = await supabase.from("teams").select("*").order("sort_order");
      if (data) setDynamicTeams(data);
    };
    fetchTeams();
  }, []);

  const addTeamMutation = useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      const slug = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id as string).single();
      const { error } = await supabase.from("teams").insert({
        name, slug, color, is_system: false, sort_order: dynamicTeams.length,
        tenant_id: profile?.tenant_id,
      });
      if (error) throw error;
      return { name, slug };
    },
    onSuccess: async () => {
      const { data } = await supabase.from("teams").select("*").order("sort_order");
      if (data) setDynamicTeams(data);
      toast.success("Team added");
      setAddTeamOpen(false);
      setNewTeamName("");
    },
    onError: (e) => toast.error(e.message || "Failed to add team"),
  });

  const deleteTeamMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      const { data } = await supabase.from("teams").select("*").order("sort_order");
      if (data) setDynamicTeams(data);
      toast.success("Team removed");
      setDeleteTeamConfirm(null);
    },
    onError: (e) => toast.error(e.message || "Failed to delete team"),
  });

  const { checklistTeamSlugs, teamLabelMap } = useTeams();
  const teams = checklistTeamSlugs.length > 0 ? checklistTeamSlugs : ["mint", "integration", "ms"];
  const getLabel = (slug: string) => teamLabels[slug as keyof typeof teamLabels] || teamLabelMap[slug] || slug;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <CardTitle className="portal-heading flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Checklist Templates
          </CardTitle>
          <div className="flex gap-2">
            <input type="file" ref={fileInputRef} accept=".csv" className="hidden" onChange={handleCSVFileSelect} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Item
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Manage checklist items that appear for all projects. Changes apply globally.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs value={activeTeam} onValueChange={(v) => setActiveTeam(v as TeamRole)}>
          <div className="border-b px-6 pt-4">
             <TabsList className="h-11 bg-muted/50 p-1">
              {teams.map((team) => (
                <TabsTrigger
                  key={team}
                  value={team}
                  className="gap-2 px-4 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  {getLabel(team)}
                  <Badge variant="secondary" className="ml-1 h-5 px-2">
                    {templates.filter((t) => t.ownerTeam === team).length}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {teams.map((team) => (
            <TabsContent key={team} value={team} className="mt-0">
              <div>
                <div className="p-6 space-y-2">
                  {templates
                    .filter((t) => t.ownerTeam === team)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((item, index, arr) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-4 bg-muted/30 rounded-lg border border-border/50 hover:border-primary/30 transition-colors group"
                      >
                        <div className="flex flex-col gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={index === 0}
                            onClick={() => reorderMutation.mutate({ title: item.title, team, direction: "up" })}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={index === arr.length - 1}
                            onClick={() => reorderMutation.mutate({ title: item.title, team, direction: "down" })}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                        
                        <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                        
                        <Badge variant="outline" className="w-8 h-6 flex items-center justify-center text-xs font-mono">
                          {index + 1}
                        </Badge>

                        <div className="flex-1">
                          {editingItem?.id === item.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={editingItem.title}
                                onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                                className="h-8 flex-1"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleUpdateItem();
                                  if (e.key === "Escape") setEditingItem(null);
                                }}
                              />
                              <Input
                                type="number"
                                min="0"
                                value={editingItem.standardDuration ?? ""}
                                onChange={(e) => setEditingItem({ ...editingItem, standardDuration: e.target.value ? parseInt(e.target.value) : null })}
                                className="h-8 w-24"
                                placeholder="Days"
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{item.title}</span>
                              {item.standardDuration != null && (
                                <Badge variant="outline" className="text-xs">{item.standardDuration}d</Badge>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {editingItem?.id === item.id ? (
                            <>
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleUpdateItem}>
                                <Save className="h-4 w-4 text-emerald-500" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingItem(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditingItem(item)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 hover:text-destructive"
                                onClick={() => setDeleteConfirm(item)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}

                  {templates.filter((t) => t.ownerTeam === team).length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>No checklist items for {getLabel(team)}</p>
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={() => setIsAddDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add First Item
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>

      {/* Add Item Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Checklist Item</DialogTitle>
            <DialogDescription>
              This item will be added to all existing and future projects for {getLabel(activeTeam)} team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Item Title</label>
              <Input
                value={newItemTitle}
                onChange={(e) => setNewItemTitle(e.target.value)}
                placeholder="Enter checklist item title..."
                onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Team</label>
              <Select value={activeTeam} onValueChange={(v) => setActiveTeam(v as TeamRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team} value={team}>
                      {getLabel(team)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Standard Duration (days)</label>
              <Input
                type="number"
                min="0"
                value={newItemDuration}
                onChange={(e) => setNewItemDuration(e.target.value)}
                placeholder="e.g. 3 (auto-calculates due date)"
              />
              <p className="text-xs text-muted-foreground">Due date = Project Start + Duration. Leave empty for no auto-date.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddItem} disabled={addItemMutation.isPending}>
              {addItemMutation.isPending ? "Adding..." : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Checklist Item
            </DialogTitle>
            <DialogDescription>
              This will permanently remove "{deleteConfirm?.title}" from ALL projects. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirm) {
                  deleteItemMutation.mutate({ title: deleteConfirm.title, team: deleteConfirm.ownerTeam, templateId: deleteConfirm.id });
                }
              }}
              disabled={deleteItemMutation.isPending}
            >
              {deleteItemMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV Upload Preview Dialog */}
      <Dialog open={csvUploadOpen} onOpenChange={setCsvUploadOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Checklist Items from CSV</DialogTitle>
            <DialogDescription>
              {csvPreview.length} item(s) found. These will be added to the template and all existing projects.
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">
                CSV format: <code>title,team</code> (team is optional — mint, integration, or ms)
              </span>
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-64">
            <div className="space-y-1 p-1">
              {csvPreview.map((item, i) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-muted/30 rounded text-sm">
                  <Badge variant="outline" className="text-xs">{i + 1}</Badge>
                  <span className="flex-1 font-medium">{item.title}</span>
                  <Badge variant="secondary" className="text-xs">{teamLabels[item.team]}</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCsvUploadOpen(false); setCsvPreview([]); }}>
              Cancel
            </Button>
            <Button onClick={() => bulkImportMutation.mutate(csvPreview)} disabled={bulkImportMutation.isPending}>
              {bulkImportMutation.isPending ? "Importing..." : `Import ${csvPreview.length} Items`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dynamic Teams Management */}
      <Card className="mt-6 shadow-sm border-border">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <CardTitle className="portal-heading flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Team Management
            </CardTitle>
            <Button onClick={() => setAddTeamOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Team
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Manage team categories for checklist organization.
          </p>
        </CardHeader>
        <CardContent className="p-6">
          {/* System Teams */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">System Teams</p>
            <div className="space-y-2">
              {teams.map(team => (
                <div key={team} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: team === "mint" ? "#3b82f6" : team === "integration" ? "#a855f7" : "#10b981" }}>
                    {(teamLabels[team] || team).charAt(0)}
                  </div>
                  <span className="font-medium flex-1">{teamLabels[team]}</span>
                  <Badge variant="secondary" className="text-xs">System</Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Teams */}
          {dynamicTeams.filter(t => !t.is_system).length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Custom Teams</p>
              <div className="space-y-2">
                {dynamicTeams.filter(t => !t.is_system).map(team => (
                  <div key={team.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/50 group">
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: team.color }}>
                      {team.name.charAt(0)}
                    </div>
                    <span className="font-medium flex-1">{team.name}</span>
                    <Badge variant="outline" className="text-xs">{team.slug}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 hover:text-destructive"
                      onClick={() => setDeleteTeamConfirm({ id: team.id, name: team.name, slug: team.slug })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dynamicTeams.filter(t => !t.is_system).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No custom teams yet. Click "Add Team" to create one.</p>
          )}
        </CardContent>
      </Card>

      {/* Add Team Dialog */}
      <Dialog open={addTeamOpen} onOpenChange={setAddTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Team</DialogTitle>
            <DialogDescription>Create a new team category for checklist organization.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Team Name</label>
              <Input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="e.g. QA Team" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={newTeamColor} onChange={(e) => setNewTeamColor(e.target.value)} className="h-10 w-14 rounded border cursor-pointer" />
                <Input value={newTeamColor} onChange={(e) => setNewTeamColor(e.target.value)} className="flex-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTeamOpen(false)}>Cancel</Button>
            <Button onClick={() => addTeamMutation.mutate({ name: newTeamName.trim(), color: newTeamColor })} disabled={!newTeamName.trim() || addTeamMutation.isPending}>
              {addTeamMutation.isPending ? "Adding..." : "Add Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Team Confirmation */}
      <Dialog open={!!deleteTeamConfirm} onOpenChange={() => setDeleteTeamConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Team
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTeamConfirm?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTeamConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTeamConfirm && deleteTeamMutation.mutate(deleteTeamConfirm.id)} disabled={deleteTeamMutation.isPending}>
              {deleteTeamMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
