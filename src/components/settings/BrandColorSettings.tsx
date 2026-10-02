import { useState } from "react";
import { toast } from "sonner";
import { useLabels } from "@/contexts/LabelsContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Palette, Wand2, RotateCcw } from "lucide-react";
import { DEFAULT_BRAND_COLOR, extractLogoColor, hexToHsl } from "@/lib/brand-color";

/**
 * The one colour that defines the product: nav, buttons, links, focus rings and the
 * emails that go out. Everything else on this page is a category colour — teams,
 * states — which mean something other than "us".
 */
export const BrandColorSettings = () => {
  const { labels, updateLabels } = useLabels();
  const saved = labels["color_brand"] || DEFAULT_BRAND_COLOR;
  const logoUrl = labels["org_logo_url"] || "";

  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);

  const valid = !!hexToHsl(value);
  const dirty = value.toUpperCase() !== saved.toUpperCase();

  const save = async (hex: string) => {
    if (!hexToHsl(hex)) {
      toast.error("That is not a colour", { description: "Use a hex value such as #0074F8." });
      return;
    }
    setSaving(true);
    try {
      await updateLabels({ color_brand: hex.toUpperCase() });
      toast.success("Brand colour updated");
    } finally {
      setSaving(false);
    }
  };

  const readFromLogo = async () => {
    if (!logoUrl) {
      toast.error("No logo uploaded", { description: "Upload a logo first, under Branding." });
      return;
    }
    setReading(true);
    try {
      const hex = await extractLogoColor(logoUrl);
      if (!hex) {
        toast.error("Could not read a colour from the logo", {
          description: "It may be black and white, or served without permission to read it.",
        });
        return;
      }
      setValue(hex);
      await save(hex);
    } finally {
      setReading(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="portal-heading flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          Brand colour
        </CardTitle>
        <CardDescription>
          Used for the navigation, buttons, links and the emails this workspace sends. Set from your
          logo the first time one is uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="brand-colour" className="text-xs">
              Colour
            </Label>
            <div className="flex items-center gap-2">
              <input
                id="brand-colour"
                type="color"
                value={valid ? value : DEFAULT_BRAND_COLOR}
                onChange={(event) => setValue(event.target.value.toUpperCase())}
                className="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent p-1"
                aria-label="Brand colour"
              />
              <Input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={DEFAULT_BRAND_COLOR}
                className={`h-9 w-32 font-mono text-sm ${valid ? "" : "border-destructive"}`}
              />
            </div>
          </div>

          <Button onClick={() => save(value)} disabled={!valid || !dirty || saving} className="h-9">
            {saving ? "Saving…" : "Save"}
          </Button>

          <Button
            variant="outline"
            className="h-9 gap-1.5"
            onClick={readFromLogo}
            disabled={reading || !logoUrl}
            title={logoUrl ? "Read the dominant colour from the logo" : "Upload a logo first"}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {reading ? "Reading…" : "Use logo colour"}
          </Button>

          <Button
            variant="ghost"
            className="h-9 gap-1.5 text-muted-foreground"
            onClick={() => {
              setValue(DEFAULT_BRAND_COLOR);
              void save(DEFAULT_BRAND_COLOR);
            }}
            disabled={saving}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>

        {/* What it will look like, before committing to it. */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <span className="text-xs text-muted-foreground">Preview</span>
          <span
            className="inline-flex h-8 items-center rounded-md px-3 text-sm font-semibold text-white"
            style={{ backgroundColor: valid ? value : DEFAULT_BRAND_COLOR }}
          >
            Button
          </span>
          <span
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium"
            style={{ color: valid ? value : DEFAULT_BRAND_COLOR, borderColor: valid ? value : DEFAULT_BRAND_COLOR }}
          >
            Link
          </span>
          <span
            className="inline-flex h-8 w-24 items-center rounded-md px-3 text-xs font-medium text-white"
            style={{ backgroundColor: valid ? value : DEFAULT_BRAND_COLOR }}
          >
            Navigation
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
