import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 보안 테스트(정적): 평론가의 방문 예정 시각·변장·점수·진열 스냅샷은 발행 전에 클라이언트로 나가면 안 된다.
// 화면·컴포넌트·다른 쿼리가 평론가 테이블/컬럼을 읽지 못하게 하고, 가이드북 쿼리는 발행된 행만 읽는지 확인한다.
// (실제 데이터 흐름은 critic.integration.test.ts 와 e2e/critic.spec.ts 가 확인한다.)
const root = join(__dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const sources = (dir: string) => walk(join(root, dir)).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const read = (f: string) => readFileSync(f, "utf8");
const SECRET = /criticNextAt|critic_next_at|criticDeferred|critic_deferred|criticVisits|critic_visits|criticSettings|criticTexts|resolveCriticOrders|recordCriticVisit/;

describe("평론가 정보 노출 방지 (정적 검사)", () => {
  it("화면(app)과 컴포넌트는 평론가 테이블·컬럼·명령을 직접 읽지 않는다", () => {
    for (const f of [...sources("app"), ...sources("components")]) {
      expect(SECRET.test(read(f)), f.replace(root, "src")).toBe(false);
    }
  });

  it("평론가 테이블은 가이드북 쿼리(guide.ts)와 안내 팁 쿼리(tutorial.ts)에서만 읽고, 다른 쿼리 모듈은 읽지 않는다", () => {
    for (const f of sources("db/queries")) {
      const name = f.split("/").pop()!;
      if (name === "guide.ts" || name === "tutorial.ts") continue;
      expect(SECRET.test(read(f)), name).toBe(false);
    }
  });

  it("가이드북·팁 쿼리는 방문 예정 시각·미평가 표시를 읽지 않고, critic_visits 는 발행된 행만 읽는다", () => {
    for (const name of ["guide.ts", "tutorial.ts"]) {
      const src = read(join(root, "db/queries", name));
      expect(/criticNextAt|critic_next_at|criticDeferred|critic_deferred/.test(src), name).toBe(false);
      const parts = src.split(/\.from\(criticVisits\)|from \$\{criticVisits\}/).slice(1);
      expect(parts.length, name).toBeGreaterThan(0);
      for (const part of parts) expect(part.slice(0, 900), `${name}: critic_visits 쿼리는 status 'published' 조건이 필요합니다`).toMatch(/status[^;]{0,40}["']published["']|"published"/);
    }
  });

  it("가이드북 데이터 타입에는 점수·스냅샷·변장·예정 시각·판매/주문 id 필드가 없다", () => {
    const src = read(join(root, "db/queries/guide.ts"));
    const types = src.slice(src.indexOf("export type GuideReview"), src.indexOf("const splitLines"));
    for (const word of ["scores", "snapshot", "disguise", "scheduledAt", "nextAt", "orderId", "salesRecordId", "customerTypeId", "deferred"]) {
      expect(types, word).not.toContain(word);
    }
  });

  it("클라이언트 컴포넌트는 평론가 계산·시드 모듈을 가져오지 않는다 (점수 계산이 브라우저로 가지 않게)", () => {
    for (const f of sources("components")) {
      expect(/lib\/game\/critic|seed-data\/critic|commands\/critic/.test(read(f)), f.replace(root, "src")).toBe(false);
    }
  });

  it("판매 기록·주문 테이블 스키마에는 평론가 표시 컬럼이 없다 (발행 후에만 critic_visits 로 연결해 공개)", () => {
    for (const name of ["sales.ts", "orders.ts"]) {
      expect(/critic|평론가/i.test(read(join(root, "db/schema", name))), name).toBe(false);
    }
  });
});
