import { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLabels } from "@/contexts/LabelsContext";
import { cn } from "@/lib/utils";
import { hexToRgba } from "@/utils/colorUtils";

interface WorkspaceSectionProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export const WorkspaceSection = ({
  title,
  description,
  icon,
  children,
  className,
  contentClassName,
}: WorkspaceSectionProps) => {
  const { labels } = useLabels();
  const sectionBackground = labels.color_workspace_section_bg || "#fcfdff";
  const sectionBorder = labels.color_workspace_section_border || "#dbe5ef";

  return (
    <Card
      className={cn("overflow-hidden rounded-[2rem] shadow-[0_28px_70px_-42px_hsl(var(--foreground)/0.16)]", className)}
      style={{
        backgroundColor: hexToRgba(sectionBackground, 0.95),
        border: `1px solid ${hexToRgba(sectionBorder, 0.92)}`,
      }}
    >
      <CardHeader
        className="space-y-3 pb-5"
        style={{
          borderBottom: `1px solid ${hexToRgba(sectionBorder, 0.52)}`,
          backgroundColor: hexToRgba(sectionBorder, 0.08),
        }}
      >
        <div className="flex items-center gap-3">
          {icon ? (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl text-primary"
              style={{
                backgroundColor: hexToRgba(sectionBackground, 0.94),
                border: `1px solid ${hexToRgba(sectionBorder, 0.72)}`,
              }}
            >
              {icon}
            </div>
          ) : null}
          <div className="space-y-1">
            <CardTitle className="text-2xl tracking-[-0.04em]">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn("p-6", contentClassName)}>{children}</CardContent>
    </Card>
  );
};