// 조리(맛 지도) 마스터 데이터. 시드(code 기준 upsert)와 단위 테스트에서 공유한다. DB 의존 없음.
//
// ▼ 체감 조정은 이 파일의 숫자만 고치고 `npm run db:seed` 를 다시 실행하면 된다.
//   - COOKING_SETTINGS.kScale : 재료 하나가 표식을 얼마나 움직이는가 (클수록 크게 움직인다)
//   - ZONES[].centerX/centerY/radius : 요리 구역 (맛 지도 좌표 −100~100)
//   - METHODS : 조리법 이동량
// 구역이 현재 재료로 도달 가능한지는 `npm run test:unit` 의 cooking.reachability 테스트가 확인한다.

export const COOKING_SETTINGS = {
  kScale: 5, // dx = (열기 − 단맛) × k, dy = (감칠맛 − 마력) × k
  mapLimit: 100, // 좌표 범위 ±100
  toxinLimit: 6, // 독성이 이 값 이상이면 완성 불가
  minIngredients: 2,
  maxIngredients: 4,
  diluentCode: "water", // 희석 재료 (표식을 중심 쪽으로 당기고 독성 감소)
  diluentPullBp: 4000, // 40% (1/10000)
  diluentToxinDelta: -1,
  agingSeconds: 600, // 절이기 숙성 시간(초)
  perfectRatio: 0.35, // 구역 중심 거리 / 반지름 이하면 완벽
  goodRatio: 0.7, // 이하면 좋음, 그 외 보통
} as const;

// dx/dy 는 맛 지도 좌표 이동량 (가로 +열기/−단맛, 세로 +감칠맛/−마력).
// pullBp: 중심 쪽으로 당기는 비율(1/10000). toxinDelta: 독성 증감(0 미만으로는 내려가지 않는다).
export const METHODS = [
  { code: "grill", name: "굽기", dx: 15, dy: 8, pullBp: 0, toxinDelta: 0, aging: false, sortOrder: 1, description: "열기 +15, 감칠맛 +8" },
  { code: "boil", name: "끓이기", dx: 0, dy: 0, pullBp: 1500, toxinDelta: -3, aging: false, sortOrder: 2, description: "중심 쪽으로 15% 당김, 독성 −3" },
  { code: "fry", name: "튀기기", dx: 0, dy: 16, pullBp: 0, toxinDelta: 1, aging: false, sortOrder: 3, description: "감칠맛 +16, 독성 +1" },
  { code: "pickle", name: "절이기", dx: -12, dy: -6, pullBp: 0, toxinDelta: 0, aging: true, sortOrder: 4, description: "단맛 +12, 마력 +6 (숙성 후 수령)" },
] as const;

// 요리 구역: 원(중심, 반지름). 표식이 안에 있을 때만 완성할 수 있다.
// unlockFloor: 이 구역을 쓸 수 있는 층 (해금한 최고 층 기준). 깊은 층의 구역일수록 지도 바깥쪽에 있다.
// 같은 층·인접 층 구역끼리 겹치는 깊이는 두 반지름 중 작은 쪽의 1/3 이하 (cooking.test.ts 가 확인한다).
export const ZONES = [
  { code: "soup", name: "수프", unlockFloor: 1, centerX: 0, centerY: 30, radius: 22, signature: false, effectName: "속이 든든", effectDesc: "배를 따뜻하게 채워 준다.", description: "버섯과 소금으로 우려낸 담백한 국물 요리." },
  { code: "skewer", name: "꼬치", unlockFloor: 1, centerX: 36, centerY: 38, radius: 22, signature: false, effectName: "불끈 기운", effectDesc: "먹으면 힘이 솟아 모험이 가벼워진다.", description: "뜨겁고 진한 고기를 꽂아 구운 꼬치." },
  { code: "rice_cake", name: "떡", unlockFloor: 1, centerX: -34, centerY: 10, radius: 22, signature: false, effectName: "쫀득한 포만감", effectDesc: "달콤하고 쫀득해서 오래 든든하다.", description: "달콤한 재료를 쪄서 뭉친 떡." },
  { code: "pickles", name: "절임", unlockFloor: 2, centerX: -44, centerY: -26, radius: 22, signature: false, effectName: "은은한 마력", effectDesc: "단맛 속에 마력이 천천히 배어 나온다.", description: "달콤하고 신비롭게 숙성시킨 절임." },
  { code: "mushroom_hotpot", name: "버섯 전골", unlockFloor: 2, centerX: -8, centerY: 66, radius: 20, signature: false, effectName: "숲의 기운", effectDesc: "향긋한 숲의 기운이 몸을 감싼다.", description: "동굴 버섯을 듬뿍 넣고 끓인 진한 전골." },
  { code: "fritter", name: "튀김", unlockFloor: 3, centerX: 60, centerY: 10, radius: 22, signature: false, effectName: "바삭한 활력", effectDesc: "씹을수록 기운이 번진다.", description: "열기를 입혀 바삭하게 튀겨낸 요리." },
  { code: "lava_roast", name: "용암 구이", unlockFloor: 3, centerX: 80, centerY: -20, radius: 20, signature: false, effectName: "불꽃 기운", effectDesc: "속에서 불꽃 같은 기운이 타오른다.", description: "용암 열기로 겉을 바싹 구워낸 구이." },
  { code: "elixir", name: "영약", unlockFloor: 4, centerX: -26, centerY: -58, radius: 20, signature: false, effectName: "마력 충전", effectDesc: "몸에 마력이 가득 차오른다.", description: "마력을 응축해 달여낸 영약." },
  { code: "frost_flame_stirfry", name: "얼음불 볶음", unlockFloor: 4, centerX: 58, centerY: -58, radius: 20, signature: true, effectName: "냉열의 조화", effectDesc: "뜨거움과 차가움이 함께 번져 마음까지 깨운다.", description: "불꽃과 얼음의 상반된 기운이 균형을 이룬 전설의 볶음." },
  { code: "mana_essence", name: "마력 정수", unlockFloor: 5, centerX: 6, centerY: -84, radius: 16, signature: false, effectName: "넘치는 마력", effectDesc: "마력이 흘러넘쳐 잠시 눈앞이 반짝인다.", description: "마력의 샘 물을 졸여 얻은 맑은 정수." },
] as const;

// 속성 수식어: 최종 표식 위치에서 중심으로부터 가장 멀리 간 방향으로 정한다.
// minDistance 보다 중심에 가까우면 수식어를 붙이지 않는다 (시그니처 구역은 고유 이름이라 쓰지 않는다).
export const MODIFIERS = [
  { code: "heat", direction: "heat", word: "불꽃", minDistance: 20 },
  { code: "sweet", direction: "sweet", word: "달콤한", minDistance: 20 },
  { code: "umami", direction: "umami", word: "진한", minDistance: 20 },
  { code: "mana", direction: "mana", word: "신비한", minDistance: 20 },
] as const;
