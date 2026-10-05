import { cn } from "@/lib/utils";

/**
 * Buddy's one identity, used everywhere Buddy appears.
 *
 * Drawn rather than fetched: the previous avatar was a PNG on an asset host that
 * does not exist in this deployment, so every Buddy avatar in production was a
 * broken image. An inline mark cannot 404, scales from the 16px nav row to the
 * launcher without a second file, and takes its colour from whatever it sits on.
 *
 * The mark is a speech bubble with a check inside it: Buddy talks, and the work
 * gets done. A sparkle would have said "AI" and nothing about this product.
 */
export const BuddyAvatar = ({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) => {
  // Hairlines disappear at nav size, so the small end carries a little more weight.
  const bubble = size <= 18 ? 2 : 1.7;
  const check = size <= 18 ? 2.3 : 2;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label="Buddy"
      className={cn("shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <path
        d="M5 3.8h14a2.2 2.2 0 0 1 2.2 2.2v8a2.2 2.2 0 0 1-2.2 2.2h-6.3l-4.4 3.5a.8.8 0 0 1-1.3-.6v-2.9H5A2.2 2.2 0 0 1 2.8 14V6A2.2 2.2 0 0 1 5 3.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={bubble}
        strokeLinejoin="round"
      />
      <path
        d="m8.4 10.1 2.5 2.5 4.7-4.9"
        fill="none"
        stroke="currentColor"
        strokeWidth={check}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
