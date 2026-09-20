import { useCallback, useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { BuddyAvatar } from "./BuddyAvatar";
import { BuddyChat } from "./BuddyChat";

const OPEN_KEY = "buddy:drawer-open";

/**
 * Buddy beside whatever you're working on.
 *
 * A side panel rather than a floating box, opened with ⌘J / Ctrl+J. It knows
 * the page it opened on (a project page passes that project to Buddy), and it
 * stays out of the way on the Buddy tab, where the full page already is.
 */
export const BuddyDrawer = () => {
  const { currentUser } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setOpenPersist = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const onBuddyTab = pathname.startsWith("/hi-there");
  // Customer-facing pages are not ours to put an internal assistant on.
  const customerPage = ["/portal", "/brd", "/reset-password"].some((path) => pathname.startsWith(path));

  useEffect(() => {
    if (onBuddyTab) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpenPersist(!open);
      } else if (e.key === "Escape" && open && panelRef.current?.contains(document.activeElement)) {
        setOpenPersist(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onBuddyTab, setOpenPersist]);

  useEffect(() => {
    if (open) window.setTimeout(() => panelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 50);
  }, [open, pathname]);

  if (!currentUser || onBuddyTab || customerPage) return null;

  const projectId = pathname.match(/^\/projects\/([^/?#]+)/)?.[1] ?? null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpenPersist(true)}
          aria-label="Open Buddy"
          title="Open Buddy (⌘J)"
          className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-sidebar shadow-lg ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BuddyAvatar size={30} className="rounded-full" />
        </button>
      )}
      <div
        ref={panelRef}
        role="complementary"
        aria-label="Buddy"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-[60] w-[min(440px,100vw)] border-l border-border bg-card shadow-2xl transition-transform duration-200 motion-reduce:transition-none",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        {open && <BuddyChat variant="drawer" page={{ path: pathname, projectId }} onClose={() => setOpenPersist(false)} />}
      </div>
    </>
  );
};
