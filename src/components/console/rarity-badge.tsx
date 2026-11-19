import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const RARITY = {
  common: { label: "일반", className: "" },
  rare: { label: "희귀", className: "border-sky-400/50 text-sky-400" },
  legendary: { label: "전설", className: "border-amber-400/60 text-amber-400" },
} as const;

export function RarityBadge({ rarity }: { rarity: string }) {
  const r = RARITY[rarity as keyof typeof RARITY] ?? RARITY.common;
  return (
    <Badge variant="outline" className={cn("text-[10px]", r.className)}>
      {r.label}
    </Badge>
  );
}
