import { useState } from "react";
import { X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiChatBot } from "./AiChatBot";
import buddyIcon from "@/assets/buddy-icon.png.asset.json";

/**
 * A small floating Buddy launcher available on every dashboard screen, so the
 * assistant can be asked something in context without leaving the page.
 */
export const BuddyBubble = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div
          className={cn(
            "fixed bottom-20 right-4 z-50 flex h-[520px] w-[380px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-7rem)]",
            "flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl",
          )}
        >
          <div className="flex items-center justify-between gap-2 bg-sidebar px-3 py-2">
            <div className="flex items-center gap-2">
              <img src={buddyIcon.url} alt="" className="h-6 w-6 rounded-md" />
              <span className="text-sm font-semibold text-sidebar-foreground">Buddy</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Minimize Buddy"
              className="rounded-md p-1 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <AiChatBot />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close Buddy" : "Chat with Buddy"}
        className={cn(
          "fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full",
          "bg-sidebar text-sidebar-foreground shadow-lg ring-1 ring-border transition-transform hover:scale-105",
        )}
      >
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <img src={buddyIcon.url} alt="" className="h-8 w-8 rounded-full" />
        )}
      </button>
    </>
  );
};
