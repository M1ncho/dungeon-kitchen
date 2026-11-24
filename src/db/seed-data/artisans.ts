// 층별 장인과 새 조리 도구 마스터 데이터. 시드(code 기준 upsert)와 단위 테스트에서 공유한다. DB 의존 없음.
//
// ▼ 체감 조정은 이 파일의 숫자·문장을 고치고 `npm run db:seed` 를 다시 실행하면 된다 (production 에도 따로 반영).
//   - 부탁(requestZoneCode / requestMinQuality / requestCount): 그 층 테마에 맞는 구역의 요리를 이 품질 이상으로 납품
//   - upgrades: 도구 강화 비용 (1단계, 2단계). 골드 + 재료(ingredients.code). 플레이 후 조정 예정
//   - 조리법 동작(확대 배율·회전 각도·끌어당김 비율·사용 횟수·크기 선택지)은 seed-data/cooking.ts 의 METHODS
// 도구는 가게를 그 층으로 처음 옮겼을 때 등장하는 장인에게 부탁을 들어주면 받는다.

export type ArtisanSeed = {
  code: string; floorNo: number; name: string; title: string; toolName: string; methodCode: string;
  requestZoneCode: string; requestMinQuality: number; requestCount: number;
  greeting: string; requestText: string; thanksText: string; usageText: string; idleText: string;
  upgradeTexts: string[]; upgrades: { gold: number; items: { ingredient: string; qty: number }[] }[];
};

export const ARTISANS: ArtisanSeed[] = [
  {
    code: "molu", floorNo: 2, name: "몰루", title: "노움 발효 장인", toolName: "발효 항아리", methodCode: "ferment",
    requestZoneCode: "pickles", requestMinQuality: 2, requestCount: 1,
    greeting: "어, 새 손님이다! 여기 항아리가 얼마나 근사한지 보여 주고 싶었거든!",
    requestText: "버섯 동굴에서 제일 중요한 건 절임이거든! 좋은 절임 하나만 가져와 봐, 맛 좀 보고 싶어!",
    thanksText: "우와, 이거 진짜 잘 익었잖아! 약속대로 내 발효 항아리를 줄게, 소중히 써야 해!",
    usageText: "항아리에 넣으면 지금 맛이 중심에서 한 걸음 더 멀리 퍼지거든! 대신 독이 조금 올라가고, 숙성 시간이 필요하니까 서두르지 말고 꺼내 보라고!",
    idleText: "항아리 뚜껑 열어 두면 안 돼! 향이 다 달아난다니까!",
    upgradeTexts: ["항아리를 한 번 더 쓸 수 있게 손봤어! 같은 요리에 두 번까지 넣어 봐!", "이제 항아리를 살살 / 보통 / 세게 익힐 수 있어! 쓸 때마다 골라 보라고!"],
    upgrades: [
      { gold: 200, items: [{ ingredient: "glow_cap", qty: 3 }, { ingredient: "moss_jelly", qty: 2 }] },
      { gold: 450, items: [{ ingredient: "lumen_truffle", qty: 1 }, { ingredient: "glow_cap", qty: 3 }] },
    ],
  },
  {
    code: "turgan", floorNo: 3, name: "투르간", title: "드워프 훈연 장인", toolName: "훈연기", methodCode: "smoke",
    requestZoneCode: "lava_roast", requestMinQuality: 1, requestCount: 1,
    greeting: "쯧, 새로 온 요리사로군. 불 다룰 줄 알면 말이지, 내 훈연기를 빌려줄 수도 있다고.",
    requestText: "용암 구이 하나 만들어 오라고. 보통이면 된다. 불 앞에서 도망 안 치는지만 볼 테니까.",
    thanksText: "흠, 탄 데 없이 잘 구웠군. 약속은 약속이지. 훈연기는 네 거다.",
    usageText: "연기를 쐬면 지금 맛이 시계 방향으로 돌아간다고. 열기 쪽이었던 맛이 마력 쪽으로 넘어가지. 독도 조금 빠지니까 잘 써 보라고.",
    idleText: "불 앞에서 한눈팔지 마라. 연기는 기다려 주지 않는다고.",
    upgradeTexts: ["연통을 하나 더 달았다. 같은 요리에 두 번까지 쓸 수 있다고.", "이제 연기를 약하게, 보통, 세게 골라 쓸 수 있다. 쓸 때마다 정하라고."],
    upgrades: [
      { gold: 450, items: [{ ingredient: "ember_fruit", qty: 3 }, { ingredient: "magma_salt", qty: 2 }] },
      { gold: 900, items: [{ ingredient: "magma_crab", qty: 1 }, { ingredient: "fire_root", qty: 3 }] },
    ],
  },
  {
    code: "serin", floorNo: 4, name: "세린", title: "서리 세공사", toolName: "수정 맷돌", methodCode: "grind",
    requestZoneCode: "elixir", requestMinQuality: 2, requestCount: 1,
    greeting: "어서 오세요… 수정은 서두르면 금이 갑니다. 천천히 들어 주시겠어요.",
    requestText: "마력을 달여 낸 영약을… 좋은 것으로 하나 부탁드립니다. 맛이 맑은지 보고 싶어서요.",
    thanksText: "…맑습니다. 약속드린 수정 맷돌을 드리겠습니다. 소중히 다뤄 주세요.",
    usageText: "맷돌에 갈린 재료는 방향이 반대로 뒤집히고, 독도 모두 빠집니다. 갈기를 쓴 뒤 다음에 넣는 재료 하나에 적용되니, 넣을 자리를 남겨 두세요.",
    idleText: "…수정이 울고 있네요. 오늘은 조용히 갈아야겠어요.",
    upgradeTexts: ["맷돌을 한 번 더 돌릴 수 있게 다듬었습니다. 같은 요리에 두 번까지 쓰세요.", "이제 한 번 갈면 다음 재료 두 개에 닿습니다. 천천히, 아껴 쓰세요."],
    upgrades: [
      { gold: 900, items: [{ ingredient: "ice_shard", qty: 3 }, { ingredient: "frost_herb", qty: 2 }] },
      { gold: 1800, items: [{ ingredient: "frost_pearl", qty: 1 }, { ingredient: "ice_shard", qty: 3 }] },
    ],
  },
  {
    code: "onyu", floorNo: 5, name: "온유", title: "샘의 수도승", toolName: "샘물 찜통", methodCode: "steam",
    requestZoneCode: "mana_essence", requestMinQuality: 1, requestCount: 1,
    greeting: "샘이 당신이 오리라 일러 주었소. 서두르지 마시오.",
    requestText: "마력 정수를 한 접시 올려 주시오. 정성이 담겼다면 맛은 따라오는 법이오.",
    thanksText: "샘이 기뻐하는구려. 약속한 샘물 찜통을 드리겠소. 부디 마음을 담아 쓰시오.",
    usageText: "찜통에 올리면 지금 맛이 가장 가까운 요리 구역 쪽으로 천천히 다가가오. 독도 조금 풀어 주니, 마지막에 다듬을 때 쓰면 좋소.",
    idleText: "샘물은 말이 없소. 다만 듣는 이에게만 들릴 뿐이오.",
    upgradeTexts: ["찜통을 한 번 더 쓸 수 있게 되었소. 같은 요리에 두 번까지 올리시오.", "이제 김의 세기를 약하게, 보통, 세게 고를 수 있소. 쓸 때마다 정하시오."],
    upgrades: [
      { gold: 1600, items: [{ ingredient: "frost_herb", qty: 3 }, { ingredient: "ice_shard", qty: 3 }] },
      { gold: 3200, items: [{ ingredient: "spring_water", qty: 2 }, { ingredient: "starlight_dew", qty: 1 }] },
    ],
  },
];
