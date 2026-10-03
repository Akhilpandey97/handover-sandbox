/**
 * One colour, set once, applied to every brand token.
 *
 * The product's blue lives in CSS variables — the navy hex plus the HSL triplets the
 * theme reads for primary, the focus ring and the nav. Rather than ask a workspace to
 * set six values that must agree, it sets one and the rest are derived here.
 */

export const DEFAULT_BRAND_COLOR = "#0074F8";

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl | null {
  const clean = hex.trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const triplet = ({ h, s, l }: Hsl) => `${h} ${s}% ${l}%`;

/**
 * Write the brand colour onto the document.
 *
 * Only the tokens that carry brand meaning move: the accent colour, the nav, the focus
 * ring. Text, surfaces, and the status colours (success, warning, destructive) are left
 * alone — they mean something other than "us".
 */
export function applyBrandColor(hex: string, isDark = false): void {
  if (typeof document === "undefined") return;
  const base = hexToHsl(hex);
  if (!base) return;

  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  // bg-navy and friends resolve through this at runtime.
  set("--brand-hex", hex);

  if (isDark) {
    // Lifted so it holds up against dark surfaces.
    const primary = { ...base, l: clamp(base.l + 13, 45, 75) };
    set("--primary", triplet(primary));
    set("--primary-glow", triplet({ ...primary, l: clamp(primary.l + 6) }));
    set("--primary-light", triplet({ ...primary, l: clamp(primary.l + 10) }));
    set("--primary-soft", triplet({ h: base.h, s: clamp(base.s - 40, 20, 70), l: 20 }));
    set("--ring", triplet(primary));
    set("--sidebar-primary", triplet({ ...primary, l: clamp(primary.l - 2) }));
    return;
  }

  set("--primary", triplet(base));
  set("--primary-glow", triplet({ ...base, l: clamp(base.l + 9) }));
  set("--primary-light", triplet({ ...base, l: clamp(base.l + 11) }));
  set("--primary-soft", triplet({ ...base, l: 96 }));
  set("--ring", triplet(base));
  set("--hero", triplet(base));

  // The nav is the brand surface: the colour itself, with a darker step for hover and
  // borders so the active item still reads.
  set("--sidebar-background", triplet(base));
  set("--sidebar-foreground", "0 0% 100%");
  set("--sidebar-primary", "0 0% 100%");
  set("--sidebar-primary-foreground", triplet({ ...base, l: clamp(base.l - 9, 15, 45) }));
  set("--sidebar-accent", triplet({ ...base, l: clamp(base.l - 7, 12, 60) }));
  set("--sidebar-accent-foreground", "0 0% 100%");
  set("--sidebar-border", triplet({ ...base, l: clamp(base.l - 7, 12, 60) }));
  set("--sidebar-ring", "0 0% 100%");
}

/**
 * The most brand-like colour in a logo.
 *
 * Averaging a logo gives mud, and the commonest pixel is usually its background, so
 * near-white, near-black and grey pixels are dropped and what remains is bucketed by
 * hue; the biggest bucket wins. Returns null when a logo has no colour to speak of —
 * a black wordmark, say — rather than guessing.
 */
export async function extractLogoColor(url: string): Promise<string | null> {
  if (typeof document === "undefined") return null;

  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  if (!image) return null;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(image, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    // The logo is served without CORS headers; the canvas is tainted.
    return null;
  }

  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2 / 255;
    const s = max === min ? 0 : (max - min) / (255 - Math.abs(2 * l * 255 - 255));
    if (l > 0.92 || l < 0.08 || s < 0.25) continue; // background, outline, grey

    const hsl = hexToHsl(
      `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
    );
    if (!hsl) continue;

    const bucket = Math.round(hsl.h / 15);
    const current = buckets.get(bucket) || { count: 0, r: 0, g: 0, b: 0 };
    buckets.set(bucket, { count: current.count + 1, r: current.r + r, g: current.g + g, b: current.b + b });
  }

  const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!best || best.count < 12) return null;

  const avg = [best.r / best.count, best.g / best.count, best.b / best.count].map((v) =>
    Math.round(v).toString(16).padStart(2, "0"),
  );
  return `#${avg.join("")}`.toUpperCase();
}
