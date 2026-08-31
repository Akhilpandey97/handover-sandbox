import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Skeleton for the ProjectWorkspace page — mirrors the three-panel layout */
export const WorkspaceSkeleton = ({ inModal = false }: { inModal?: boolean }) => (
  <div className={cn("bg-background", inModal ? "min-h-full" : "min-h-screen")}>
    {/* Top bar */}
    <div className="border-b border-border px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>

    <div className="flex flex-col lg:flex-row gap-0">
      {/* Left panel */}
      <div className="w-full lg:w-72 border-r border-border p-4 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        ))}
        <div className="pt-2 space-y-2">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Center panel */}
      <div className="flex-1 p-4 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-md" />
          ))}
        </div>
        {/* Activity items */}
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="w-full lg:w-72 border-l border-border p-4 space-y-4">
        <Skeleton className="h-5 w-36" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border p-3 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  </div>
);
