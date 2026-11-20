// 의뢰 결과를 정하는 난수 (서버 전용: 명령 모듈에서만 import 한다).
// 등록 시점에 저장한 확률 스냅샷과 의뢰 id 로 결정적으로 정한다. 같은 의뢰는 몇 번을 계산해도 같은 결과이고,
// 결과는 수령 시점에만 계산·저장되어 클라이언트에는 그 전에 나가지 않는다 (등록 화면에는 확률만 보인다).
import { createRng } from "./rng";
import { outcomeOf, type RequestOdds, type RequestOutcome } from "./requests";

export function rollOutcome(requestId: string, odds: RequestOdds): RequestOutcome {
  return outcomeOf(createRng(`${requestId}:result`)(), odds);
}

/** 결과별 대사 중 하나를 결정적으로 고른다 (같은 의뢰는 같은 대사). 목록이 비면 null. */
export function pickLine<T>(requestId: string, lines: readonly T[]): T | null {
  if (lines.length === 0) return null;
  return lines[Math.floor(createRng(`${requestId}:line`)() * lines.length)] ?? null;
}
