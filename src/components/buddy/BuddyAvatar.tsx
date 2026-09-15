import buddyIcon from "@/assets/buddy-icon.png.asset.json";
import { cn } from "@/lib/utils";

/** Buddy's one identity, used everywhere Buddy appears. */
export const BuddyAvatar = ({ size = 24, className }: { size?: number; className?: string }) => (
  <img
    src={buddyIcon.url}
    alt=""
    width={size}
    height={size}
    className={cn("shrink-0 rounded-md object-cover", className)}
    style={{ width: size, height: size }}
  />
);
