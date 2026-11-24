import type { CookingZone, Point } from "@/lib/game/cooking";

// 맛 지도 (SVG). 좌표계는 게임과 같다: 가로 단맛(−)↔열기(+), 세로 마력(−)↔감칠맛(+). 화면에서는 y 를 뒤집어 그린다.

export type MapZone = CookingZone & { discovered: boolean; /** 아직 해금하지 않은 층의 구역: 윤곽만 그린다 */ locked?: boolean; unlockFloor?: number };

const ZONE_COLORS: Record<string, string> = {
  soup: "#ffb52e",
  skewer: "#e0553f",
  fritter: "#f08a3c",
  pickles: "#4fb3bf",
  rice_cake: "#f3a6b8",
  elixir: "#a58ae0",
  frost_flame_stirfry: "#e86f9f",
};

const sx = (p: Point) => p.x;
const sy = (p: Point) => -p.y;

export function TasteMap({
  limit,
  zones,
  path,
  position,
  preview,
  previewPath,
  activeZoneCode,
  reveal,
}: {
  limit: number;
  zones: MapZone[];
  path: Point[];
  position: Point;
  /** 재료에 마우스를 올렸을 때의 이동 미리보기 (현재 위치 → 도착 위치) */
  preview: Point | null;
  /** 미리보기 경로 (회전은 호, 끌어당김·확대는 직선 점선 화살표). 없으면 현재 위치 → preview 직선 */
  previewPath?: Point[] | null;
  activeZoneCode: string | null;
  /** 주문 손님 응대 후에만 공개되는 목표 위치와 판정 범위 원 (응대 전에는 절대 넘기지 않는다) */
  reveal?: { target: Point; rings: { label: string; r: number }[] } | null;
}) {
  const pad = 22;
  const size = limit * 2 + pad * 2;
  const grid = [-limit, -limit / 2, 0, limit / 2, limit];

  return (
    <svg
      viewBox={`${-limit - pad} ${-limit - pad} ${size} ${size}`}
      role="img"
      aria-label="맛 지도"
      data-testid="taste-map"
      data-x={position.x}
      data-y={position.y}
      className="block h-auto w-full"
    >
      <rect x={-limit} y={-limit} width={limit * 2} height={limit * 2} rx="6" className="fill-dk-paper-area stroke-dk-outline" strokeWidth="2.5" />
      {grid.map((g) => (
        <g key={g} className="stroke-dk-outline/20" strokeWidth="0.6">
          <line x1={g} y1={-limit} x2={g} y2={limit} />
          <line x1={-limit} y1={g} x2={limit} y2={g} />
        </g>
      ))}
      <g className="stroke-dk-outline/55" strokeWidth="1.2">
        <line x1={-limit} y1="0" x2={limit} y2="0" />
        <line x1="0" y1={-limit} x2="0" y2={limit} />
      </g>

      {/* 축 이름 */}
      <g className="fill-dk-outline font-display" fontSize="9" textAnchor="middle">
        <text x={limit + pad / 2 + 1} y="3">열기</text>
        <text x={-limit - pad / 2 - 1} y="3">단맛</text>
        <text x="0" y={-limit - 8}>감칠맛</text>
        <text x="0" y={limit + 15}>마력</text>
      </g>

      {/* 요리 구역 */}
      {zones.map((z) => {
        const hidden = z.signature && !z.discovered && !z.locked;
        if (z.locked) {
          return (
            <g key={z.code} data-testid="map-zone" data-zone={z.code} data-locked="true">
              <circle cx={z.centerX} cy={-z.centerY} r={z.radius} fill="#6e5f55" fillOpacity={0.1} stroke="#6e5f55" strokeWidth="1.6" strokeDasharray="2 3" />
              <text x={z.centerX} y={-z.centerY - 1} textAnchor="middle" fontSize="7.5" className="fill-dk-stone font-display" style={{ paintOrder: "stroke", stroke: "#f3e3bd", strokeWidth: 2, strokeLinejoin: "round" }}>
                잠긴 구역
              </text>
              <text x={z.centerX} y={-z.centerY + 8} textAnchor="middle" fontSize="7.5" className="fill-dk-stone font-display" style={{ paintOrder: "stroke", stroke: "#f3e3bd", strokeWidth: 2, strokeLinejoin: "round" }}>
                ({z.unlockFloor}층)
              </text>
            </g>
          );
        }
        const active = activeZoneCode === z.code;
        const color = ZONE_COLORS[z.code] ?? "#7cb342";
        return (
          <g key={z.code} data-testid="map-zone" data-zone={z.code} data-hidden={hidden || undefined}>
            <circle
              cx={z.centerX}
              cy={-z.centerY}
              r={z.radius}
              fill={hidden ? "#a89d90" : color}
              fillOpacity={hidden ? 0.22 : active ? 0.55 : 0.3}
              stroke={hidden ? "#6e5f55" : "#3b2418"}
              strokeWidth={active ? 3 : 1.8}
              strokeDasharray={hidden ? "4 3" : undefined}
            />
            <text
              x={z.centerX}
              y={-z.centerY + 3.5}
              textAnchor="middle"
              fontSize={hidden ? 12 : 10}
              className="fill-dk-outline font-display"
              style={{ paintOrder: "stroke", stroke: "#fff6dc", strokeWidth: 2.5, strokeLinejoin: "round" }}
            >
              {hidden ? "???" : z.name}
            </text>
          </g>
        );
      })}

      {/* 주문 손님 목표와 판정 범위 (응대 후 공개) */}
      {reveal && (
        <g data-testid="map-reveal">
          {[...reveal.rings].reverse().map((ring, i) => (
            <circle
              key={ring.label} cx={sx(reveal.target)} cy={sy(reveal.target)} r={ring.r} data-testid="map-ring" data-ring={ring.label}
              fill="#4fb3bf" fillOpacity={0.1 + i * 0.07} className="stroke-dk-crystal" strokeWidth="1.6" strokeDasharray="5 3"
            />
          ))}
          <g transform={`translate(${sx(reveal.target)} ${sy(reveal.target)})`} data-testid="map-target">
            <polygon points="0,-9 2.6,-3 9,-2.6 4,1.6 5.6,8 0,4.6 -5.6,8 -4,1.6 -9,-2.6 -2.6,-3" className="fill-dk-red stroke-dk-outline" strokeWidth="1.8" />
          </g>
        </g>
      )}

      {/* 지나온 경로 */}
      {path.length > 1 && (
        <polyline
          points={path.map((p) => `${sx(p)},${sy(p)}`).join(" ")}
          fill="none"
          className="stroke-dk-outline"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {path.slice(0, -1).map((p, i) => (
        <circle key={i} cx={sx(p)} cy={sy(p)} r={i === 0 ? 3.4 : 2.6} className="fill-dk-paper stroke-dk-outline" strokeWidth="1.6" />
      ))}

      {/* 이동 미리보기 (점선) */}
      {preview && (
        <g data-testid="map-preview">
          <polyline
            points={(previewPath && previewPath.length > 1 ? previewPath : [position, preview]).map((p) => `${sx(p)},${sy(p)}`).join(" ")}
            fill="none" className="stroke-dk-red" strokeWidth="2.2" strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round"
          />
          <circle cx={sx(preview)} cy={sy(preview)} r="4" fill="none" className="stroke-dk-red" strokeWidth="2" strokeDasharray="2 2" />
        </g>
      )}

      {/* 현재 표식 (냄비) */}
      <g transform={`translate(${sx(position)} ${sy(position)})`} data-testid="map-marker">
        <circle r="7.5" className="fill-dk-lantern stroke-dk-outline" strokeWidth="2.6" />
        <path d="M-4 -1H4V2.5a4 4 0 0 1-8 0Z" className="fill-dk-outline" stroke="none" />
        <circle cx="-2" cy="-4" r="1.1" fill="#fff6dc" stroke="none" />
      </g>
    </svg>
  );
}
