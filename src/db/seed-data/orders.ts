// 주문 손님(Phase 3.5) 마스터 데이터. 시드(code 기준 upsert)와 단위 테스트에서 공유한다. DB 의존 없음.
//
// ▼ 체감 조정은 이 파일의 숫자·문장을 고치고 `npm run db:seed` 를 다시 실행하면 된다.
//   목표 좌표·판정 범위는 응대가 끝날 때까지 클라이언트로 나가지 않는다 (src/db/commands/orders.ts).

export const ORDER_SETTINGS = {
  maxWaiting: 1, // 동시에 대기하는 주문 손님 수
  waitSeconds: 30 * 60, // 대기 시간 (실제 시간). 넘기면 말없이 떠난다 (벌칙 없음)
  hintPenaltySeconds: 5 * 60, // "조금 더 물어보기" 로 깎이는 대기 시간
  toxCapMin: 1, // 독성 상한 (이 값을 넘는 독성의 요리는 맞춤 주문 실패) 의 범위
  toxCapMax: 5,
  toxStrictMax: 1, // 상한이 이 값 이하면 "독은 절대 안 돼" 표현
  toxLowMax: 3, // 상한이 이 값 이하면 "너무 독한 건 싫고" 표현 (초과면 독성 언급 없음)
  minMagnitude: 15, // 문장에 담는 방향의 최소 크기 (축 값의 절댓값이 이보다 작으면 언급 안 함)
  intensitySome: 35, // |값| < 이 값: "살짝", < intensityVery: "좀", 그 이상: "아주"
  intensityVery: 65,
  // 맞춤 요리 판정: 목표까지 거리 기준 (맛 지도 좌표, 범위 ±100)
  customGreatMax: 12, // 이하면 대성공
  customGoodMax: 25, // 이하면 성공
  customOkMax: 40, // 이하면 아쉬움, 넘으면 실패 (독성 상한 초과도 실패)
  multGreat: 3, // 맞춤 요리 기준가 배율
  multGood: 2,
  multOk: 1,
  repGreat: 3, // 평판 변화
  repGood: 1,
  repOk: 0,
  repFail: -2,
  // 있는 요리 내주기: 요리의 완성 좌표와 목표의 거리 기준
  servedCloseMax: 25, // 이하면 가깝다: 기준가 1.2배 + 평판 +1
  servedNormalMax: 45, // 이하면 보통 1.0배, 넘으면 멀다 0.7배 (평판 감소 없음)
  servedMultClose: 1.2,
  servedMultNormal: 1.0,
  servedMultFar: 0.7,
  servedRepClose: 1,
} as const;

// minFloor: 가게가 이 층 이상일 때만 쓰는 영역 (낮은 층 재료로는 닿지 않는 목표가 나오지 않게)
type Region = { cx: number; cy: number; r: number; w: number; minFloor?: number };

// 손님 유형별 주문 프로필: 말투(style), 맞춤 요리 기준가(G), "자주 원하는 영역"(원, 가중치).
// 목표 좌표는 이 영역들에서 시드로 뽑는다 (등장 확률은 층별 설정: seed-data/floors.ts).
// 각 영역이 해당 층의 재료로 닿을 수 있는지는 orders.test.ts 가 확인한다.
// 감독관(inspector_f*)은 승급 시험용: 시험을 보는 시점(이전 층까지 해금)의 재료로 닿는 영역이다.
export const CUSTOMER_ORDER_PROFILES: Record<string, { style: string; customBasePrice: number; regions: Region[] }> = {
  human_warrior: { style: "warrior", customBasePrice: 36, regions: [{ cx: 45, cy: 30, r: 18, w: 3 }, { cx: 55, cy: 10, r: 16, w: 2, minFloor: 3 }] },
  elf_mage: { style: "mage", customBasePrice: 60, regions: [{ cx: -28, cy: -6, r: 14, w: 3 }, { cx: -40, cy: -25, r: 16, w: 2, minFloor: 2 }, { cx: -10, cy: -50, r: 18, w: 2, minFloor: 3 }] },
  dwarf_miner: { style: "dwarf", customBasePrice: 30, regions: [{ cx: 30, cy: 35, r: 18, w: 2 }, { cx: 0, cy: 40, r: 14, w: 2 }] },
  halfling_thief: { style: "thief", customBasePrice: 30, regions: [{ cx: -40, cy: 5, r: 16, w: 3 }, { cx: -30, cy: -20, r: 14, w: 1, minFloor: 2 }] },
  orc_berserker: { style: "orc", customBasePrice: 42, regions: [{ cx: 40, cy: 32, r: 14, w: 3 }, { cx: 65, cy: 10, r: 16, w: 3, minFloor: 3 }, { cx: 40, cy: -20, r: 16, w: 1, minFloor: 3 }] },
  beast_hunter: { style: "hunter", customBasePrice: 40, regions: [{ cx: 20, cy: 45, r: 16, w: 3 }, { cx: 40, cy: 30, r: 14, w: 1 }] },
  // 성장 1단계: 새 손님 유형
  elf_herbalist: { style: "herbalist", customBasePrice: 40, regions: [{ cx: -42, cy: -22, r: 16, w: 3, minFloor: 2 }, { cx: -10, cy: 58, r: 14, w: 2 }] },
  gnome_forager: { style: "forager", customBasePrice: 36, regions: [{ cx: -8, cy: 60, r: 14, w: 3 }, { cx: 0, cy: 32, r: 14, w: 2 }] },
  flame_mercenary: { style: "mercenary", customBasePrice: 54, regions: [{ cx: 60, cy: 12, r: 16, w: 3 }, { cx: 80, cy: -18, r: 14, w: 2 }, { cx: 36, cy: 38, r: 14, w: 1 }] },
  frost_witch: { style: "witch", customBasePrice: 70, regions: [{ cx: -26, cy: -55, r: 16, w: 3 }, { cx: 58, cy: -58, r: 14, w: 2 }, { cx: -44, cy: -26, r: 14, w: 1 }] },
  moon_sage: { style: "sage", customBasePrice: 90, regions: [{ cx: 6, cy: -82, r: 14, w: 3 }, { cx: -26, cy: -58, r: 14, w: 2 }] },
  dragon_envoy: { style: "envoy", customBasePrice: 100, regions: [{ cx: 80, cy: -18, r: 14, w: 2 }, { cx: 58, cy: -58, r: 14, w: 2 }, { cx: 6, cy: -82, r: 12, w: 2 }] },
  // 층 시험 감독관 (층마다 1명). 맞춤 기준가는 시험 통과 보상 골드의 기준이다.
  inspector_f2: { style: "inspector2", customBasePrice: 60, regions: [{ cx: -22, cy: 30, r: 14, w: 1 }] },
  inspector_f3: { style: "inspector3", customBasePrice: 90, regions: [{ cx: 35, cy: 25, r: 14, w: 1 }] },
  inspector_f4: { style: "inspector4", customBasePrice: 130, regions: [{ cx: -32, cy: -18, r: 14, w: 1 }] },
  inspector_f5: { style: "inspector5", customBasePrice: 200, regions: [{ cx: -12, cy: -78, r: 14, w: 1 }] },
};

// 문장 사전. kind 별 의미:
//  direction  key = heat|sweet|umami|mana        방향 표현 (공통, style 없음)
//  intensity  key = slight|some|very             강도 표현 (공통)
//  toxin      key = strict|low                   독성 조건 표현 (style 별로 다를 수 있음, 없으면 plain)
//  connector  key = join, style 별: 두 방향 사이에 들어가는 말 (구두점·공백 포함)
//  template   style 별 여러 개: {taste} = 맛 설명, {tox} = 독성 문장(없으면 빈칸)
//  hint       key = heat|sweet|umami|mana|center|lowtox   힌트 (공통)
//  reaction   key = great|good|ok|fail|close|normal|far   응대 후 손님 한마디 (style 별, 없으면 plain)
export type OrderText = { code: string; kind: string; key: string; style: string; text: string };

const T: OrderText[] = [];
const add = (kind: string, key: string, style: string, text: string) =>
  T.push({ code: `${kind}.${style || "common"}.${key}.${T.filter((t) => t.kind === kind && t.key === key && t.style === style).length}`, kind, key, style, text });

// 공통
add("direction", "heat", "", "맵고 뜨끈한");
add("direction", "sweet", "", "달달한");
add("direction", "umami", "", "진하고 깊은");
add("direction", "mana", "", "신비롭고 찌릿한");
add("intensity", "slight", "", "살짝");
add("intensity", "some", "", "좀");
add("intensity", "very", "", "아주");

add("hint", "heat", "", "불을 쓰는 쪽이 좋겠어. 굽거나 열기 있는 재료를 넣으면 가까워질 거야.");
add("hint", "sweet", "", "달콤한 재료를 중심으로 하면 좋겠어. 절이면 단맛이 더 배어들지.");
add("hint", "umami", "", "버섯이나 고기처럼 감칠맛이 강한 재료가 어울릴 거야. 튀기면 더 깊어지고.");
add("hint", "mana", "", "마력이 서린 재료, 수정이나 열매 같은 것이 어울릴 거야.");
add("hint", "center", "", "너무 세지 않은 게 좋아. 물을 넣어 맛을 풀어 보는 것도 방법이야.");
add("hint", "lowtox", "", "독이 걱정되면 끓여서 독을 빼는 방법도 있어.");

// 기본(plain): 말투가 정해지지 않은 손님
add("toxin", "strict", "plain", "독은 절대 안 돼요.");
add("toxin", "low", "plain", "너무 독한 건 싫고요.");
add("connector", "join", "plain", ", 게다가 ");
add("template", "0", "plain", "{taste} 요리를 부탁해요.{tox}");
add("template", "1", "plain", "{taste} 맛이면 좋겠어요.{tox}");
for (const [k, t] of [["great", "정말 딱 제가 원하던 맛이에요!"], ["good", "맛있네요, 좋아요."], ["ok", "나쁘진 않은데… 조금 아쉽네요."], ["fail", "이건 좀… 제가 말한 게 아니에요."],
  ["close", "오, 마침 비슷한 게 있었네요. 고마워요."], ["normal", "음, 이 정도면 괜찮아요."], ["far", "음… 생각한 맛과는 많이 다르지만 먹을게요."]] as const) add("reaction", k, "plain", t);

// 인간 전사: 씩씩하고 직설적
add("toxin", "strict", "warrior", "독 든 건 사양이다!");
add("toxin", "low", "warrior", "독한 건 곤란하다.");
add("connector", "join", "warrior", ", 게다가 ");
add("template", "0", "warrior", "{taste} 요리를 내주게!{tox}");
add("template", "1", "warrior", "오늘은 {taste} 게 땡기는군.{tox}");
for (const [k, t] of [["great", "이거다! 바로 이 맛이야!"], ["good", "좋군, 힘이 나겠어."], ["ok", "먹을 만은 하군."], ["fail", "이건 아니지 않나…"],
  ["close", "마침 있었군, 고맙네!"], ["normal", "음, 이거면 됐네."], ["far", "생각했던 건 아니지만… 먹지."]] as const) add("reaction", k, "warrior", t);

// 엘프 마법사: 우아하고 약간 거만
add("toxin", "strict", "mage", "독기는 질색이랍니다.");
add("toxin", "low", "mage", "독이 강한 건 곤란해요.");
add("connector", "join", "mage", ", 그리고 ");
add("template", "0", "mage", "{taste} 기운이 감도는 요리를 원해요.{tox}");
add("template", "1", "mage", "오늘은 {taste} 풍미가 필요하군요.{tox}");
for (const [k, t] of [["great", "놀랍네요. 제 마음을 읽은 듯한 맛이에요."], ["good", "흠, 훌륭해요."], ["ok", "나쁘지 않지만 조금 부족하군요."], ["fail", "이건… 제가 원한 것과 전혀 다르군요."],
  ["close", "마침 어울리는 요리가 있었네요."], ["normal", "그럭저럭 괜찮군요."], ["far", "취향과는 거리가 멀지만, 받아 두죠."]] as const) add("reaction", k, "mage", t);

// 드워프 광부: 반말에 투박
add("toxin", "strict", "dwarf", "독은 안 돼, 독은.");
add("toxin", "low", "dwarf", "너무 독한 건 싫다고.");
add("connector", "join", "dwarf", ", 거기다 ");
add("template", "0", "dwarf", "어이, {taste} 걸로 하나 줘봐.{tox}");
add("template", "1", "dwarf", "{taste} 거 있나? 없으면 만들어 오고.{tox}");
for (const [k, t] of [["great", "크하! 바로 이 맛이다!"], ["good", "좋아, 아주 좋아."], ["ok", "뭐, 배는 채우겠군."], ["fail", "이게 뭐야! 이런 걸 먹으라고?"],
  ["close", "오, 이거 괜찮은데? 잘 먹겠어."], ["normal", "그럭저럭이군."], ["far", "내가 원한 건 아니지만… 먹어주지."]] as const) add("reaction", k, "dwarf", t);

// 하플링 도적: 장난스럽고 가벼움
add("toxin", "strict", "thief", "독은 노노, 절대로!");
add("toxin", "low", "thief", "독 강한 건 빼 줘~");
add("connector", "join", "thief", ", 게다가 ");
add("template", "0", "thief", "헤헤, {taste} 요리 하나 부탁해~{tox}");
add("template", "1", "thief", "오늘은 {taste} 게 끌리네!{tox}");
for (const [k, t] of [["great", "대박! 완전 내 취향이야!"], ["good", "오, 맛있다!"], ["ok", "음~ 나쁘진 않은데 살짝 아쉬워."], ["fail", "으엑, 이건 아니잖아~"],
  ["close", "앗 마침 있었네, 땡큐~"], ["normal", "응, 이 정도면 오케이!"], ["far", "내 취향은 아니지만 먹어줄게~"]] as const) add("reaction", k, "thief", t);

// 오크 광전사: 거칠고 짧음
add("toxin", "strict", "orc", "독은 안 먹는다.");
add("toxin", "low", "orc", "너무 독한 건 싫다.");
add("connector", "join", "orc", ", 그리고 ");
add("template", "0", "orc", "{taste} 거. 빨리.{tox}");
add("template", "1", "orc", "내놔라. {taste} 요리.{tox}");
for (const [k, t] of [["great", "으하하! 최고다!"], ["good", "좋다."], ["ok", "먹을 만하다."], ["fail", "이딴 걸 먹으라고?!"],
  ["close", "오, 이거다. 받겠다."], ["normal", "음, 괜찮다."], ["far", "맘에 안 들지만… 먹겠다."]] as const) add("reaction", k, "orc", t);

// 수인 사냥꾼: 차분하고 간결
add("toxin", "strict", "hunter", "독은 피하고 싶군.");
add("toxin", "low", "hunter", "독이 센 건 피하고 싶군.");
add("connector", "join", "hunter", ", 그리고 ");
add("template", "0", "hunter", "{taste} 요리가 필요하다.{tox}");
add("template", "1", "hunter", "오늘은 {taste} 맛으로 부탁하지.{tox}");
for (const [k, t] of [["great", "훌륭하다. 정확히 원하던 맛이다."], ["good", "좋군."], ["ok", "나쁘지 않군."], ["fail", "이건 내가 원한 게 아니야."],
  ["close", "마침 알맞은 게 있었군."], ["normal", "그럭저럭이군."], ["far", "기대와는 다르지만 먹도록 하지."]] as const) add("reaction", k, "hunter", t);

// ── 성장 1단계: 새 말투 (새 손님 6종 + 층 시험 감독관 4명) ──
const STYLES: Record<string, { strict: string; low: string; connector: string; templates: [string, string]; reactions: [string, string, string, string, string, string, string] }> = {
  // 반응 순서: great, good, ok, fail, close, normal, far
  herbalist: { strict: "독이 든 건 곤란하답니다.", low: "독기가 너무 센 건 조금 걱정이에요.", connector: ", 그리고 ", templates: ["{taste} 요리가 있으면 좋겠어요.{tox}", "오늘은 {taste} 맛이 당기네요.{tox}"],
    reactions: ["어머, 정말 제가 바라던 맛이에요.", "정성이 느껴지는 맛이에요.", "나쁘지 않은데, 조금만 더 다듬어 주세요.", "음… 이건 제 입맛과는 많이 달라요.", "마침 어울리는 게 있었네요, 고마워요.", "무난하게 먹을 만해요.", "생각했던 맛은 아니지만 감사히 먹을게요."] },
  forager: { strict: "독 있는 건 안 돼요, 절대 안 돼요!", low: "너무 독한 건 빼 주세요!", connector: ", 게다가 ", templates: ["와, {taste} 요리 있어요? 있죠? 부탁해요!{tox}", "{taste} 걸로 부탁해요! 기대돼요!{tox}"],
    reactions: ["우와아! 대박이에요! 이거예요, 이 맛!", "맛있어요! 정말 맛있어요!", "음, 괜찮긴 한데 조금 아쉬워요~", "으앗, 이건 제가 말한 게 아닌데요…!", "앗, 딱 맞는 게 있었네요! 감사해요!", "네, 이 정도면 좋아요!", "생각이랑 다르지만… 일단 먹어 볼게요!"] },
  mercenary: { strict: "독은 빼.", low: "독이 센 건 싫다.", connector: ", 그리고 ", templates: ["{taste} 거 내놔.{tox}", "배고프다. {taste} 요리.{tox}"],
    reactions: ["좋군. 아주 좋아.", "먹을 만하군.", "나쁘진 않군.", "이게 뭐야, 장난하나.", "마침 있었군. 받지.", "그럭저럭이군.", "내 취향은 아니지만 먹지."] },
  witch: { strict: "독은 사양하겠어요, 취향이 아니라서.", low: "독이 센 건… 곤란하지 않을까요?", connector: ", 거기에 ", templates: ["{taste} 요리를 가져와 보세요, 기대는 하지 않겠지만.{tox}", "흐음, {taste} 맛이면 한 입 정도는 먹어 드리죠.{tox}"],
    reactions: ["…인정하죠. 훌륭해요.", "나쁘지 않군요. 꽤 좋아요.", "평범하네요. 조금 아쉽군요.", "이걸 요리라고 내놓으신 건가요?", "어머, 마침 그럴듯한 게 있었군요.", "그럭저럭 먹을 만하네요.", "취향과는 멀지만, 버리긴 아깝네요."] },
  sage: { strict: "독은… 마음을 흐리니 멀리해 주시게.", low: "독이 짙은 것은… 조금 피하고 싶구려.", connector: "… 그리고 ", templates: ["{taste} 기운이 감도는 요리를… 부탁하네.{tox}", "오늘은 {taste} 맛이 그립구려.{tox}"],
    reactions: ["오… 이 맛이야말로 샘물의 노래로다.", "깊고 맑은 맛이로군.", "아직… 조금 부족하구려.", "허허, 이것은 내가 청한 맛이 아니로다.", "마침 어울리는 요리가 있었구려. 고맙네.", "무난하구려.", "내 청과는 멀지만… 받겠네."] },
  envoy: { strict: "독은 용납할 수 없다.", low: "독이 강한 것은 허용하지 않겠다.", connector: ", 그리고 ", templates: ["{taste} 요리를 올려라.{tox}", "이 몸은 {taste} 맛을 원한다.{tox}"],
    reactions: ["훌륭하다. 고룡께 아뢸 만하다.", "흡족하다.", "부족하다. 다음에는 더 정진하라.", "무례하군. 이것이 우리의 청이었더냐.", "마침 갖추고 있었군. 칭찬하마.", "나쁘지 않다.", "마음에 들지 않으나, 받아 두겠다."] },
  inspector2: { strict: "독성은 일절 허용되지 않소.", low: "독성이 높은 것은 감점 대상이오.", connector: ", 또한 ", templates: ["승급 심사요. {taste} 요리를 내시오.{tox}", "자, 시험이오. {taste} 맛을 구현해 보시오.{tox}"],
    reactions: ["훌륭하오. 합격이오.", "합격이오. 수고했소.", "아쉽소. 아직 기준에 이르지 못했소.", "불합격이오. 다시 도전하시오.", "", "", ""] },
  inspector3: { strict: "독은 안 된다!", low: "독이 세면 감점이다!", connector: ", 그리고 ", templates: ["시험이다! {taste} 요리를 내놔라!{tox}", "정신 차리고 {taste} 맛을 만들어 봐라!{tox}"],
    reactions: ["좋다! 합격이다!", "합격이다. 나쁘지 않군!", "아직 멀었다! 다시 해 와라!", "이게 요리냐! 불합격이다!", "", "", ""] },
  inspector4: { strict: "독성은 0에 가까워야 합니다.", low: "독성은 가급적 낮게 유지하세요.", connector: ", 더불어 ", templates: ["평가를 시작합니다. {taste} 요리를 제출하십시오.{tox}", "기준 맛: {taste}. 제출하십시오.{tox}"],
    reactions: ["정확합니다. 합격입니다.", "기준을 충족했습니다. 합격입니다.", "기준에 약간 미달입니다.", "기준에 크게 미달입니다. 불합격입니다.", "", "", ""] },
  inspector5: { strict: "독은 허락되지 않네.", low: "독이 짙은 것은 삼가게.", connector: "… 그리고 ", templates: ["마지막 시험이네. {taste} 요리를… 내어 보게.{tox}", "{taste} 맛의 정수를… 보여 주게.{tox}"],
    reactions: ["경이롭군… 합격일세.", "충분하네. 합격일세.", "한 걸음이 모자라네.", "아직 이르구먼. 다시 오게.", "", "", ""] },
};
const GRADES = ["great", "good", "ok", "fail", "close", "normal", "far"] as const;
for (const [style, d] of Object.entries(STYLES)) {
  add("toxin", "strict", style, d.strict);
  add("toxin", "low", style, d.low);
  add("connector", "join", style, d.connector);
  d.templates.forEach((t, i) => T.push({ code: `template.${style}.${i}`, kind: "template", key: String(i), style, text: t }));
  GRADES.forEach((g, i) => { if (d.reactions[i]) add("reaction", g, style, d.reactions[i]); });
}

export const ORDER_TEXTS: OrderText[] = T;
