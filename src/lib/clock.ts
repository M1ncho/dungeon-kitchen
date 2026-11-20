import { readFileSync } from "node:fs";

/**
 * 서버 시각의 단일 진입점. 슬롯 계산·구매 검증·영업 정산은 모두 이 함수의 값을 쓴다 (클라이언트 시각 금지).
 *
 * e2e 전용 환경 변수 (production 에서는 무시되며, 설정돼 있으면 서버 시작 시 에러로 막는다 — src/lib/env.ts):
 * - E2E_FIXED_NOW(ISO 문자열): 슬롯 경계(정각)에 걸려 테스트가 흔들리지 않게 시각을 고정한다.
 * - E2E_TIME_OFFSET_FILE: 이 파일에 적힌 밀리초만큼 시각을 앞으로 옮긴다. e2e 가 "시간 경과"를 흉내 낼 때 쓴다
 *   (파일이 없거나 비어 있으면 0). 영업 정산처럼 시간이 지나야 하는 흐름을 테스트하기 위한 장치다.
 */
/**
 * 의뢰 게시판 시간 배율 (개발·테스트 전용 환경 변수 REQUEST_TIME_SCALE, 예: 1800 → 30분 의뢰가 1초).
 * production 에서는 항상 1 이고, 설정돼 있으면 서버 시작 시 에러로 막는다 (src/lib/env.ts).
 */
export function requestTimeScale(): number {
  if (process.env.NODE_ENV === "production") return 1;
  const v = Number(process.env.REQUEST_TIME_SCALE);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function serverNow(): Date {
  if (process.env.NODE_ENV === "production") return new Date();
  let base = Date.now();
  const pinned = process.env.E2E_FIXED_NOW;
  if (pinned) {
    const t = Date.parse(pinned);
    if (!Number.isNaN(t)) base = t;
  }
  const file = process.env.E2E_TIME_OFFSET_FILE;
  if (file) {
    try {
      const offset = Number(readFileSync(file, "utf8").trim());
      if (Number.isFinite(offset)) base += offset;
    } catch {
      // 파일이 없으면 이동 없음
    }
  }
  return new Date(base);
}
