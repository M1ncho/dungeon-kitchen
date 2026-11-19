// 포장마차 영업(Phase 3) 마스터 데이터. 시드(code 기준 upsert)와 단위 테스트에서 공유한다. DB 의존 없음.
//
// ▼ 체감 조정은 이 파일의 숫자를 고치고 `npm run db:seed` 를 다시 실행하면 된다.
//   구매 확률 공식(점수 → 확률)은 src/lib/game/sales.ts 의 주석을 본다.

export const SALES_SETTINGS = {
  displaySlots: 4, // 진열 칸 수
  tickSeconds: 300, // 정산 틱 (5분)
  maxSessionSeconds: 4 * 60 * 60, // 최대 영업 시간 (4시간, 넘으면 자동 마감)
  priceMinPct: 50, // 가격 범위: 기준가의 50%~200%
  priceMaxPct: 200,
  priceMultiplier: 2.4, // 기준가 = 재료비 × 배율
  customersMin: 0, // 틱당 손님 수 (5분마다 0~3명)
  customersMax: 3,
  preferBonus: 30, // 선호 구역(또는 독성 선호) 취향 점수
  avoidPenalty: 40, // 기피 구역 감점
  burdenSlope: 50, // 가격/기준가 가 1 을 넘을 때 (비율−1) × 이 값 = 가격 부담
  discountSlope: 30, // 1 미만일 때 (1−비율) × 이 값 = 가산점 (싸게 팔수록 잘 팔린다)
  reliefGood: 0.2, // 품질 "좋음": 가격 부담 20% 감소
  reliefPerfect: 0.4, // 품질 "완벽": 가격 부담 40% 감소
  flatGood: 2, // 품질 고정 보정 점수 (보통 0)
  flatPerfect: 5,
  buyBase: 0.6, // 점수 0 (기준가·취향 무관·보통 품질)일 때의 구매 확률
  buyScale: 0.01, // 점수 1 당 확률 변화
  repGood: 1, // 판매 1건당 평판 (보통 0)
  repPerfect: 2,
  repPreferred: 1, // 선호 구역 요리를 팔면 추가
} as const;

// 손님 취향 초안 (구역 code 는 seed-data/cooking.ts 의 ZONES 와 맞춘다).
// toxicPrefMin: 요리 독성이 이 값 이상이면 "선호"로 친다 (null = 해당 없음).
// 구역: soup 수프, skewer 꼬치, fritter 튀김, pickles 절임, rice_cake 떡, elixir 영약, frost_flame_stirfry 얼음불 볶음(시그니처)
export const CUSTOMER_TASTES: Record<string, { preferred: string[]; avoided: string[]; toxicPrefMin: number | null }> = {
  human_warrior: { preferred: ["skewer", "fritter"], avoided: ["elixir"], toxicPrefMin: null },
  elf_mage: { preferred: ["elixir", "pickles", "frost_flame_stirfry"], avoided: ["fritter"], toxicPrefMin: null },
  dwarf_miner: { preferred: ["soup", "skewer"], avoided: ["pickles"], toxicPrefMin: 3 },
  halfling_thief: { preferred: ["rice_cake", "pickles"], avoided: ["elixir"], toxicPrefMin: null },
  orc_berserker: { preferred: ["fritter", "skewer", "frost_flame_stirfry"], avoided: ["rice_cake", "pickles"], toxicPrefMin: 3 },
  beast_hunter: { preferred: ["skewer", "soup"], avoided: ["rice_cake"], toxicPrefMin: null },
  // 성장 1단계: 새 손님 유형
  elf_herbalist: { preferred: ["pickles", "mushroom_hotpot"], avoided: ["skewer"], toxicPrefMin: null },
  gnome_forager: { preferred: ["mushroom_hotpot", "soup"], avoided: ["fritter"], toxicPrefMin: null },
  flame_mercenary: { preferred: ["fritter", "lava_roast", "skewer"], avoided: ["pickles"], toxicPrefMin: 3 },
  frost_witch: { preferred: ["elixir", "frost_flame_stirfry", "pickles"], avoided: ["lava_roast"], toxicPrefMin: null },
  moon_sage: { preferred: ["mana_essence", "elixir"], avoided: ["fritter", "rice_cake"], toxicPrefMin: null },
  dragon_envoy: { preferred: ["lava_roast", "frost_flame_stirfry", "mana_essence"], avoided: ["soup"], toxicPrefMin: null },
};

// 층별 손님 출현 가중치 [floorNo][customer code] (손님은 포장마차가 있는 층의 가중치로 뽑는다)
export const CUSTOMER_FLOOR_WEIGHTS: Record<number, Record<string, number>> = {
  1: { human_warrior: 30, dwarf_miner: 25, halfling_thief: 20, beast_hunter: 15, elf_mage: 8, orc_berserker: 5 },
  2: { elf_herbalist: 25, gnome_forager: 25, human_warrior: 15, halfling_thief: 12, dwarf_miner: 10, beast_hunter: 8, elf_mage: 5 },
  3: { flame_mercenary: 30, orc_berserker: 20, dwarf_miner: 15, human_warrior: 15, beast_hunter: 10, halfling_thief: 5, elf_mage: 5 },
  4: { frost_witch: 30, elf_mage: 20, beast_hunter: 15, flame_mercenary: 10, halfling_thief: 10, dwarf_miner: 5 },
  5: { moon_sage: 30, dragon_envoy: 25, frost_witch: 20, elf_mage: 15, flame_mercenary: 5, beast_hunter: 5 },
};
