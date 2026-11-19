// 층 이동·승급 시험 규칙 (순수 함수). DB·시간·전역 난수에 의존하지 않는다.

export type MoveFloor = { floorNo: number; moveCost: number };
export type MoveUser = { currentFloor: number; unlockedFloor: number; gold: number; sessionOpen: boolean };
export type MoveResult =
  | { ok: true; cost: number }
  | { ok: false; reason: "unknown_floor" | "same_floor" | "locked" | "session_open" | "insufficient_gold"; cost: number };

/** 이동 비용: 더 깊은 층(번호가 큰 층)으로 갈 때만 그 층의 이전 비용을 낸다. 위층으로 갈 때는 무료. */
export function moveCostTo(currentFloor: number, floor: MoveFloor): number {
  return floor.floorNo > currentFloor ? floor.moveCost : 0;
}

/**
 * 층 이동 가능 여부. 해금한 층(최고 해금 층 이하)으로만, 영업 중이 아닐 때만, 골드가 충분할 때만 이동할 수 있다.
 * config.maxFloor 는 존재하는 가장 깊은 층.
 */
export function canMoveTo(user: MoveUser, floor: MoveFloor, config: { maxFloor: number }): MoveResult {
  const cost = moveCostTo(user.currentFloor, floor);
  if (!Number.isInteger(floor.floorNo) || floor.floorNo < 1 || floor.floorNo > config.maxFloor) return { ok: false, reason: "unknown_floor", cost };
  if (floor.floorNo === user.currentFloor) return { ok: false, reason: "same_floor", cost: 0 };
  if (floor.floorNo > user.unlockedFloor) return { ok: false, reason: "locked", cost };
  if (user.sessionOpen) return { ok: false, reason: "session_open", cost };
  if (user.gold < cost) return { ok: false, reason: "insufficient_gold", cost };
  return { ok: true, cost };
}

/**
 * 다음 승급 시험을 볼 층. 해금한 최고 층의 바로 아래 층의 해금 평판에 평판이 도달했으면 그 층 번호, 아니면 null.
 * floors 는 { floorNo, unlockReputation } 목록.
 */
export function nextExamFloor(
  unlockedFloor: number,
  reputation: number,
  floors: readonly { floorNo: number; unlockReputation: number }[],
): number | null {
  const next = floors.find((f) => f.floorNo === unlockedFloor + 1);
  return next && reputation >= next.unlockReputation ? next.floorNo : null;
}

/** 승급 시험 통과 조건: 판정이 "성공" 이상 (대성공·성공). 독성 상한 초과 등 실패와 "아쉬움"은 불합격. */
export function examPassed(grade: string): boolean {
  return grade === "great" || grade === "good";
}
