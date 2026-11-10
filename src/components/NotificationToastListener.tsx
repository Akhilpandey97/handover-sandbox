import { useEffect } from "react";
import { toast } from "sonner";
import { AppNotification } from "@/hooks/useNotifications";

/**
 * Mounts once in the app shell. Listens for "app:notification" events fired by
 * useNotifications when a new notification arrives via real-time, then renders
 * a prominent top-center toast banner.
 */
export const NotificationToastListener = () => {
  useEffect(() => {
    const handler = (e: Event) => {
      const n = (e as CustomEvent<AppNotification>).detail;
      toast.custom(
        (id) => (
          <div
            onClick={() => toast.dismiss(id)}
            className="pointer-events-auto flex w-full max-w-lg cursor-pointer gap-4 rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10"
            style={{ minWidth: 360 }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl select-none">
              🔔
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground leading-snug">{n.title}</p>
              {n.body && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
              )}
              {n.actor_name && (
                <p className="mt-1.5 text-2xs text-muted-foreground/70">from {n.actor_name}</p>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toast.dismiss(id); }}
              className="shrink-0 self-start text-muted-foreground/50 hover:text-foreground text-base leading-none"
            >
              ✕
            </button>
          </div>
        ),
        { duration: 8000, position: "top-center" },
      );
    };

    window.addEventListener("app:notification", handler);
    return () => window.removeEventListener("app:notification", handler);
  }, []);

  return null;
};
