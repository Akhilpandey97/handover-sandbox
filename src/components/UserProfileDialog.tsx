import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Loader2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AuthUser } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function UserProfileDialog({ open, onOpenChange }: Props) {
  const { currentUser } = useAuth();
  const { teamLabels } = useLabels();

  const [name, setName] = useState(currentUser?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(currentUser?.avatarUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync local state when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setName(currentUser?.name ?? "");
      setAvatarUrl(currentUser?.avatarUrl ?? null);
    }
    onOpenChange(v);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be smaller than 2 MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${currentUser.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      // Bust cache with timestamp
      const url = `${publicUrl}?t=${Date.now()}`;
      setAvatarUrl(url);

      // Save to profile immediately
      await supabase.from("profiles").update({ avatar_url: url } as any).eq("id", currentUser.id);
      toast.success("Profile picture updated");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to upload image");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!currentUser || !name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ name: name.trim() } as any)
        .eq("id", currentUser.id);
      if (error) throw error;
      toast.success("Profile updated — refresh to see changes");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!currentUser) return null;

  const initials = currentUser.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const teamLabel = teamLabels[currentUser.team] || currentUser.team;
  const isAdmin = ["admin", "super_admin", "superadmin", "manager"].includes(currentUser.team);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        {/* Header band */}
        <div className="h-20 bg-gradient-to-br from-primary/80 to-primary" />

        <div className="px-6 pb-6">
          {/* Avatar */}
          <div className="relative -mt-10 mb-4 w-fit">
            <div className="h-20 w-20 rounded-full border-4 border-background overflow-hidden bg-primary flex items-center justify-center shadow-md">
              {avatarUrl ? (
                <img src={avatarUrl} alt={currentUser.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-primary-foreground">{initials}</span>
              )}
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full">
                  <Loader2 className="h-6 w-6 text-white animate-spin" />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute bottom-0 right-0 h-7 w-7 flex items-center justify-center rounded-full bg-background border border-border shadow-sm hover:bg-muted transition-colors disabled:opacity-50"
              title="Upload profile picture"
            >
              <Camera className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>

          <DialogHeader className="mb-4 text-left">
            <DialogTitle className="text-base">{currentUser.name}</DialogTitle>
            <p className="text-xs text-muted-foreground">{currentUser.email}</p>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Display name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="h-9 text-sm"
              />
            </div>

            {/* Email — read-only */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email</Label>
              <Input
                value={currentUser.email}
                readOnly
                disabled
                className="h-9 text-sm bg-muted/40"
              />
            </div>

            {/* Team — read-only for non-admins */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Team / Role</Label>
              <Input
                value={teamLabel}
                readOnly
                disabled
                className="h-9 text-sm bg-muted/40"
              />
              {!isAdmin && (
                <p className="text-2xs text-muted-foreground">Contact an admin to change your team.</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1 h-9 text-sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-9 text-sm"
                onClick={handleSave}
                disabled={saving || !name.trim() || name.trim() === currentUser.name}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
