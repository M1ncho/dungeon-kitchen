// 의뢰 게시판(Phase 4) 마스터 데이터. 시드(code 기준 upsert)와 단위 테스트에서 공유한다. DB 의존 없음.
//
// ▼ 체감 조정은 이 파일의 숫자·대사를 고치고 `npm run db:seed` 를 다시 실행하면 된다 (production 에도 따로 반영).
//   소요 시간은 층 값(seed-data/floors.ts 의 durationSeconds, 재료의 해금 층 기준)을 쓴다.
//   개발·테스트에서만 환경 변수 REQUEST_TIME_SCALE(예: 1800 → 30분이 1초)로 줄일 수 있다 (production 에서는 설정하지 않는다).

export const REQUEST_SETTINGS = {
  maxActive: 2, // 동시에 붙여 둘 수 있는 의뢰 (수령 전 포함)
  maxQuantity: 5, // 수량 1~5
  priceMinPct: 50, // 의뢰금 범위: 시세(기준 가격 × 수량)의 50% ~ 300%
  priceMaxPct: 300,
  // 성공 확률 = 1 − oddsBase^(유효비율^oddsExponent). 기본 재료층 일반 재료 기준 의뢰금이 시세와 같으면 60%, 시세의 2배면 약 85%
  oddsBase: 0.4,
  oddsExponent: 1.05,
  rareDifficulty: 1.5, // 희귀 재료는 유효비율을 1.5배 까다롭게
  legendaryDifficulty: 2.5,
  floorDifficultyStep: 0.15, // 재료 해금 층이 한 층 깊어질 때마다 난이도 +15%
  partialShare: 0.6, // 성공하지 못한 나머지 중 60% 는 일부 성공(절반, 올림), 40% 는 실패
  refundRate: 0.5, // 실패하면 의뢰금의 50% 환불
} as const;

export type RequestText = { code: string; outcome: "success" | "partial" | "fail"; speaker: string; text: string };

// 모험가 한마디 (결과 카드). {item} = 재료 이름, {n} = 가져온 수량. 같은 의뢰는 같은 대사가 나온다.
const T: RequestText[] = [];
const add = (outcome: RequestText["outcome"], speaker: string, text: string) =>
  T.push({ code: `${outcome}.${T.filter((t) => t.outcome === outcome).length}`, outcome, speaker, text });

add("success", "수습 모험가 단", "부탁하신 {item}, 전부 챙겨 왔어요! 가방이 터지는 줄 알았다니까요.");
add("success", "베테랑 레나", "{item} {n}개, 약속대로 가져왔네. 다음에도 맡겨 주게.");
add("success", "도적 미로", "헤헤, 어려울 줄 알았는데 {item}이 줄줄이 나오던걸! 여기 {n}개야.");
add("success", "광부 도르칸", "{item}? 그거라면 눈 감고도 캐지. 자, {n}개 받으시게.");
add("success", "사냥꾼 하이", "운이 좋았소. 의뢰한 {item}, 빠짐없이 가져왔소.");

add("partial", "수습 모험가 단", "죄송해요… {item}이 생각보다 귀했어요. {n}개밖에 못 구했어요.");
add("partial", "베테랑 레나", "몬스터를 만나 반쯤은 놓쳤네. {item} {n}개라도 받아 주게.");
add("partial", "도적 미로", "아슬아슬했어! 다 못 가져왔지만 {item} {n}개는 챙겼다고.");
add("partial", "광부 도르칸", "곡괭이가 부러져서 말이야. {item}은 {n}개가 한계였네.");
add("partial", "사냥꾼 하이", "절반만 얻었소. 대신 {item}은 상태가 좋소.");

add("fail", "수습 모험가 단", "정말 죄송해요… {item}을 찾지 못했어요. 의뢰금은 반만 돌려드릴게요.");
add("fail", "베테랑 레나", "이번엔 허탕이었네. {item}은 구경도 못 했어. 의뢰금 절반은 돌려주지.");
add("fail", "도적 미로", "으악, 쫓겨 다니다 빈손이야! 미안, 의뢰금 반이라도 받아 줘.");
add("fail", "광부 도르칸", "{item}이 있던 갱도가 무너졌지 뭔가. 다음에 다시 부탁하시게.");
add("fail", "사냥꾼 하이", "놓쳤소. 면목 없지만 의뢰금 일부를 돌려드리겠소.");

export const REQUEST_TEXTS: readonly RequestText[] = T;
