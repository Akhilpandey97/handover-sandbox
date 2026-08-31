import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { toast } from "sonner";
import { Upload, Trash2, ImageIcon, Loader2 } from "lucide-react";

export const LogoUpload = () => {
  const { currentUser } = useAuth();
  const { labels, updateLabels } = useLabels();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const logoUrl = labels.org_logo_url || "";

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2MB");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${currentUser?.tenantId || "default"}/logo.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("org-logos")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("org-logos")
        .getPublicUrl(path);

      const publicUrl = urlData.publicUrl + "?t=" + Date.now();

      await updateLabels({ org_logo_url: publicUrl });
      toast.success("Logo uploaded successfully");
    } catch (err: any) {
      console.error("Logo upload error:", err);
      toast.error("Failed to upload logo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    try {
      await updateLabels({ org_logo_url: "" });
      toast.success("Logo removed");
    } catch {
      toast.error("Failed to remove logo");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          Organisation Logo
        </CardTitle>
        <CardDescription>
          Upload your organisation logo. It will appear in the header across all screens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          {/* Preview */}
          <div className="h-20 w-20 rounded-xl border-2 border-dashed border-border flex items-center justify-center bg-muted/30 overflow-hidden shrink-0">
            {logoUrl ? (
              <img src={logoUrl} alt="Org Logo" className="h-full w-full object-contain p-1" />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
            )}
          </div>

          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground">
              Recommended: Square image, PNG or SVG, max 2MB
            </Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="gap-1.5"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploading ? "Uploading..." : logoUrl ? "Replace Logo" : "Upload Logo"}
              </Button>
              {logoUrl && (
                <Button variant="ghost" size="sm" onClick={handleRemove} className="gap-1.5 text-destructive">
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
