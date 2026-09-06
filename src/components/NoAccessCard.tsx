import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";

export const NoAccessCard = ({
  message = "Only workspace admins can open this section.",
}: {
  message?: string;
}) => (
  <Card className="border-border">
    <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="rounded-full bg-muted p-3">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">Restricted section</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </CardContent>
  </Card>
);
