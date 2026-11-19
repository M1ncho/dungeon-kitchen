import { cn } from "@/lib/utils";

export type Attributes = { heat: number; umami: number; sweet: number; mana: number; toxin: number };

const ATTRS: { key: keyof Attributes; label: string; color: string }[] = [
  { key: "heat", label: "열기", color: "text-red-400" },
  { key: "umami", label: "감칠맛", color: "text-amber-400" },
  { key: "sweet", label: "단맛", color: "text-pink-400" },
  { key: "mana", label: "마력", color: "text-violet-400" },
  { key: "toxin", label: "독성", color: "text-lime-400" },
];

/** 속성 수치를 속성 색상으로 보여준다 (0 인 속성은 생략). */
export function AttributeChips({ attrs, className }: { attrs: Attributes; className?: string }) {
  const shown = ATTRS.filter((a) => attrs[a.key] > 0);
  if (shown.length === 0) return <span className="text-xs text-muted-foreground">속성 없음</span>;
  return (
    <span className={cn("flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-xs", className)}>
      {shown.map((a) => (
        <span key={a.key} className={a.color}>
          {a.label} {attrs[a.key]}
        </span>
      ))}
    </span>
  );
}
