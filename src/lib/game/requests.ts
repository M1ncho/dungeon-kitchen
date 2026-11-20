// 의뢰 게시판(Phase 4) 순수 로직. DB·시간·전역 난수에 의존하지 않는다.
// 클라이언트(등록 화면의 확률 막대)와 서버(등록·수령)가 같은 함수를 쓴다.
// 결과를 정하는 난수(rollOutcome)는 서버 전용 모듈 request-roll.ts 에 따로 둔다 (클라이언트 번들에 섞이지 않게).

export type RequestRarity = "common" | "rare" | "legendary";
export type RequestOutcome = "success" | "partial" | "fail";

/** 설정값 (DB request_settings, 시드 src/db/seed-data/requests.ts). */
export type RequestConfig = {
  maxActive: number; // 동시에 붙여 둘 수 있는 의뢰(수령 전 포함)
  maxQuantity: number; // 의뢰 수량 상한 (하한은 1)
  priceMinPct: number; // 의뢰금 범위 (시세 대비 %)
  priceMaxPct: number;
  oddsBase: number; // 성공 곡선: 성공 = 1 − oddsBase^(유효비율^oddsExponent). 기본 재료층 일반 재료는 비율 1 → 60%, 비율 2 → 약 85%
  oddsExponent: number;
  rareDifficulty: number; // 재료 등급 난이도 (유효비율 = 비율 ÷ 난이도)
  legendaryDifficulty: number;
  floorDifficultyStep: number; // 재료의 해금 층이 한 층 깊어질 때마다 난이도 + 이 값
  partialShare: number; // 성공하지 못한 나머지 중 일부 성공이 되는 몫 (나머지는 실패)
  refundRate: number; // 실패했을 때 의뢰금 환불 비율
};

/** 확률은 1/10000 단위 정수이고 세 값의 합은 항상 10000 이다. */
export type RequestOdds = { successBp: number; partialBp: number; failBp: number };

export const BP = 10000;

/** 재료 시세 = 기준 가격 × 수량. */
export const marketValue = (basePrice: number, quantity: number) => basePrice * quantity;

/** 의뢰금 허용 범위 (시세 대비 %). 최소 1G. */
export function rewardRange(value: number, cfg: Pick<RequestConfig, "priceMinPct" | "priceMaxPct">): { min: number; max: number } {
  const min = Math.max(1, Math.ceil((value * cfg.priceMinPct) / 100));
  const max = Math.max(min, Math.floor((value * cfg.priceMaxPct) / 100));
  return { min, max };
}

/** 재료 난이도: 등급 배율 × (1 + 층 보정). 1 이 "기본 재료층 일반 재료". */
export function difficultyOf(rarity: RequestRarity, floorNo: number, cfg: Pick<RequestConfig, "rareDifficulty" | "legendaryDifficulty" | "floorDifficultyStep">): number {
  const rarityMult = rarity === "legendary" ? cfg.legendaryDifficulty : rarity === "rare" ? cfg.rareDifficulty : 1;
  return rarityMult * (1 + cfg.floorDifficultyStep * Math.max(0, floorNo - 1));
}

/**
 * 결과 확률. 의뢰금이 시세에 비해 클수록, 재료 등급이 낮고 층이 얕을수록 성공 확률이 오른다 (의뢰금 ↑ → 성공 ↑ 단조).
 * - 성공 = 1 − oddsBase^(유효비율^oddsExponent), 유효비율 = (의뢰금 ÷ 시세) ÷ 난이도
 * - 성공하지 못한 나머지를 partialShare : (1 − partialShare) 로 일부 성공 / 실패에 나눈다.
 * - 수량이 1이면 일부 성공(절반, 올림)이 성공과 같아지므로 일부 성공 몫을 성공에 합친다 (성공 / 실패 두 가지뿐).
 */
export function requestOdds(
  input: { reward: number; value: number; rarity: RequestRarity; floorNo: number; quantity: number },
  cfg: RequestConfig,
): RequestOdds {
  const ratio = input.value > 0 ? Math.max(0, input.reward) / input.value : 0;
  const effective = ratio / difficultyOf(input.rarity, input.floorNo, cfg);
  const pSuccess = effective <= 0 ? 0 : 1 - Math.pow(cfg.oddsBase, Math.pow(effective, cfg.oddsExponent));
  const rest = 1 - pSuccess;
  const pPartial = input.quantity <= 1 ? 0 : rest * cfg.partialShare;

  const successBp = Math.min(BP, Math.max(0, Math.round((pSuccess + (input.quantity <= 1 ? rest * cfg.partialShare : 0)) * BP)));
  const partialBp = Math.min(BP - successBp, Math.max(0, Math.round(pPartial * BP)));
  return { successBp, partialBp, failBp: BP - successBp - partialBp };
}

/** 0 이상 1 미만의 굴림값 하나로 결과를 정한다 (확률 구간: 성공 → 일부 성공 → 실패). */
export function outcomeOf(roll: number, odds: RequestOdds): RequestOutcome {
  const x = roll * BP;
  if (x < odds.successBp) return "success";
  if (x < odds.successBp + odds.partialBp) return "partial";
  return "fail";
}

/** 받는 재료 수: 성공 전체, 일부 성공 절반(올림), 실패 0. */
export function receivedQuantity(outcome: RequestOutcome, quantity: number): number {
  return outcome === "success" ? quantity : outcome === "partial" ? Math.ceil(quantity / 2) : 0;
}

/** 실패했을 때 돌려받는 의뢰금 (내림). 성공·일부 성공은 환불 없음. */
export function refundOf(outcome: RequestOutcome, reward: number, refundBp: number): number {
  return outcome === "fail" ? Math.floor((reward * refundBp) / BP) : 0;
}

/**
 * 의뢰 소요 시간(초). 시간 배율(개발·테스트 전용 환경 변수, production 에서는 항상 1)로 줄일 수 있다. 최소 1초.
 */
export function durationSecondsOf(floorDurationSeconds: number, timeScale: number): number {
  const scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
  return Math.max(1, Math.ceil(floorDurationSeconds / scale));
}

/** 의뢰할 수 있는 재료: 기본 식재료 제외, 해금한 최고 층까지 + 그보다 한 층 아래(깊은) 층의 재료. */
export function requestableIngredients<T extends { isStaple: boolean; unlockFloor: number }>(unlockedFloor: number, list: readonly T[]): T[] {
  return list.filter((i) => !i.isStaple && i.unlockFloor <= unlockedFloor + 1);
}

/** 남은 시간을 "1시간 30분" 같은 문장으로 (표시 전용). */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}초`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}
