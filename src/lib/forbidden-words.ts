// 가이드북에 공개되는 가게 이름·닉네임의 금지어 필터. DB 의존 없음 (등록 검증과 화면 표시 양쪽에서 쓴다).
//
// 비교 전에 공백·기호·숫자·제로폭 문자를 지우고 소문자로 바꿔서, 띄어쓰기나 기호로 숨긴 금지어도 잡는다.
// 일반 단어를 막지 않도록 짧고 흔한 말(예: "새끼", "씹")은 넣지 않는다. 목록은 이 파일에서 관리한다.

const FORBIDDEN = [
  // 욕설
  "씨발", "시발", "씨빨", "시빨", "ㅅㅂ", "ㅆㅂ", "병신", "ㅂㅅ", "개새끼", "개새기", "개색", "지랄", "ㅈㄹ", "좆", "존나", "ㅈㄴ", "씹새", "씹창", "씹할",
  "니미", "느금", "엠창", "애미", "애비없", "엿먹", "닥쳐",
  // 성적인 표현
  "섹스", "야동", "창녀", "걸레년", "딸딸이", "강간", "성폭행",
  // 차별·혐오 표현
  "짱깨", "쪽바리", "틀딱", "한남충", "김치녀", "된장녀", "맘충", "장애인새", "씹덕",
  // 외국어
  "fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "porn", "dick", "pussy",
];

/** 공백·기호·숫자·제로폭 문자를 지우고 소문자로 바꾼다. */
export function normalizeForFilter(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/[0-9!-/:-@[-`{-~·•…_]/g, "");
}

// 목록도 같은 방식으로 정규화해 둔다 (NFKC 가 호환 자모를 바꾸므로 비교 양쪽이 같은 형태여야 한다)
const WORDS = FORBIDDEN.map(normalizeForFilter);

export function containsForbidden(raw: string): boolean {
  const n = normalizeForFilter(raw);
  return n.length > 0 && WORDS.some((w) => n.includes(w));
}

/** 공개 화면에 쓸 이름: 금지어가 들어 있으면 대체 문구를 쓴다. */
export function publicName(raw: string, fallback: string): string {
  return containsForbidden(raw) ? fallback : raw;
}

export const FALLBACK_SHOP_NAME = "이름 없는 가게";
export const FALLBACK_NICKNAME = "익명의 요리사";
