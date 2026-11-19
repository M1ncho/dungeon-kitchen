import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

// 코지 카툰 패널 공통 컴포넌트.
// 규칙: 모든 패널·버튼·뱃지에 굵은 갈색 외곽선(3px) + 흐림 없는 아래쪽 그림자. 색은 globals.css 의 --dk-* 토큰만 쓴다.

const OUTLINE = "border-[3px] border-dk-outline";

function Rivet({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("absolute size-3 rounded-full border-2 border-dk-outline bg-dk-wood-light", className)} />;
}

/** 나무 판자 패널: 모서리 리벳 4개 + 위쪽에 걸친 빨간 명패(제목). */
export function WoodPanel({
  title,
  children,
  className,
  ...rest
}: { title?: ReactNode; children: ReactNode; className?: string } & Omit<ComponentPropsWithoutRef<"section">, "title">) {
  return (
    <section
      {...rest}
      className={cn(`relative rounded-[26px] ${OUTLINE} bg-dk-wood px-4 pb-6 pt-10 shadow-[0_6px_0_var(--dk-shadow)] sm:px-5`, className)}
    >
      <Rivet className="left-3 top-3" />
      <Rivet className="right-3 top-3" />
      <Rivet className="bottom-3 left-3" />
      <Rivet className="bottom-3 right-3" />
      {title && (
        <h2
          className={`absolute -top-[18px] left-1/2 max-w-[78%] -translate-x-1/2 truncate rounded-lg ${OUTLINE} bg-dk-red px-5 py-0.5 font-display text-lg text-dk-paper shadow-[0_4px_0_var(--dk-shadow)] [text-shadow:0_2px_0_var(--dk-outline)]`}
        >
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** 종이 카드 (안내판, 타일 바탕). */
export function PaperCard({
  children,
  className,
  tone = "paper",
  ...rest
}: { children: ReactNode; className?: string; tone?: "paper" | "area" } & ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...rest}
      className={cn(
        `rounded-2xl ${OUTLINE} text-dk-outline shadow-[0_4px_0_var(--dk-shadow)]`,
        tone === "paper" ? "bg-dk-paper" : "bg-dk-paper-area",
        className,
      )}
    >
      {children}
    </div>
  );
}

const BADGE_TONES = {
  paper: "bg-dk-paper-badge text-dk-outline",
  lantern: "bg-dk-lantern text-dk-outline",
  moss: "bg-dk-moss text-dk-outline",
  red: "bg-dk-red text-dk-paper",
  crystal: "bg-dk-crystal text-dk-outline",
  gray: "bg-[#d8c7a0] text-dk-text-sub",
} as const;

/** 알약형 뱃지. */
export function CozyBadge({
  children,
  tone = "paper",
  className,
  ...rest
}: { children: ReactNode; tone?: keyof typeof BADGE_TONES; className?: string } & ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...rest}
      className={cn(
        `inline-flex items-center gap-1.5 rounded-full ${OUTLINE} px-3 py-0.5 font-display text-sm leading-6 shadow-[0_3px_0_var(--dk-shadow)]`,
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 빨간 시설 코드 도장 (MKT, KIT ...). */
export function Stamp({ children, className, ...rest }: { children: ReactNode; className?: string } & ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...rest}
      className={cn(
        `inline-block -rotate-3 rounded-md ${OUTLINE} bg-dk-red px-2 py-px font-display text-xs tracking-wider text-dk-paper shadow-[0_3px_0_var(--dk-shadow)]`,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 상태 램프: 켜짐(초록) / 꺼짐(회색) + 문구. */
export function StatusLamp({
  on,
  tone = "ok",
  children,
  className,
  ...rest
}: { on: boolean; tone?: "ok" | "warn"; children: ReactNode; className?: string } & ComponentPropsWithoutRef<"div">) {
  return (
    <div {...rest} className={cn("flex items-center gap-2.5 font-display text-base text-dk-outline", className)}>
      <span
        aria-hidden="true"
        className={cn(
          `relative size-5 shrink-0 rounded-full ${OUTLINE} shadow-[0_2px_0_var(--dk-shadow)]`,
          on && tone === "ok" && "bg-dk-moss shadow-[0_2px_0_var(--dk-shadow),0_0_10px_2px_rgba(124,179,66,0.65)]",
          on && tone === "warn" && "bg-dk-lantern shadow-[0_2px_0_var(--dk-shadow),0_0_10px_2px_rgba(255,181,46,0.65)]",
          !on && "bg-[#a89d90]",
        )}
      >
        <span className="absolute left-[3px] top-[2px] size-1.5 rounded-full bg-white/70" />
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

type ChunkyProps = {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "wood" | "paper";
  size?: "md" | "sm" | "icon";
  disabled?: boolean;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"button">, "children" | "className" | "disabled">;

/**
 * 두툼한 버튼. 누르면 그림자만큼 아래로 눌린다 (active: translateY + 그림자 제거).
 * href 가 있으면 링크로, disabled 이면 눌리지 않는 비활성 버튼으로 그린다.
 */
export function ChunkyButton({ children, href, variant = "primary", size = "md", disabled, className, ...rest }: ChunkyProps) {
  const classes = cn(
    `inline-flex select-none items-center justify-center gap-2 rounded-xl ${OUTLINE} font-display transition-[transform,box-shadow] duration-75`,
    "shadow-[0_5px_0_var(--dk-shadow)] active:translate-y-[5px] active:shadow-[0_0_0_var(--dk-shadow)]",
    variant === "primary" && "bg-dk-lantern text-dk-outline hover:brightness-105",
    variant === "wood" && "bg-dk-wood-light text-dk-outline hover:brightness-105",
    variant === "paper" && "bg-dk-paper text-dk-outline hover:brightness-105",
    size === "md" && "h-12 px-6 text-lg",
    size === "sm" && "h-10 px-4 text-base",
    size === "icon" && "size-11",
    disabled &&
      "cursor-not-allowed bg-[#d8c7a0] text-dk-text-sub shadow-[0_3px_0_var(--dk-shadow)] hover:brightness-100 active:translate-y-0 active:shadow-[0_3px_0_var(--dk-shadow)]",
    className,
  );

  if (href && !disabled) {
    // 링크로 그릴 때도 접근성·식별용 속성은 그대로 넘긴다.
    const passthrough = rest as Record<string, unknown>;
    return (
      <Link
        href={href}
        className={classes}
        aria-label={passthrough["aria-label"] as string | undefined}
        title={passthrough.title as string | undefined}
        data-testid={passthrough["data-testid"] as string | undefined}
      >
        {children}
      </Link>
    );
  }
  return (
    <button type="button" {...rest} disabled={disabled} className={classes}>
      {children}
    </button>
  );
}
