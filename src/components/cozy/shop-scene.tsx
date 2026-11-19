import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// 포장마차 정면 장면 (정면 시점, 400x300).
// 지금은 SVG 도형으로 그리지만, 요소를 레이어 단위(<g data-layer="...">)로 나눠 두었다.
// 나중에 직접 그린 이미지로 바꿀 때는 `overrides` 로 레이어 하나만 <image href=... /> 등으로 교체하면 된다.

export const SHOP_SCENE_LAYERS = [
  "wall", // 돌벽 배경 + 바닥
  "moss", // 이끼
  "torches", // 횃불 2개
  "interior", // 천막 안쪽(선반, 메뉴판)
  "posts", // 기둥
  "counter", // 카운터
  "pot", // 솥과 김, 그릇
  "awning", // 줄무늬 천막 (물결 모양 아래 끝)
  "lanterns", // 랜턴 (영업 중이면 불빛 강조)
  "sign", // 간판 (가게 이름)
  "barrel", // 나무통
  "peddler", // 행상 수레와 행상, 말풍선 (방문 중일 때만)
] as const;

export type ShopSceneLayer = (typeof SHOP_SCENE_LAYERS)[number];

export type ShopSceneProps = {
  shopName: string;
  /** 행상 방문 중: 수레·행상·말풍선을 켠다 */
  peddlerVisiting: boolean;
  /** 영업 중: 랜턴 불빛을 강조한다 */
  open: boolean;
  /** 층 시험 손님이 기다리는 중: 가게 창에 눈에 띄는 느낌표 말풍선을 띄운다 */
  examWaiting?: boolean;
  /** 레이어별 교체용. 지정한 레이어는 기본 도형 대신 이 노드를 그린다. */
  overrides?: Partial<Record<ShopSceneLayer, ReactNode>>;
  className?: string;
};

type LayerProps = Pick<ShopSceneProps, "shopName" | "peddlerVisiting" | "open">;

function Wall() {
  return (
    <g data-layer="wall">
      <rect width="400" height="300" className="fill-dk-stone stroke-none" />
      <rect width="400" height="300" fill="url(#dk-scene-brick)" className="stroke-none" />
      <rect y="252" width="400" height="48" className="fill-[#4b3a30] stroke-none" />
      <path d="M0 252H400" />
      <path d="M0 276H400M50 252V276M150 252V276M250 252V276M350 252V276M100 276V300M200 276V300M300 276V300" className="stroke-[#33271f] [stroke-width:2]" />
    </g>
  );
}

function Moss() {
  return (
    <g data-layer="moss" className="fill-dk-moss [stroke-width:2.5]">
      <path d="M0 0H74Q70 20 58 18Q54 34 42 28Q32 42 20 30Q10 36 0 24Z" />
      <path d="M400 0H326Q330 18 342 16Q348 30 360 26Q372 38 384 26Q394 30 400 20Z" />
      <path d="M0 252Q8 238 18 246Q26 232 38 244Q46 236 54 252Z" />
      <path d="M346 252Q354 238 364 246Q374 234 386 246Q392 240 400 248V252Z" />
    </g>
  );
}

function Torch({ x, delay }: { x: number; delay: string }) {
  const base = 100; // 불꽃 받침 위쪽 y
  return (
    <g>
      <circle cx={x} cy={base - 20} r="38" fill="url(#dk-scene-glow)" className="stroke-none" />
      <rect x={x - 5} y={base + 12} width="10" height="24" rx="3" className="fill-dk-wood" />
      <path d={`M${x - 12} ${base - 2}H${x + 12}L${x + 8} ${base + 14}H${x - 8}Z`} className="fill-dk-iron" />
      <g className="dk-flame" style={{ animationDelay: delay }}>
        <path
          d={`M${x} ${base - 42}C${x + 5} ${base - 32} ${x + 12} ${base - 26} ${x + 12} ${base - 15}a12 12 0 0 1-24 0C${x - 12} ${base - 23} ${x - 7} ${base - 26} ${x - 5} ${base - 32}C${x - 3} ${base - 28} ${x - 2} ${base - 29} ${x} ${base - 42}Z`}
          className="fill-dk-red"
        />
        <path
          d={`M${x} ${base - 24}C${x + 3} ${base - 19} ${x + 6} ${base - 17} ${x + 6} ${base - 12}a6 6 0 0 1-12 0C${x - 6} ${base - 16} ${x - 3} ${base - 18} ${x} ${base - 24}Z`}
          className="fill-dk-lantern [stroke-width:2]"
        />
      </g>
    </g>
  );
}

function Torches() {
  return (
    <g data-layer="torches">
      <Torch x={44} delay="0s" />
      <Torch x={356} delay="0.45s" />
    </g>
  );
}

function Interior() {
  return (
    <g data-layer="interior">
      <rect x="126" y="92" width="148" height="104" className="fill-[#2b1a12]" />
      <rect x="126" y="144" width="148" height="8" className="fill-dk-wood" />
      <rect x="138" y="124" width="16" height="20" rx="3" className="fill-dk-crystal [stroke-width:2.5]" />
      <rect x="160" y="129" width="14" height="15" rx="3" className="fill-dk-moss [stroke-width:2.5]" />
      <rect x="180" y="126" width="15" height="18" rx="3" className="fill-dk-red [stroke-width:2.5]" />
      <rect x="238" y="100" width="26" height="30" rx="2" className="fill-dk-paper [stroke-width:2.5]" />
      <path d="M243 109H259M243 115H259M243 121H253" className="[stroke-width:2]" />
    </g>
  );
}

function Posts() {
  return (
    <g data-layer="posts">
      <rect x="112" y="64" width="14" height="190" className="fill-dk-wood" />
      <rect x="274" y="64" width="14" height="190" className="fill-dk-wood" />
      <rect x="106" y="244" width="26" height="12" rx="2" className="fill-dk-wood-light" />
      <rect x="268" y="244" width="26" height="12" rx="2" className="fill-dk-wood-light" />
    </g>
  );
}

function Counter() {
  return (
    <g data-layer="counter">
      <rect x="100" y="198" width="200" height="54" className="fill-dk-plank" />
      <path d="M140 198V252M180 198V252M220 198V252M260 198V252" className="stroke-[#7a4720] [stroke-width:2]" />
      <rect x="92" y="184" width="216" height="18" rx="5" className="fill-dk-wood-light" />
    </g>
  );
}

function Pot() {
  return (
    <g data-layer="pot">
      <g className="fill-none stroke-dk-paper-area [stroke-width:4.5]">
        <path className="dk-steam" d="M166 160c-5-6 5-10 0-18" />
        <path className="dk-steam" style={{ animationDelay: "1s" }} d="M178 160c-5-6 5-10 0-18" />
        <path className="dk-steam" style={{ animationDelay: "2s" }} d="M190 160c-5-6 5-10 0-18" />
      </g>
      <rect x="143" y="162" width="68" height="9" rx="3" className="fill-dk-iron" />
      <path d="M149 171H205V180Q205 188 197 188H157Q149 188 149 180Z" className="fill-dk-iron" />
      <path d="M156 176V182" className="stroke-[#a59fae] [stroke-width:3]" />
      <path d="M232 186Q232 170 248 170Q264 170 264 186Z" className="fill-dk-paper" />
      <path d="M244 186Q244 176 255 176Q266 176 266 186Z" className="fill-dk-paper-badge" transform="translate(8 0)" />
    </g>
  );
}

const SCALLOP =
  "M104 62H296L304 104a13 13 0 0 1-26 0a13 13 0 0 1-26 0a13 13 0 0 1-26 0a13 13 0 0 1-26 0a13 13 0 0 1-26 0a13 13 0 0 1-26 0a13 13 0 0 1-26 0a13 13 0 0 1-26 0Z";

function Awning() {
  return (
    <g data-layer="awning">
      <rect x="100" y="54" width="200" height="12" rx="4" className="fill-dk-wood" />
      <path d={SCALLOP} className="fill-dk-red" />
      <g clipPath="url(#dk-scene-awning-clip)" className="stroke-none">
        {[122, 174, 226, 278].map((x) => (
          <rect key={x} x={x - 26} y="60" width="26" height="70" className="fill-dk-paper" />
        ))}
      </g>
      <path d={SCALLOP} className="fill-none" />
    </g>
  );
}

function Lantern({ x, open }: { x: number; open: boolean }) {
  return (
    <g>
      {open && <circle cx={x} cy="142" r="52" fill="url(#dk-scene-glow-strong)" className="stroke-none" />}
      <path d={`M${x} 117V126`} />
      <rect x={x - 9} y="126" width="18" height="26" rx="5" className={open ? "fill-dk-lantern" : "fill-[#8a6a48]"} />
      {open && <rect x={x - 3.5} y="132" width="7" height="14" rx="3" className="fill-dk-paper stroke-none" />}
      <path d={`M${x - 6} 126H${x + 6}M${x - 6} 152H${x + 6}`} className="[stroke-width:4]" />
    </g>
  );
}

function Lanterns({ open }: Pick<LayerProps, "open">) {
  return (
    <g data-layer="lanterns">
      {open && <ellipse cx="200" cy="186" rx="122" ry="44" fill="url(#dk-scene-glow)" className="stroke-none" />}
      <Lantern x={140} open={open} />
      <Lantern x={260} open={open} />
    </g>
  );
}

// 한글·한자는 1em, 그 밖의 글자는 0.58em 으로 보고 간판 폭(104)에 맞게 글자 크기를 줄인다.
function signFontSize(name: string) {
  const em = [...name].reduce((n, ch) => n + (/[ᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(ch) ? 1 : 0.58), 0);
  return Math.max(9, Math.min(21, 104 / Math.max(em, 1)));
}

function Sign({ shopName }: Pick<LayerProps, "shopName">) {
  return (
    <g data-layer="sign">
      <path d="M158 56V64M242 56V64" className="[stroke-width:4]" />
      <rect x="138" y="12" width="124" height="44" rx="10" className="fill-dk-wood-light" />
      <rect x="145" y="19" width="110" height="30" rx="6" className="fill-dk-paper-badge [stroke-width:2]" />
      <text
        x="200"
        y="34"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={signFontSize(shopName)}
        className="fill-dk-outline font-display stroke-none"
      >
        {shopName}
      </text>
    </g>
  );
}

function Barrel() {
  return (
    <g data-layer="barrel">
      <path d="M20 206Q12 232 20 256H70Q78 232 70 206Z" className="fill-dk-plank" />
      <path d="M16 220Q45 226 74 220M15 242Q45 248 75 242" className="fill-none stroke-dk-iron [stroke-width:4]" />
      <path d="M32 208V254M45 209V255M58 208V254" className="stroke-[#7a4720] [stroke-width:2]" />
      <ellipse cx="45" cy="206" rx="25" ry="7" className="fill-dk-wood-light" />
    </g>
  );
}

function Peddler() {
  return (
    <g data-layer="peddler">
      <ellipse cx="346" cy="258" rx="48" ry="5" className="fill-black/30 stroke-none" />
      {/* 수레 */}
      <path d="M334 206Q330 188 344 184Q358 182 356 206Z" className="fill-dk-paper-area" />
      <path d="M338 192H352" className="[stroke-width:2]" />
      <circle cx="371" cy="196" r="10" className="fill-dk-moss" />
      <path d="M365 196Q371 190 377 196" className="fill-none [stroke-width:2]" />
      <circle cx="385" cy="200" r="6.5" className="fill-dk-red" />
      <rect x="328" y="210" width="62" height="28" rx="3" className="fill-dk-plank-dark" />
      <path d="M328 224H390" className="stroke-[#7a4720] [stroke-width:2]" />
      <rect x="324" y="205" width="70" height="9" rx="3" className="fill-dk-wood-light" />
      <circle cx="359" cy="246" r="15" className="fill-dk-wood-light" />
      <path d="M359 231V261M344 246H374M348.5 235.5L369.5 256.5M369.5 235.5L348.5 256.5" className="[stroke-width:2]" />
      <circle cx="359" cy="246" r="4" className="fill-dk-iron" />
      {/* 행상 */}
      <circle cx="296" cy="216" r="12" className="fill-dk-paper-area" />
      <path d="M290 207Q300 216 308 214" className="fill-none [stroke-width:2]" />
      <rect x="305" y="239" width="7" height="14" rx="2" className="fill-dk-iron" />
      <rect x="317" y="239" width="7" height="14" rx="2" className="fill-dk-iron" />
      <ellipse cx="307" cy="254" rx="6" ry="3.2" className="fill-dk-wood" />
      <ellipse cx="322" cy="254" rx="6" ry="3.2" className="fill-dk-wood" />
      <rect x="299" y="205" width="32" height="36" rx="6" className="fill-dk-crystal" />
      <path d="M299 224H331" className="[stroke-width:2]" />
      <rect x="319" y="212" width="6" height="8" rx="1.5" className="fill-dk-lantern stroke-none" />
      <rect x="293" y="208" width="9" height="24" rx="4.5" className="fill-dk-crystal" />
      <rect x="328" y="208" width="9" height="24" rx="4.5" className="fill-dk-crystal" />
      <circle cx="315" cy="192" r="11" className="fill-[#f2c79a]" />
      <path d="M303 188Q303 171 315 171Q327 171 327 188Z" className="fill-dk-red" />
      <ellipse cx="315" cy="188" rx="18" ry="4.2" className="fill-dk-red" />
      <circle cx="311" cy="194" r="1.4" className="fill-dk-outline stroke-none" />
      <circle cx="319" cy="194" r="1.4" className="fill-dk-outline stroke-none" />
      <path d="M311 198Q315 201 319 198" className="fill-none [stroke-width:2]" />
      {/* 말풍선 */}
      <rect x="296" y="134" width="98" height="28" rx="12" className="fill-dk-paper" />
      <path d="M310 161L316 171L324 161Z" className="fill-dk-paper" />
      <path d="M310.5 160.5H323.5" className="stroke-dk-paper [stroke-width:4]" />
      <text x="345" y="148.5" textAnchor="middle" dominantBaseline="central" fontSize="13" className="fill-dk-outline font-display stroke-none">
        재료 있어요!
      </text>
    </g>
  );
}

function sceneDescription({ shopName, peddlerVisiting, open }: LayerProps) {
  return `${shopName} 앞 풍경. ${peddlerVisiting ? "행상이 수레를 끌고 방문 중이에요." : "지금은 행상이 없어요."} ${open ? "영업 중이라 랜턴이 환하게 켜져 있어요." : "영업 전이라 랜턴이 어두워요."}`;
}

export function ShopScene({ shopName, peddlerVisiting, open, examWaiting = false, overrides = {}, className }: ShopSceneProps) {
  const layer = (name: ShopSceneLayer, node: ReactNode) => overrides[name] ?? node;

  return (
    <svg
      viewBox="0 0 400 300"
      role="img"
      aria-label={`${sceneDescription({ shopName, peddlerVisiting, open })}${examWaiting ? " 승급 시험 손님이 가게 앞에서 기다리고 있어요." : ""}`}
      className={cn("block h-full w-full stroke-dk-outline [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3]", className)}
    >
      <defs>
        <pattern id="dk-scene-brick" width="40" height="24" patternUnits="userSpaceOnUse">
          <rect x="3" y="3" width="14" height="6" className="fill-white/5 stroke-none" />
          <rect x="24" y="15" width="12" height="6" className="fill-black/10 stroke-none" />
          <path d="M0 0H40M0 12H40M20 0V12M0 12V24M40 12V24" className="stroke-dk-stone-dark [stroke-width:2]" />
        </pattern>
        <radialGradient id="dk-scene-glow">
          <stop offset="0" stopColor="#ffb52e" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="dk-scene-glow-strong">
          <stop offset="0" stopColor="#ffd877" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ffb52e" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffb52e" stopOpacity="0" />
        </radialGradient>
        <clipPath id="dk-scene-awning-clip">
          <path d={SCALLOP} />
        </clipPath>
      </defs>

      {layer("wall", <Wall />)}
      {layer("moss", <Moss />)}
      {layer("torches", <Torches />)}
      {layer("interior", <Interior />)}
      {layer("posts", <Posts />)}
      {layer("counter", <Counter />)}
      {layer("pot", <Pot />)}
      {layer("awning", <Awning />)}
      {layer("lanterns", <Lanterns open={open} />)}
      {layer("sign", <Sign shopName={shopName} />)}
      {layer("barrel", <Barrel />)}
      {peddlerVisiting && layer("peddler", <Peddler />)}
      {examWaiting && (
        <g data-layer="exam-alert" data-testid="scene-exam-alert">
          <path d="M300 26H378a10 10 0 0 1 10 10V66a10 10 0 0 1-10 10H345L330 92L325 76H300a10 10 0 0 1-10-10V36a10 10 0 0 1 10-10Z" className="fill-dk-red" />
          <text x="339" y="63" textAnchor="middle" fontSize="34" className="fill-dk-paper stroke-none font-display">!</text>
        </g>
      )}
    </svg>
  );
}
