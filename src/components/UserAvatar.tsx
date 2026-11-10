import { cn } from "@/lib/utils";

interface Props {
  name: string;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const SIZE = {
  xs: "h-5 w-5 text-2xs",
  sm: "h-6 w-6 text-2xs",
  md: "h-8 w-8 text-xs",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserAvatar({ name, avatarUrl, size = "xs", className }: Props) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-primary flex items-center justify-center font-semibold text-primary-foreground overflow-hidden",
        SIZE[size],
        className,
      )}
      title={name}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
