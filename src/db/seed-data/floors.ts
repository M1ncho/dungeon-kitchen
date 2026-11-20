// 층(성장 1단계) 마스터 데이터. 시드(floor_no / code 기준 upsert)와 단위 테스트에서 공유한다. DB 의존 없음.
//
// ▼ 체감 조정은 이 파일의 숫자를 고치고 `npm run db:seed` 를 다시 실행하면 된다 (플레이 후 조정 예정).

export type FloorSeed = {
  floorNo: number;
  name: string;
  theme: string; // 층 지도에 보이는 한 줄 테마
  description: string;
  dangerLevel: number;
  durationSeconds: number; // 의뢰 게시판 소요 시간(초): 의뢰한 재료의 해금 층 기준 (1층 30분 … 5층 4시간)
  unlockReputation: number; // 이 층의 승급 시험 손님이 나타나는 평판
  moveCost: number; // 이 층으로 내려갈 때(더 깊은 층으로) 드는 골드. 위층으로 갈 때는 무료
  priceMultiplier: number; // 손님이 쳐주는 요리 기준가 배율 (재료비 × 판매 배율 × 이 값)
  orderSpawnBp: number; // 주문 손님 등장 확률 (틱당, 1/10000)
  orderJudgeScale: number; // 주문 판정 범위 배율 (작을수록 까다롭다)
  qualityFlatScale: number; // 좋음·완벽 품질의 고정 보정 점수 배율
  normalPenalty: number; // 보통 품질 요리의 구매 점수 감점
};

export const FLOORS: FloorSeed[] = [
  { floorNo: 1, name: "이끼 낀 입구", theme: "초보 모험가가 오가는 곳", description: "습하지만 비교적 안전한 던전 초입. 기본 재료와 소박한 요리가 어울린다.", dangerLevel: 1, durationSeconds: 1800, unlockReputation: 0, moveCost: 0, priceMultiplier: 1.0, orderSpawnBp: 3000, orderJudgeScale: 1.0, qualityFlatScale: 1.0, normalPenalty: 0 },
  { floorNo: 2, name: "버섯 동굴", theme: "습하고 빛나는 버섯", description: "발광 버섯과 이끼가 가득한 동굴. 절임과 전골이 인기다.", dangerLevel: 2, durationSeconds: 3600, unlockReputation: 30, moveCost: 150, priceMultiplier: 1.25, orderSpawnBp: 3300, orderJudgeScale: 0.92, qualityFlatScale: 1.2, normalPenalty: 4 },
  { floorNo: 3, name: "용암 갈림길", theme: "뜨겁고 위험한 길목", description: "용암이 흐르는 길목. 화염 재료와 불맛 요리의 단골들이 지나간다.", dangerLevel: 3, durationSeconds: 7200, unlockReputation: 80, moveCost: 400, priceMultiplier: 1.6, orderSpawnBp: 3600, orderJudgeScale: 0.85, qualityFlatScale: 1.4, normalPenalty: 8 },
  { floorNo: 4, name: "얼음 수정굴", theme: "차갑고 반짝이는 곳", description: "수정과 냉기가 어우러진 굴. 마력 요리를 찾는 손님이 많다.", dangerLevel: 4, durationSeconds: 10800, unlockReputation: 160, moveCost: 900, priceMultiplier: 2.0, orderSpawnBp: 4000, orderJudgeScale: 0.78, qualityFlatScale: 1.7, normalPenalty: 12 },
  { floorNo: 5, name: "마력의 샘", theme: "숙련 모험가들의 쉼터", description: "마력이 샘솟는 쉼터. 전설 재료와 숙련 모험가들의 까다로운 입맛이 있다.", dangerLevel: 5, durationSeconds: 14400, unlockReputation: 300, moveCost: 1800, priceMultiplier: 2.6, orderSpawnBp: 4500, orderJudgeScale: 0.7, qualityFlatScale: 2.0, normalPenalty: 16 },
];

/** 행상 출신 층 가중치: 내 가게가 있는 층 기준 (같은 층 / 한 층 아래(더 깊은 층) / 위층). 없는 층은 빼고 다시 계산한다. */
export const PEDDLER_ORIGIN_WEIGHTS = { same: 70, deeper: 20, shallower: 10 } as const;

/** 승급 시험 설정 */
export const EXAM_SETTINGS = {
  waitSeconds: 24 * 60 * 60, // 시험 손님이 기다리는 시간
  retrySeconds: 24 * 60 * 60, // 실패한 뒤 새 시험 손님이 오기까지
} as const;

// 행상 품목표 [floorNo, ingredient code, weight]: 그 층 출신 행상이 가져오는 재료 (등급 확률은 PEDDLER_RULES)
export const FLOOR_DROPS: [number, string, number][] = [
  [1, "slime_jelly", 25], [1, "goblin_meat", 20], [1, "bat_wing", 15], [1, "venom_bloom", 10], [1, "jerky", 25], [1, "wild_tuber", 25],
  [2, "cave_mushroom", 30], [2, "moss_leaf", 25], [2, "glow_cap", 25], [2, "moss_jelly", 20], [2, "bitter_cap", 12], [2, "lumen_truffle", 8],
  [3, "lava_pepper", 30], [3, "salamander_tail", 25], [3, "fire_root", 22], [3, "ember_fruit", 22], [3, "magma_salt", 20], [3, "magma_crab", 8], [3, "ember_honey", 6],
  [4, "glow_berry", 25], [4, "frost_herb", 25], [4, "ice_shard", 25], [4, "crystal_shard", 10], [4, "abyss_eel", 8], [4, "frost_pearl", 6],
  [5, "frost_herb", 15], [5, "ice_shard", 15], [5, "glow_berry", 10], [5, "spring_water", 20], [5, "crystal_shard", 8], [5, "frost_pearl", 8],
  [5, "starlight_dew", 4], [5, "primal_crystal", 4], [5, "wyrm_scale_salt", 3], [5, "phoenix_egg", 2],
];

// 층별 행상 생성 규칙 [floorNo, itemsMin, itemsMax, qtyMin, qtyMax, rareBp, legendaryBp, priceMinPct, priceMaxPct]
export const PEDDLER_RULES: [number, number, number, number, number, number, number, number, number][] = [
  [1, 3, 4, 3, 8, 500, 0, 90, 120],
  [2, 3, 5, 3, 7, 1200, 0, 90, 125],
  [3, 3, 5, 2, 6, 1800, 0, 95, 130],
  [4, 3, 4, 2, 5, 2500, 200, 100, 135],
  [5, 3, 4, 2, 5, 3000, 800, 100, 140],
];

// 승급 시험 감독관 (층마다 1명): [code, name, race, job, icon, examFloor]
// 목표 영역과 말투는 seed-data/orders.ts 의 CUSTOMER_ORDER_PROFILES 에 있다.
export const SUPERVISORS: [string, string, string, string, string, number][] = [
  ["inspector_f2", "버섯 동굴 조합 감독관", "노움", "상인 조합 감독관", "clipboard-list", 2],
  ["inspector_f3", "용암 갈림길 조합 감독관", "드워프", "상인 조합 감독관", "clipboard-list", 3],
  ["inspector_f4", "얼음 수정굴 조합 감독관", "엘프", "상인 조합 감독관", "clipboard-list", 4],
  ["inspector_f5", "마력의 샘 조합 감독관", "고룡족", "상인 조합 감독관", "clipboard-list", 5],
];

// 새 일반 손님 유형 [code, name, race, job, icon, spawnWeight(기본)]
// 선호·기피·말투·영역은 seed-data/sales.ts, seed-data/orders.ts 에 있다.
export const NEW_CUSTOMERS: [string, string, string, string, string][] = [
  ["elf_herbalist", "엘프 약초꾼", "엘프", "약초꾼", "leaf"],
  ["gnome_forager", "노움 버섯 채집가", "노움", "채집가", "sprout"],
  ["flame_mercenary", "화염 용병", "인간", "용병", "flame"],
  ["frost_witch", "서리 마녀", "인간", "마녀", "snowflake"],
  ["moon_sage", "달빛 현자", "엘프", "현자", "sparkles"],
  ["dragon_envoy", "고룡의 사절", "고룡족", "사절", "crown"],
];
