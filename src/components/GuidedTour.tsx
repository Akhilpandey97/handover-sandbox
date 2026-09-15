import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { X, ArrowRight, ArrowLeft, Zap } from "lucide-react";

export interface TourStep {
  target?: string;          // CSS selector — omit for centered intro/outro
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
}

interface Props {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
  merchantName?: string;
  brandColor?: string;
}

const PADDING = 8;
const TOOLTIP_W = 340;
const TOOLTIP_GAP = 14;

export const GuidedTour = ({ steps, open, onClose, merchantName, brandColor = "#1e3a8a" }: Props) => {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [tick, setTick] = useState(0);

  const step = steps[idx];

  // Find target rect
  useLayoutEffect(() => {
    if (!open) return;
    if (!step?.target) { setRect(null); return; }
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    setRect(r);
  }, [open, step, tick]);

  // Re-measure on resize/scroll
  useEffect(() => {
    if (!open) return;
    const handler = () => setTick((t) => t + 1);
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    const id = window.setInterval(handler, 400); // catch layout shifts
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
      window.clearInterval(id);
    };
  }, [open]);

  const next = useCallback(() => {
    if (idx < steps.length - 1) setIdx(idx + 1);
    else onClose();
  }, [idx, steps.length, onClose]);
  const prev = () => setIdx((i) => Math.max(0, i - 1));

  // Keyboard
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, next, onClose]);

  if (!open || !step) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Compute spotlight + tooltip position
  let highlight: { top: number; left: number; width: number; height: number } | null = null;
  let tipStyle: React.CSSProperties = {};
  let isCentered = false;

  if (rect && rect.width > 0 && rect.height > 0) {
    highlight = {
      top: rect.top - PADDING,
      left: rect.left - PADDING,
      width: rect.width + PADDING * 2,
      height: rect.height + PADDING * 2,
    };

    // Decide placement automatically
    const spaceRight = vw - rect.right;
    const spaceBelow = vh - rect.bottom;
    const placement =
      step.placement && step.placement !== "auto"
        ? step.placement
        : spaceRight >= TOOLTIP_W + TOOLTIP_GAP
        ? "right"
        : spaceBelow >= 220
        ? "bottom"
        : rect.top >= 220
        ? "top"
        : "right";

    if (placement === "right") {
      tipStyle = {
        top: Math.min(Math.max(8, rect.top), vh - 240),
        left: rect.right + TOOLTIP_GAP,
        width: TOOLTIP_W,
      };
    } else if (placement === "left") {
      tipStyle = {
        top: Math.min(Math.max(8, rect.top), vh - 240),
        left: Math.max(8, rect.left - TOOLTIP_W - TOOLTIP_GAP),
        width: TOOLTIP_W,
      };
    } else if (placement === "bottom") {
      tipStyle = {
        top: rect.bottom + TOOLTIP_GAP,
        left: Math.min(Math.max(8, rect.left), vw - TOOLTIP_W - 8),
        width: TOOLTIP_W,
      };
    } else {
      tipStyle = {
        top: Math.max(8, rect.top - 200),
        left: Math.min(Math.max(8, rect.left), vw - TOOLTIP_W - 8),
        width: TOOLTIP_W,
      };
    }
  } else {
    isCentered = true;
    tipStyle = {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: Math.min(TOOLTIP_W + 60, vw - 32),
    };
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Mask with hole using SVG for crisp edges */}
      <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={onClose}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {highlight && (
              <rect
                x={highlight.left}
                y={highlight.top}
                width={highlight.width}
                height={highlight.height}
                rx={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(2, 6, 23, 0.72)" mask="url(#tour-mask)" />
      </svg>

      {/* Highlight border */}
      {highlight && (
        <div
          className="absolute rounded-[10px] pointer-events-none transition-all duration-200"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
            boxShadow: `0 0 0 3px ${brandColor}, 0 0 0 6px rgba(255,255,255,0.25)`,
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="absolute bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border overflow-hidden"
        style={tipStyle}
      >
        <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ background: brandColor }}>
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="w-4 h-4 text-white flex-shrink-0" fill="white" />
            <p className="text-xs font-semibold text-white truncate">
              {isCentered && idx === 0 && merchantName
                ? `Welcome, ${merchantName}`
                : `Step ${idx + 1} of ${steps.length}`}
            </p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close tour">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <h3 className="heading-card text-foreground mb-1.5">{step.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{step.body}</p>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/60">
          <button
            onClick={onClose}
            className="text-2xs font-medium text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={prev}
              disabled={idx === 0}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </button>
            <button
              onClick={next}
              className="px-3 py-1.5 rounded-md text-xs font-semibold text-white flex items-center gap-1 hover:opacity-90"
              style={{ background: brandColor }}
            >
              {idx === steps.length - 1 ? "Finish" : "Next"}
              {idx < steps.length - 1 && <ArrowRight className="w-3 h-3" />}
            </button>
          </div>
        </div>
        {/* Progress dots */}
        <div className="px-4 pb-3 flex items-center gap-1.5">
          {steps.map((_, i) => (
            <span
              key={i}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: i <= idx ? brandColor : "rgba(148,163,184,0.3)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
