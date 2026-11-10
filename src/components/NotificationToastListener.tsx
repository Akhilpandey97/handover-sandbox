import { useEffect } from "react";
import { toast } from "sonner";
import { AppNotification } from "@/hooks/useNotifications";

const bellKeyframes = `
@keyframes notif-bell {
  0%   { transform: rotate(0deg) scale(1); }
  15%  { transform: rotate(-18deg) scale(1.15); }
  30%  { transform: rotate(14deg) scale(1.1); }
  45%  { transform: rotate(-10deg) scale(1.05); }
  60%  { transform: rotate(6deg) scale(1.02); }
  75%  { transform: rotate(-3deg) scale(1); }
  100% { transform: rotate(0deg) scale(1); }
}
@keyframes notif-in {
  from { opacity: 0; transform: scale(0.94) translateY(-6px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
`;

export const NotificationToastListener = () => {
  useEffect(() => {
    // Inject keyframes once
    const styleId = "notif-toast-keyframes";
    if (!document.getElementById(styleId)) {
      const s = document.createElement("style");
      s.id = styleId;
      s.textContent = bellKeyframes;
      document.head.appendChild(s);
    }

    const handler = (e: Event) => {
      const n = (e as CustomEvent<AppNotification>).detail;
      toast.custom(
        (id) => (
          <div
            onClick={() => toast.dismiss(id)}
            className="pointer-events-auto flex w-full max-w-lg cursor-pointer gap-4 rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10"
            style={{ minWidth: 360, animation: "notif-in 0.28s cubic-bezier(0.22,1,0.36,1) both" }}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl select-none"
              style={{ animation: "notif-bell 0.6s ease-out 0.15s both" }}
            >
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
              onClick={(ev) => { ev.stopPropagation(); toast.dismiss(id); }}
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
