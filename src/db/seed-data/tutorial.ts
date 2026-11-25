// 첫 플레이 안내(튜토리얼)·상황별 팁·도움말 마스터 데이터. 시드(code 기준 upsert)와 단위 테스트에서 공유한다. DB 의존 없음.
//
// ▼ 대사·팁·도움말 문장과 수치는 이 파일을 고치고 `npm run db:seed` 를 다시 실행하면 된다 (production 에도 따로 반영해야 한다).
//   - 대사는 한 번에 두 문장 이내. 안내 캐릭터는 TUTORIAL_SETTINGS 의 이름·직함.
//   - 문장 안의 {floor}, {nextFloor}, {nextRep} 는 서버가 실제 값으로 바꿔 보낸다.
//   - 수치(진열 칸 수, 가격 범위, 독성 한계, 평판 규칙)를 도움말 문장에 적었다면, 게임 수치를 바꿀 때 함께 점검한다.
//   - 안내 수프 레시피가 수프 구역에 들어가는지는 `npm run test:unit` 의 tutorial 테스트가 확인한다 (src/lib/game/tutorial.ts 의 TUTORIAL_RECIPE).

import { TUTORIAL_CUSTOMER_CODE } from "../../lib/game/tutorial";

export const TUTORIAL_SETTINGS = {
  guideName: "바르둔", // 안내 캐릭터 (넉살 좋은 중년 드워프, "~하게" "~일세" 말투)
  guideTitle: "상업 조합장",
  firstTickSeconds: 60, // 안내 영업 세션의 틱 길이(초): 첫 안내 손님이 오기까지 기다리는 시간. 일반 영업은 sales_settings.tick_seconds
  orderJudgeScale: 1.6, // 안내 주문의 판정 범위 배율 (1보다 크면 넉넉하다)
} as const;

/** 안내 손님·안내 주문 손님으로 오는 조합장 본인. 일반 손님 가중치 표(customer_floor_weights)에는 들어가지 않는다. */
export const TUTORIAL_CUSTOMER = {
  code: TUTORIAL_CUSTOMER_CODE,
  name: "상업 조합장 바르둔",
  race: "드워프",
  job: "조합장",
  icon: "crown",
  style: "guildmaster", // 말투 (order_texts, seed-data/orders.ts)
  customBasePrice: 40,
  // 수프 구역(0, 30) 근처의 작은 영역: 안내 수프(0, 25.5)와 가깝다
  regions: [{ cx: 0, cy: 30, r: 6, w: 1 }],
} as const;

export type TutorialLine = {
  step: string;
  /** 주방·포장마차 안의 세부 안내 이름. 그 외에는 "" (단계의 순서 있는 대사들), "nav" = 다른 화면에 있을 때 길 안내 */
  phase: string;
  seq: number;
  /** say: 말하고 "다음" 버튼 / mission: 행동을 시키고 버튼 대신 안내 문구 */
  kind: "say" | "mission";
  /** 강조할 대상 (data-tutorial-target). 없으면 "" */
  target: string;
  text: string;
};

const L: TutorialLine[] = [];
const say = (step: string, seq: number, target: string, text: string, phase = "") => L.push({ step, phase, seq, kind: "say", target, text });
const mission = (step: string, seq: number, target: string, text: string, phase = "") => L.push({ step, phase, seq, kind: "mission", target, text });

// 0. 요리사 등록 직후
say("intro", 1, "", "어서 오게, 신참! 나는 던전 상업 조합장 바르둔일세.");
say("intro", 2, "", "여긴 던전 상업 지구라네. 자네는 이 포장마차에서 한 발짝도 떠나지 않고 장사를 하게 될 걸세.");
// 1. 홈
say("home", 1, "hud", "위쪽 나무판을 보게. 골드와 평판, 그리고 자네 가게가 있는 층이 적혀 있다네.");
say("home", 2, "shop-window", "저게 자네 포장마차일세. 영업을 시작하면 지나가던 손님들이 저기서 기웃거릴 걸세.");
say("home", 3, "facilities", "이 타일들이 자네 시설일세. 누르면 바로 들어가고, 다른 화면에선 옆(작은 화면에선 아래)의 탭으로 오갈 수 있다네.");
// 2. 재료 시장
say("market_info", 1, "market-staples", "여기선 기본 식재료를 언제든 살 수 있다네. 시간마다 모험가 행상도 들르니 귀한 재료는 그쪽에서 구하게.");
mission("market_buy", 1, "market-staples", "던전 버섯 1개와 소금 1개를 구매하세요 ({n}/2)");
// 3. 주방 (세부 단계)
mission("kitchen_cook", 1, "kitchen-ingredients", "먼저 던전 버섯을 냄비에 넣어 보게.", "pick1");
say("kitchen_cook", 1, "kitchen-map", "표식이 움직였지? 점선은 재료를 넣었을 때 닿을 자리를 미리 보여 준다네.", "explain1");
mission("kitchen_cook", 1, "kitchen-ingredients", "이번엔 소금을 넣게. 표식이 수프 구역 한가운데로 가야 하네.", "pick2");
say("kitchen_cook", 1, "kitchen-map", "구역의 중심에 가까울수록 품질이 좋아지고 별이 늘어난다네. 수프 구역 안이니 완성할 수 있겠군.", "explain2");
mission("kitchen_cook", 1, "kitchen-methods", "조리법 '끓이기'를 골라 보게. 표식이 지도 한가운데 쪽으로 조금 당겨진다네.", "method");
mission("kitchen_cook", 1, "kitchen-finish", "이제 '완성하기'를 눌러 보게!", "finish");
say("kitchen_cook", 1, "kitchen-reset", "어이쿠, 순서가 다른 모양이군. '처음부터'를 눌러 던전 버섯, 소금, 끓이기 순서로 해 보게.", "off");
say("kitchen_cook", 1, "", "재료가 모자라군. 재료 시장에서 던전 버섯과 소금을 다시 사 오게.", "short");
say("kitchen_done", 1, "", "훌륭하네! 첫 수프가 창고에 들어갔으니 이걸 팔러 가세.");
// 4. 포장마차 (세부 단계)
mission("stall_open", 1, "stall-slots", "수프를 진열대에 올려 보게. 수량과 가격은 칸마다 정할 수 있다네.", "display");
say("stall_open", 1, "stall-slots", "기준가는 재료값에 이문을 얹은 값일세. 처음엔 기준가 그대로가 무난하다네.", "price");
mission("stall_open", 1, "stall-start", "준비가 됐으면 '영업 시작'을 누르게!", "start");
say("stall_open", 1, "", "수프가 없군. 주방에서 수프부터 만들어 오게.", "short");
say("stall_open", 1, "stall-open", "이번 영업은 수프 없이 열었군. 영업을 마치고 수프를 올려서 다시 열어 보게.", "other");
// 5. 첫 손님
mission("wait_sale", 1, "stall-open", "손님은 틈틈이 가게를 둘러본다네. 잠깐만 기다려 보게.");
say("sale_done", 1, "", "팔렸군! 이게 자네의 첫 장사 수입이고, 평판도 조금 올랐을 걸세.");
// 6. 첫 주문 손님
say("order_info", 1, "stall-order", "저런, 주문 손님이 오셨군! 모호한 말을 잘 해석해서 응대하게.");
say("order_info", 2, "stall-order", "'있는 요리 내주기'는 만들어 둔 요리를 안전하게 내는 길일세. '맞춤 요리'는 그 자리에서 새로 만들어 큰 보상을 노리지만, 틀리면 재료만 날린다네.");
mission("order_serve", 1, "stall-order", "자, 어느 쪽이든 응대해 보게.");
mission("order_serve", 1, "kitchen-finish", "재료를 골라 '손님에게 내기'를 눌러 보게.", "kitchen");
say("order_done", 1, "", "잘했네! 손님 마음을 읽는 건 경험이 쌓일수록 쉬워진다네.");
// 7. 마무리
say("finale", 1, "floors-map", "지금 자네 가게는 {floor}층일세. 평판이 {nextRep}쯤 쌓이면 {nextFloor}층으로 오르는 승급 시험을 볼 수 있다네.");
say("finale", 2, "floors-map", "깊은 층일수록 손님도 재료도 값어치가 커지니, 이제부터는 자네 뜻대로 해 보게. 건투를 비네!");
// 길 안내: 이 단계의 화면이 아닌 곳에 있을 때
say("intro", 1, "tab-HOME", "먼저 '홈'으로 돌아오게. 자네 가게 앞에서 이야기하세.", "nav");
say("home", 1, "tab-HOME", "먼저 '홈'으로 돌아오게. 자네 가게 앞에서 이야기하세.", "nav");
say("market_info", 1, "tab-MKT", "먼저 재료 시장으로 가 보게. 강조된 '시장'을 누르면 된다네.", "nav");
say("market_buy", 1, "tab-MKT", "'시장'으로 가서 던전 버섯과 소금을 사 오게.", "nav");
say("kitchen_cook", 1, "tab-KIT", "좋네! 이제 '주방'으로 가서 수프를 끓여 보게.", "nav");
say("kitchen_done", 1, "tab-KIT", "'주방'으로 돌아가 보게. 자네 첫 수프가 기다리고 있다네.", "nav");
say("stall_open", 1, "tab-STL", "수프가 준비됐군. '포장마차'로 가서 영업을 열어 보세.", "nav");
say("wait_sale", 1, "tab-STL", "'포장마차'로 가서 첫 손님을 기다려 보게.", "nav");
say("sale_done", 1, "tab-STL", "'포장마차'로 돌아가 보게. 손님이 다녀갔다네.", "nav");
say("order_info", 1, "tab-STL", "'포장마차'로 가 보게. 주문 손님이 와 있다네.", "nav");
say("order_serve", 1, "tab-STL", "'포장마차'로 가 보게. 주문 손님이 기다리고 있다네.", "nav");
say("finale", 1, "hud-floor", "위쪽의 층 표시를 눌러 던전 층 지도를 보게. 다음 목표가 거기 있다네.", "nav");

export const TUTORIAL_LINES: readonly TutorialLine[] = L;

// ───── 상황별 한 줄 팁 (처음 한 번만, 유저별 저장) ─────
// 조건은 코드(src/db/queries/tutorial.ts)가 판단한다: rare_ingredient(희귀·전설 재료 보유), toxin_4(주방 독성 4 이상),
// locked_zone(주방에서 잠긴 구역이 보임), exam_waiting(승급 시험 손님 대기), sold_out(영업 중 품절), first_request(첫 의뢰 등록), first_review(첫 평론가의 평이 발행됨).
export const TUTORIAL_TIPS: readonly { code: string; sort: number; text: string }[] = [
  { code: "rare_ingredient", sort: 1, text: "오, 희귀 재료로군! 맛 지도에서 표식을 크게 움직이니 신중히 쓰게." },
  { code: "toxin_4", sort: 2, text: "독성이 4를 넘었군. 6이 되면 완성할 수 없으니 물이나 끓이기로 낮추게." },
  { code: "locked_zone", sort: 3, text: "윤곽만 보이는 구역은 더 깊은 층을 열어야 쓸 수 있다네." },
  { code: "exam_waiting", sort: 4, text: "조합 감독관이 시험을 보러 왔군. 맞춤 요리로만 응대할 수 있으니 차분히 준비하게." },
  { code: "sold_out", sort: 5, text: "진열이 텅 비었군. 창고에서 새 요리를 올리면 영업을 이어 갈 수 있다네." },
  { code: "first_request", sort: 6, text: "첫 의뢰를 붙였군! 모험가가 돌아오면 의뢰 게시판에서 결과를 받게." },
  { code: "first_review", sort: 7, text: "가면 미식가의 평이 가이드북에 실렸군! 별이 붙어 있는 동안은 손님이 조금 더 찾아온다네." },
];

// ───── 도움말 (조합장의 도움말, /help) ─────
export const HELP_TOPICS: readonly { code: string; sort: number; title: string; body: string }[] = [
  {
    code: "market", sort: 1, title: "재료 시장과 행상",
    body: "기본 식재료는 언제든 같은 값에 살 수 있다네. 행상은 시간마다 두 명이 찾아와 귀한 재료를 파는데, 깊은 층에서 온 행상일수록 귀한 물건을 가져오지. 가져온 수량은 한정이니 눈여겨보게.",
  },
  {
    code: "taste_map", sort: 2, title: "맛 지도 보는 법",
    body: "맛 지도는 가로가 단맛과 열기, 세로가 마력과 감칠맛일세. 재료를 넣으면 표식이 움직이고, 요리 구역 안에서만 완성할 수 있다네. 구역 한가운데에 가까울수록 별이 늘어나지.",
  },
  {
    code: "methods", sort: 3, title: "조리법",
    body: "굽기는 열기와 감칠맛을 올리고, 끓이기는 표식을 지도 한가운데로 당기며 독성을 낮춘다네. 튀기기는 감칠맛을 크게 올리지만 독성이 조금 붙고, 절이기는 단맛과 마력을 더하는 대신 숙성 시간이 걸리지. 조리법은 재료를 하나 넣은 뒤에 쓸 수 있고, 종류와 관계없이 요리 하나에 세 번까지라네 (냄비 옆 불 세 칸이 그 표시일세). 1층 고니 할멈에게 도구를 강화해 가면 같은 조리법을 두 번 쓰거나 세기를 고를 수 있게 되지.",
  },
  {
    code: "toxin", sort: 4, title: "독성",
    body: "독성은 재료마다 쌓이다가 6이 되면 요리를 완성할 수 없다네. 물을 넣거나 끓이면 내려가지. 독을 좋아하는 손님도 있으니 쓸모없는 건 아니라네.",
  },
  {
    code: "stall", sort: 5, title: "포장마차와 기준가",
    body: "진열 칸은 네 개고, 가격은 기준가의 절반에서 두 배까지 정할 수 있다네. 영업 중에는 팔리는 중인 요리의 가격을 바꿀 수 없고, 다 팔린 빈 칸에는 새 요리를 올릴 수 있네. 영업을 마치면 남은 요리는 창고로 돌아온다네.",
  },
  {
    code: "orders", sort: 6, title: "주문 손님",
    body: "영업 중에 주문 손님이 찾아와 모호한 말로 요리를 청한다네. '조금 더 물어보기'로 힌트를 얻을 수 있지만 기다리는 시간이 줄어들지. 내주기는 안전하고, 맞춤 요리는 위험하지만 보상이 크다네.",
  },
  {
    code: "floors", sort: 7, title: "층과 승급 시험",
    body: "평판이 쌓이면 다음 층의 감독관이 시험을 내러 온다네. 맞춤 요리로 '성공' 이상을 내면 통과하고, 떨어져도 평판은 깎이지 않으니 다음 기회를 기다리게. 더 깊은 층으로는 이전 비용을 내야 하고, 위층으로 돌아오는 건 공짜일세.",
  },
];
