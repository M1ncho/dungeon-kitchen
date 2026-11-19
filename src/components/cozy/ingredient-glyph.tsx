import type { ReactNode } from "react";
import { Svg } from "./icons";

// 재료 글리프: ingredients.icon(DB 에 저장된 아이콘 이름)을 정면 SVG 그림으로 바꾼다.
// 이미지 에셋 없이 도형만 쓰며, 모르는 이름은 상자 그림으로 대체한다.

const GLYPHS: Record<string, () => ReactNode> = {
  droplet: () => (
    <>
      <path d="M24 6C24 6 9 22 9 31a15 15 0 0 0 30 0C39 22 24 6 24 6Z" className="fill-dk-moss" />
      <path d="M16 30a8 8 0 0 0 5 7" className="fill-none stroke-white/70 [stroke-width:2.5]" />
    </>
  ),
  droplets: () => (
    <>
      <path d="M24 6C24 6 10 22 10 31a14 14 0 0 0 28 0C38 22 24 6 24 6Z" className="fill-dk-lantern" />
      <path d="M17 30a7 7 0 0 0 5 6" className="fill-none stroke-white/70 [stroke-width:2.5]" />
    </>
  ),
  sprout: () => (
    <>
      <path d="M18 27H30V40a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3Z" className="fill-dk-paper" />
      <path d="M5 27Q5 8 24 8Q43 8 43 27Z" className="fill-dk-red" />
      <circle cx="17" cy="19" r="3" className="fill-dk-paper stroke-none" />
      <circle cx="30" cy="16" r="2.4" className="fill-dk-paper stroke-none" />
      <circle cx="35" cy="23" r="2" className="fill-dk-paper stroke-none" />
    </>
  ),
  drumstick: () => (
    <>
      <path d="M27 27L38 38" className="fill-none [stroke-width:12]" />
      <path d="M27 27L38 38" className="fill-none stroke-dk-paper [stroke-width:6]" />
      <circle cx="40" cy="38" r="4" className="fill-dk-paper" />
      <circle cx="38" cy="41" r="4" className="fill-dk-paper" />
      <ellipse cx="19" cy="19" rx="14" ry="12.5" className="fill-[#c4642f]" transform="rotate(-20 19 19)" />
      <path d="M11 17Q15 11 22 12" className="fill-none stroke-[#e6905a] [stroke-width:2.5]" />
    </>
  ),
  leaf: () => (
    <>
      <path d="M7 41C7 18 20 7 41 7C41 29 30 41 7 41Z" className="fill-dk-moss" />
      <path d="M12 36L33 15" className="fill-none [stroke-width:2.5]" />
    </>
  ),
  feather: () => (
    <>
      <path d="M9 41C7 20 22 7 41 6C41 25 30 37 9 41Z" className="fill-[#b9dbe3]" />
      <path d="M9 41L34 12" className="fill-none [stroke-width:2.5]" />
      <path d="M20 27L30 28M24 21L33 21" className="fill-none [stroke-width:2]" />
    </>
  ),
  flame: () => (
    <>
      <path d="M24 4C29 13 38 19 38 31a14 14 0 0 1-28 0C10 23 15 20 17 13C19 17 21 16 24 4Z" className="fill-dk-red" />
      <path d="M24 22C27 27 31 29 31 34a7 7 0 0 1-14 0C17 30 21 28 24 22Z" className="fill-dk-lantern" />
    </>
  ),
  "flame-kindling": () => (
    <>
      <path d="M24 4C29 13 38 19 38 31a14 14 0 0 1-28 0C10 23 15 20 17 13C19 17 21 16 24 4Z" className="fill-dk-lantern" />
      <path d="M24 20C27 25 31 27 31 33a7 7 0 0 1-14 0C17 29 21 26 24 20Z" className="fill-dk-red" />
      <circle cx="24" cy="35" r="3" className="fill-dk-paper stroke-none" />
    </>
  ),
  shell: () => (
    <>
      <path d="M24 41L5 22Q5 7 24 7Q43 7 43 22Z" className="fill-[#f2a6a0]" />
      <path d="M24 41L12 14M24 41V8M24 41L36 14" className="fill-none [stroke-width:2]" />
    </>
  ),
  zap: () => <path d="M28 3L9 27H22L19 45L39 20H26Z" className="fill-dk-lantern" />,
  gem: () => (
    <>
      <path d="M13 8H35L45 20L24 43L3 20Z" className="fill-dk-crystal" />
      <path d="M3 20H45M13 8L18 20L24 43M35 8L30 20L24 43" className="fill-none [stroke-width:2]" />
    </>
  ),
  cherry: () => (
    <>
      <path d="M15 27Q17 12 29 7M33 27Q31 13 29 7" className="fill-none" />
      <ellipse cx="32" cy="10" rx="7" ry="3.5" className="fill-dk-moss" transform="rotate(-20 32 10)" />
      <circle cx="15" cy="34" r="9" className="fill-dk-red" />
      <circle cx="33" cy="34" r="9" className="fill-dk-red" />
    </>
  ),
  fish: () => (
    <>
      <path d="M35 24L45 13V35Z" className="fill-dk-crystal" />
      <ellipse cx="21" cy="24" rx="17" ry="12" className="fill-dk-crystal" />
      <circle cx="13" cy="21" r="2.5" className="fill-dk-paper" />
      <path d="M22 16Q27 24 22 32" className="fill-none [stroke-width:2]" />
    </>
  ),
  "flower-2": () => (
    <>
      {[0, 72, 144, 216, 288].map((deg) => (
        <circle key={deg} cx="24" cy="12.5" r="8" className="fill-[#f08fb0]" transform={`rotate(${deg} 24 24)`} />
      ))}
      <circle cx="24" cy="24" r="6.5" className="fill-dk-lantern" />
    </>
  ),
  sparkles: () => (
    <>
      <path d="M22 4Q24 21 41 23Q24 25 22 42Q20 25 3 23Q20 21 22 4Z" className="fill-dk-lantern" />
      <path d="M38 5Q38.6 10 43 10.6Q38.6 11.2 38 16Q37.4 11.2 33 10.6Q37.4 10 38 5Z" className="fill-dk-paper [stroke-width:2]" />
    </>
  ),
  egg: () => (
    <>
      <path d="M24 4C34 4 41 19 41 29a17 14 0 0 1-34 0C7 19 14 4 24 4Z" className="fill-dk-paper-badge" />
      <circle cx="19" cy="25" r="3" className="fill-dk-red stroke-none" />
      <circle cx="29" cy="31" r="3.4" className="fill-dk-red stroke-none" />
      <circle cx="27" cy="17" r="2.2" className="fill-dk-red stroke-none" />
    </>
  ),
  "glass-water": () => (
    <>
      <path d="M11 7H37L34 43H14Z" className="fill-[#d6eef2]" />
      <path d="M12.6 22H35.4L34 43H14Z" className="fill-dk-crystal" />
    </>
  ),
  snowflake: () => (
    <>
      <path d="M16 17H32Q38 27 36 40Q36 43 33 43H15Q12 43 12 40Q10 27 16 17Z" className="fill-dk-paper" />
      <rect x="15" y="6" width="18" height="11" rx="3" className="fill-dk-iron" />
      <circle cx="21" cy="11.5" r="1.3" className="fill-dk-paper stroke-none" />
      <circle cx="27" cy="11.5" r="1.3" className="fill-dk-paper stroke-none" />
    </>
  ),
  wheat: () => (
    <>
      <path d="M24 44V14" className="fill-none" />
      {[
        [16, 17, -35],
        [16, 26, -35],
        [16, 35, -35],
        [32, 17, 35],
        [32, 26, 35],
        [32, 35, 35],
      ].map(([x, y, r]) => (
        <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="3.6" ry="6.5" transform={`rotate(${r} ${x} ${y})`} className="fill-dk-lantern" />
      ))}
      <ellipse cx="24" cy="9" rx="3.6" ry="6.5" className="fill-dk-lantern" />
    </>
  ),
  package: () => (
    <>
      <rect x="6" y="13" width="36" height="29" rx="3" className="fill-dk-wood-light" />
      <path d="M6 22H42" />
      <rect x="20" y="13" width="8" height="29" className="fill-dk-paper" />
    </>
  ),
};

export function IngredientGlyph({ name, className }: { name: string; className?: string }) {
  const draw = GLYPHS[name] ?? GLYPHS.package;
  return <Svg className={className}>{draw()}</Svg>;
}
