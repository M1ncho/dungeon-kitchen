// 재료 마스터 데이터 (시드 + 단위 테스트에서 공유). DB 의존 없음.

export type Rarity = "common" | "rare" | "legendary";
// [code, name, icon, rarity, heat, umami, sweet, mana, toxin, description]
export const INGREDIENTS: [string, string, string, Rarity, number, number, number, number, number, string][] = [
  ["slime_jelly", "슬라임 젤리", "droplet", "common", 1, 2, 6, 1, 0, "말랑하고 달콤한 점액질."],
  ["cave_mushroom", "동굴 버섯", "sprout", "common", 0, 7, 1, 1, 1, "진한 감칠맛이 나는 흔한 버섯."],
  ["goblin_meat", "고블린 고기", "drumstick", "common", 3, 6, 0, 0, 2, "질기지만 든든한 고기."],
  ["moss_leaf", "이끼 잎", "leaf", "common", 0, 2, 2, 2, 0, "은은한 풀향이 나는 잎."],
  ["bat_wing", "박쥐 날개", "feather", "common", 1, 4, 0, 2, 3, "바삭하게 튀기면 별미."],
  ["lava_pepper", "용암 고추", "flame", "common", 9, 2, 0, 1, 1, "입에서 불이 나는 고추."],
  ["magma_crab", "마그마 게", "shell", "rare", 7, 7, 1, 2, 0, "껍질 속 살이 뜨겁고 짙다."],
  ["ember_honey", "불씨 꿀", "flame-kindling", "rare", 5, 1, 9, 2, 0, "따뜻하고 진득한 달콤함."],
  ["salamander_tail", "도롱뇽 꼬리", "zap", "common", 8, 5, 0, 3, 2, "구우면 향이 좋은 꼬리."],
  ["crystal_shard", "마력 수정 조각", "gem", "rare", 0, 0, 2, 9, 1, "씹으면 마력이 번지는 결정."],
  ["glow_berry", "발광 열매", "cherry", "common", 0, 1, 7, 6, 0, "은은하게 빛나는 달콤한 열매."],
  ["abyss_eel", "심연 장어", "fish", "rare", 1, 9, 0, 6, 3, "깊은 곳의 기름진 장어."],
  ["venom_bloom", "독꽃 꽃잎", "flower-2", "common", 0, 1, 3, 3, 9, "아름답지만 강한 독을 품었다."],
  ["wyrm_scale_salt", "와이번 비늘 소금", "sparkles", "legendary", 4, 8, 0, 8, 0, "전설의 비늘을 갈아 만든 소금."],
  ["phoenix_egg", "불사조 알", "egg", "legendary", 8, 6, 6, 9, 0, "따뜻한 생명력이 깃든 알."],
  // ── 성장 1단계(층 이동)에서 추가: 1~5층 새 재료 ──
  ["jerky", "그을린 육포", "drumstick", "common", 4, 5, 0, 0, 0, "초보 모험가의 배낭에서 흔히 나오는 질긴 육포."],
  ["wild_tuber", "야생 덩이뿌리", "sprout", "common", 0, 3, 4, 0, 0, "달큰하고 포슬포슬한 입구 근처의 뿌리."],
  ["glow_cap", "발광 버섯", "sprout", "common", 0, 2, 3, 6, 0, "은은하게 빛나는 마력 어린 버섯."],
  ["moss_jelly", "이끼 젤리", "droplet", "common", 0, 1, 5, 4, 0, "이끼 사이에서 굳은 달콤한 젤리."],
  ["bitter_cap", "쓴맛 독버섯", "sprout", "common", 2, 6, 0, 2, 5, "독이 있지만 감칠맛이 진한 버섯."],
  ["lumen_truffle", "빛무리 송로", "sparkles", "rare", 0, 9, 3, 6, 0, "동굴 깊은 곳에서 빛나는 귀한 송로."],
  ["fire_root", "화염 뿌리", "flame", "common", 9, 4, 0, 2, 2, "씹으면 입안이 뜨거워지는 뿌리."],
  ["ember_fruit", "숯불 열매", "cherry", "common", 6, 1, 4, 1, 0, "구운 듯 달콤하고 따뜻한 열매."],
  ["magma_salt", "용암 소금", "flame-kindling", "common", 7, 2, 0, 5, 0, "용암에 굳은 소금 결정. 열기와 마력이 함께 배어 있다."],
  ["frost_herb", "서리 허브", "leaf", "common", 0, 4, 1, 7, 0, "서리가 맺힌 차가운 향초."],
  ["ice_shard", "얼음 조각", "snowflake", "common", 0, 1, 3, 8, 0, "마력이 얼어붙은 투명한 조각."],
  ["frost_pearl", "서리 진주", "gem", "rare", 0, 5, 4, 9, 0, "냉기를 품은 진주."],
  ["spring_water", "마력 샘물", "glass-water", "rare", 0, 2, 2, 8, 0, "마력의 샘에서 길어 올린 맑은 물."],
  ["starlight_dew", "별빛 이슬", "sparkles", "legendary", 0, 7, 2, 10, 0, "별빛을 머금은 이슬."],
  ["primal_crystal", "원초의 수정", "gem", "legendary", 0, 0, 0, 10, 2, "마력의 원천에서 자란 수정."],
];

// 재료 기본 가격 (행상 가격의 기준). 희귀 ~50, 전설 ~200+.
export const BASE_PRICES: Record<string, number> = {
  slime_jelly: 8, cave_mushroom: 6, goblin_meat: 10, moss_leaf: 5, bat_wing: 9, lava_pepper: 9,
  salamander_tail: 12, glow_berry: 10, venom_bloom: 8,
  magma_crab: 45, ember_honey: 50, crystal_shard: 55, abyss_eel: 60,
  wyrm_scale_salt: 220, phoenix_egg: 300,
  jerky: 9, wild_tuber: 7, glow_cap: 10, moss_jelly: 8, bitter_cap: 7, lumen_truffle: 50,
  fire_root: 11, ember_fruit: 10, magma_salt: 9, frost_herb: 11, ice_shard: 12, frost_pearl: 58,
  spring_water: 55, starlight_dew: 260, primal_crystal: 240,
};

// 기본 식재료 (안전망): 언제든 고정가로 구매 가능. 층 출현 테이블에는 넣지 않는다.
// [code, name, icon, heat, umami, sweet, mana, toxin, basePrice, description]
export const STAPLES: [string, string, string, number, number, number, number, number, number, string][] = [
  ["water", "물", "glass-water", 0, 0, 0, 0, 0, 1, "어디에나 필요한 깨끗한 물."],
  ["salt", "소금", "snowflake", 0, 3, 0, 0, 0, 2, "음식의 맛을 살려 주는 굵은 소금."],
  ["dungeon_mushroom", "던전 버섯", "sprout", 0, 4, 0, 1, 0, 4, "시장에서 늘 구할 수 있는 평범한 버섯."],
  ["flour", "밀가루", "wheat", 0, 1, 1, 0, 0, 3, "튀김옷이나 반죽에 쓰는 고운 가루."],
  ["cooking_oil", "식용유", "droplets", 1, 1, 0, 0, 0, 5, "튀기고 굽는 데 쓰는 기름."],
];


// 요리 이름에 쓰는 재료 짧은 이름 (ingredients.short_name)
export const SHORT_NAMES: Record<string, string> = {
  slime_jelly: "슬라임", cave_mushroom: "동굴버섯", goblin_meat: "고블린", moss_leaf: "이끼",
  bat_wing: "박쥐", lava_pepper: "고추", magma_crab: "마그마게", ember_honey: "불씨꿀",
  salamander_tail: "도롱뇽", crystal_shard: "수정", glow_berry: "열매", abyss_eel: "장어",
  venom_bloom: "독꽃", wyrm_scale_salt: "비늘소금", phoenix_egg: "불사조",
  water: "맑은물", salt: "소금", dungeon_mushroom: "버섯", flour: "밀가루", cooking_oil: "기름",
  jerky: "육포", wild_tuber: "뿌리", glow_cap: "발광버섯", moss_jelly: "이끼젤리", bitter_cap: "독버섯", lumen_truffle: "송로",
  fire_root: "화염뿌리", ember_fruit: "숯불열매", magma_salt: "용암소금", frost_herb: "서리허브", ice_shard: "얼음", frost_pearl: "진주",
  spring_water: "샘물", starlight_dew: "이슬", primal_crystal: "원초수정",
};

// 재료의 해금 층: 이 층부터 행상 품목에 나온다 (기본 식재료는 1층, 모든 층에서 같은 가격).
// 행상 품목표(FLOOR_DROPS)와 층 해금 미리보기에 쓴다. 구역 도달 가능성 테스트는 "해금 층 ≤ N 인 재료"를 그 층의 재료로 본다.
export const INGREDIENT_FLOORS: Record<string, number> = {
  slime_jelly: 1, goblin_meat: 1, bat_wing: 1, venom_bloom: 1, jerky: 1, wild_tuber: 1,
  water: 1, salt: 1, dungeon_mushroom: 1, flour: 1, cooking_oil: 1,
  cave_mushroom: 2, moss_leaf: 2, glow_cap: 2, moss_jelly: 2, bitter_cap: 2, lumen_truffle: 2,
  lava_pepper: 3, salamander_tail: 3, magma_crab: 3, ember_honey: 3, fire_root: 3, ember_fruit: 3, magma_salt: 3,
  crystal_shard: 4, glow_berry: 4, abyss_eel: 4, frost_herb: 4, ice_shard: 4, frost_pearl: 4,
  wyrm_scale_salt: 5, phoenix_egg: 5, spring_water: 5, starlight_dew: 5, primal_crystal: 5,
};
