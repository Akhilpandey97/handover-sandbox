import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Palette, Check, Sparkles } from "lucide-react";

interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: Record<string, string>;
  preview: string[]; // 5 preview colors
}

const THEME_PRESETS: ThemePreset[] = [
  {
    id: "corporate-blue",
    name: "Corporate Blue",
    description: "Professional enterprise blue – clean and trustworthy",
    preview: ["#3b82f6", "#10b981", "#a855f7", "#6b7280", "#f59e0b"],
    colors: {
      color_team_mint_badge: "#3b82f6",
      color_team_integration_badge: "#a855f7",
      color_team_ms_badge: "#10b981",
      color_team_completed_badge: "#6b7280",
      color_card_mint_bg: "#eff6ff",
      color_card_integration_bg: "#faf5ff",
      color_card_ms_bg: "#ecfdf5",
      color_card_completed_bg: "#f9fafb",
      color_state_not_started: "#6b7280",
      color_state_on_hold: "#f59e0b",
      color_state_in_progress: "#3b82f6",
      color_state_live: "#10b981",
      color_state_blocked: "#ef4444",
      color_kpi_total: "#3b82f6",
      color_kpi_pending: "#f59e0b",
      color_kpi_active: "#3b82f6",
      color_kpi_live: "#10b981",
      color_team_perf_total: "#6b7280",
      color_team_perf_pending: "#f59e0b",
      color_team_perf_active: "#3b82f6",
      color_team_perf_completed: "#10b981",
      color_time_internal: "#3b82f6",
      color_time_external: "#f59e0b",
    },
  },
  {
    id: "midnight-indigo",
    name: "Midnight Indigo",
    description: "Deep indigo with vibrant accents – modern fintech feel",
    preview: ["#6366f1", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316"],
    colors: {
      color_team_mint_badge: "#6366f1",
      color_team_integration_badge: "#8b5cf6",
      color_team_ms_badge: "#06b6d4",
      color_team_completed_badge: "#64748b",
      color_card_mint_bg: "#eef2ff",
      color_card_integration_bg: "#f5f3ff",
      color_card_ms_bg: "#ecfeff",
      color_card_completed_bg: "#f8fafc",
      color_state_not_started: "#64748b",
      color_state_on_hold: "#f97316",
      color_state_in_progress: "#6366f1",
      color_state_live: "#06b6d4",
      color_state_blocked: "#ec4899",
      color_kpi_total: "#6366f1",
      color_kpi_pending: "#f97316",
      color_kpi_active: "#8b5cf6",
      color_kpi_live: "#06b6d4",
      color_team_perf_total: "#64748b",
      color_team_perf_pending: "#f97316",
      color_team_perf_active: "#6366f1",
      color_team_perf_completed: "#06b6d4",
      color_time_internal: "#6366f1",
      color_time_external: "#f97316",
    },
  },
  {
    id: "forest-green",
    name: "Forest & Earth",
    description: "Natural greens with warm earth tones – organic and calm",
    preview: ["#059669", "#d97706", "#0891b2", "#7c3aed", "#dc2626"],
    colors: {
      color_team_mint_badge: "#059669",
      color_team_integration_badge: "#0891b2",
      color_team_ms_badge: "#d97706",
      color_team_completed_badge: "#57534e",
      color_card_mint_bg: "#ecfdf5",
      color_card_integration_bg: "#ecfeff",
      color_card_ms_bg: "#fffbeb",
      color_card_completed_bg: "#fafaf9",
      color_state_not_started: "#57534e",
      color_state_on_hold: "#d97706",
      color_state_in_progress: "#059669",
      color_state_live: "#0891b2",
      color_state_blocked: "#dc2626",
      color_kpi_total: "#059669",
      color_kpi_pending: "#d97706",
      color_kpi_active: "#0891b2",
      color_kpi_live: "#059669",
      color_team_perf_total: "#57534e",
      color_team_perf_pending: "#d97706",
      color_team_perf_active: "#059669",
      color_team_perf_completed: "#0891b2",
      color_time_internal: "#059669",
      color_time_external: "#d97706",
    },
  },
  {
    id: "sunset-warm",
    name: "Sunset Glow",
    description: "Warm oranges and reds with deep teal – bold and energetic",
    preview: ["#ea580c", "#dc2626", "#0d9488", "#7c3aed", "#ca8a04"],
    colors: {
      color_team_mint_badge: "#ea580c",
      color_team_integration_badge: "#7c3aed",
      color_team_ms_badge: "#0d9488",
      color_team_completed_badge: "#78716c",
      color_card_mint_bg: "#fff7ed",
      color_card_integration_bg: "#f5f3ff",
      color_card_ms_bg: "#f0fdfa",
      color_card_completed_bg: "#fafaf9",
      color_state_not_started: "#78716c",
      color_state_on_hold: "#ca8a04",
      color_state_in_progress: "#ea580c",
      color_state_live: "#0d9488",
      color_state_blocked: "#dc2626",
      color_kpi_total: "#ea580c",
      color_kpi_pending: "#ca8a04",
      color_kpi_active: "#7c3aed",
      color_kpi_live: "#0d9488",
      color_team_perf_total: "#78716c",
      color_team_perf_pending: "#ca8a04",
      color_team_perf_active: "#ea580c",
      color_team_perf_completed: "#0d9488",
      color_time_internal: "#ea580c",
      color_time_external: "#ca8a04",
    },
  },
  {
    id: "ocean-breeze",
    name: "Ocean Breeze",
    description: "Cool blues and cyans with seafoam highlights – serene",
    preview: ["#0284c7", "#0891b2", "#2dd4bf", "#8b5cf6", "#f43f5e"],
    colors: {
      color_team_mint_badge: "#0284c7",
      color_team_integration_badge: "#8b5cf6",
      color_team_ms_badge: "#0891b2",
      color_team_completed_badge: "#6b7280",
      color_card_mint_bg: "#f0f9ff",
      color_card_integration_bg: "#f5f3ff",
      color_card_ms_bg: "#ecfeff",
      color_card_completed_bg: "#f9fafb",
      color_state_not_started: "#6b7280",
      color_state_on_hold: "#f59e0b",
      color_state_in_progress: "#0284c7",
      color_state_live: "#0891b2",
      color_state_blocked: "#f43f5e",
      color_kpi_total: "#0284c7",
      color_kpi_pending: "#f59e0b",
      color_kpi_active: "#0891b2",
      color_kpi_live: "#2dd4bf",
      color_team_perf_total: "#6b7280",
      color_team_perf_pending: "#f59e0b",
      color_team_perf_active: "#0284c7",
      color_team_perf_completed: "#0891b2",
      color_time_internal: "#0284c7",
      color_time_external: "#f59e0b",
    },
  },
  {
    id: "royal-purple",
    name: "Royal Purple",
    description: "Rich purples with gold accents – luxurious and premium",
    preview: ["#7c3aed", "#a855f7", "#eab308", "#0ea5e9", "#e11d48"],
    colors: {
      color_team_mint_badge: "#7c3aed",
      color_team_integration_badge: "#a855f7",
      color_team_ms_badge: "#0ea5e9",
      color_team_completed_badge: "#71717a",
      color_card_mint_bg: "#f5f3ff",
      color_card_integration_bg: "#faf5ff",
      color_card_ms_bg: "#f0f9ff",
      color_card_completed_bg: "#fafafa",
      color_state_not_started: "#71717a",
      color_state_on_hold: "#eab308",
      color_state_in_progress: "#7c3aed",
      color_state_live: "#0ea5e9",
      color_state_blocked: "#e11d48",
      color_kpi_total: "#7c3aed",
      color_kpi_pending: "#eab308",
      color_kpi_active: "#a855f7",
      color_kpi_live: "#0ea5e9",
      color_team_perf_total: "#71717a",
      color_team_perf_pending: "#eab308",
      color_team_perf_active: "#7c3aed",
      color_team_perf_completed: "#0ea5e9",
      color_time_internal: "#7c3aed",
      color_time_external: "#eab308",
    },
  },
];

interface ThemePresetsProps {
  onApply: (colors: Record<string, string>) => void;
  currentColors: Record<string, string>;
}

export const ThemePresets = ({ onApply, currentColors }: ThemePresetsProps) => {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  const handleApply = (preset: ThemePreset) => {
    onApply(preset.colors);
    setSelectedTheme(preset.id);
    toast.success(`Applied "${preset.name}" theme — remember to save!`);
  };

  // Check if current colors match a preset
  const isActive = (preset: ThemePreset) => {
    return Object.entries(preset.colors).every(
      ([key, val]) => currentColors[key] === val
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Theme Presets
        </CardTitle>
        <CardDescription>
          Apply a pre-designed colour theme across all UI elements. You can customise individual colours below after applying.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {THEME_PRESETS.map((preset) => {
            const active = isActive(preset);
            return (
              <div
                key={preset.id}
                className={`relative rounded-xl border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                  active
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/50"
                }`}
                onClick={() => handleApply(preset)}
              >
                {active && (
                  <div className="absolute top-2 right-2">
                    <Badge className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5">
                      <Check className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  </div>
                )}
                <h4 className="font-semibold text-sm mb-1">{preset.name}</h4>
                <p className="text-xs text-muted-foreground mb-3">{preset.description}</p>
                <div className="flex gap-1.5">
                  {preset.preview.map((color, i) => (
                    <div
                      key={i}
                      className="h-7 flex-1 rounded-md border border-border/50"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
