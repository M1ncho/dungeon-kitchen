// 시간 슬롯. 서버 시각으로만 계산한다 (클라이언트 시각 금지).

export function slotAt(nowMs: number, slotSeconds: number): number {
  return Math.floor(nowMs / (slotSeconds * 1000));
}

/** 슬롯이 끝나는(다음 슬롯이 시작하는) 시각 (ms). */
export function slotEndMs(slot: number, slotSeconds: number): number {
  return (slot + 1) * slotSeconds * 1000;
}
