import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FacilityIcon } from "@/components/cozy/icons";
import type { Facility } from "./nav";

export function ComingSoon({ facility }: { facility: Facility }) {
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <FacilityIcon name={facility.iconKey} className="size-7" /> {facility.code}
        </div>
        <CardTitle>{facility.label}</CardTitle>
        <CardDescription>{facility.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant="outline">준비 중이에요</Badge>
      </CardContent>
    </Card>
  );
}
