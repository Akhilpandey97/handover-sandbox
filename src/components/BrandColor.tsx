import { useEffect } from "react";
import { useLabelsOptional } from "@/contexts/LabelsContext";
import { DEFAULT_BRAND_COLOR, applyBrandColor, extractLogoColor } from "@/lib/brand-color";

/**
 * Applies the workspace's brand colour, and sets it from the logo the first time.
 *
 * Renders nothing: it writes CSS variables, so every token that carries brand meaning
 * follows one setting. A workspace that has uploaded a logo and never opened Settings
 * still gets its own colour rather than ours.
 */
export const BrandColor = () => {
  const ctx = useLabelsOptional();
  const brand = ctx?.labels?.["color_brand"] || "";
  const logo = ctx?.labels?.["org_logo_url"] || "";
  const updateLabels = ctx?.updateLabels;

  useEffect(() => {
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    applyBrandColor(brand || DEFAULT_BRAND_COLOR, isDark);
  }, [brand]);

  // Nothing chosen yet: read the logo once and keep what it gives.
  useEffect(() => {
    if (brand || !logo || !updateLabels) return;
    let cancelled = false;
    void extractLogoColor(logo).then((hex) => {
      if (!cancelled && hex) void updateLabels({ color_brand: hex });
    });
    return () => {
      cancelled = true;
    };
  }, [brand, logo, updateLabels]);

  return null;
};
