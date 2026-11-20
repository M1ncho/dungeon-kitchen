import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rollOutcome } from "../../lib/game/request-roll";
import type { Database } from "../index";
import { ingredientRequests, ingredients, profiles, userIngredients } from "../schema";
import { collectRequest, placeRequest } from "./requests";

// 실제 Neon(dev 브랜치) 통합 테스트. 유저는 profiles 에 직접 만들고 끝나면 삭제한다 (FK cascade).
// 모든 호출에 시각을 직접 넘겨 "시간 경과"를 만든다. 결과는 확률 스냅샷을 직접 바꿔 원하는 결과를 만든다.
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;

const T0 = new Date("2030-05-01T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe.skipIf(!enabled)("의뢰 게시판 (통합)", () => {
  let db: Database;
  const users: string[] = [];
  const ing = new Map<string, number>();

  async function newUser(opts: { gold?: number; unlocked?: number } = {}) {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({ id, nickname: `rq${id.slice(0, 8)}`, gold: opts.gold ?? 500, unlockedFloor: opts.unlocked ?? 1 });
    users.push(id);
    return id;
  }
  const gold = async (u: string) => (await db.select().from(profiles).where(eq(profiles.id, u)))[0].gold;
  const stock = async (u: string, code: string) =>
    (await db.select().from(userIngredients).where(and(eq(userIngredients.userId, u), eq(userIngredients.ingredientId, ing.get(code)!))))[0]?.quantity ?? 0;
  const rows = (u: string) => db.select().from(ingredientRequests).where(eq(ingredientRequests.userId, u)).orderBy(ingredientRequests.slotIndex);
  const place = (u: string, code: string, quantity: number, reward: number, now = T0, timeScale = 1) =>
    placeRequest(db, { userId: u, ingredientId: ing.get(code)!, quantity, reward, now, timeScale });
  const force = (id: string, o: { s: number; p: number; f: number }) =>
    db.update(ingredientRequests).set({ successBp: o.s, partialBp: o.p, failBp: o.f }).where(eq(ingredientRequests.id, id));

  beforeAll(async () => {
    if (usePglite) {
      const { PGlite } = await import("@electric-sql/pglite");
      const { drizzle } = await import("drizzle-orm/pglite");
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      const schema = await import("../schema");
      const { seedWorld } = await import("../seed");
      const local = drizzle(new PGlite(), { schema });
      await migrate(local, { migrationsFolder: "./drizzle" });
      await seedWorld(local);
      db = local as unknown as Database;
    } else {
      ({ db } = await import("../index"));
    }
    for (const r of await db.select({ id: ingredients.id, code: ingredients.code }).from(ingredients)) ing.set(r.code, r.id);
  });
  afterAll(async () => {
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  it("등록: 의뢰금이 골드에서 차감되고, 확률은 등록 시점 값으로 저장되며, 소요 시간은 재료 해금 층의 값이다", async () => {
    const u = await newUser({ gold: 100 });
    const r = await place(u, "slime_jelly", 3, 24); // 시세 8 × 3 = 24, 의뢰금 = 시세
    expect(r.ok).toBe(true);
    expect(await gold(u)).toBe(76);
    const [row] = await rows(u);
    expect(row).toMatchObject({ slotIndex: 0, quantity: 3, reward: 24, marketValue: 24, status: "pending", durationSeconds: 1800, refundBp: 5000 });
    expect(row.readyAt.getTime()).toBe(at(1800).getTime()); // 1층 재료: 30분
    expect(row.successBp + row.partialBp + row.failBp).toBe(10000);
    expect(row.successBp).toBeGreaterThanOrEqual(5900); // 의뢰금 = 시세 → 성공 약 60%
    expect(row.successBp).toBeLessThanOrEqual(6100);
    expect(row.outcome).toBeNull(); // 결과는 수령 전에는 정해 저장하지 않는다
  });

  it("수량 1개 의뢰는 일부 성공이 없다 (성공 + 실패 = 100%)", async () => {
    const u = await newUser();
    expect((await place(u, "slime_jelly", 1, 8)).ok).toBe(true);
    const [row] = await rows(u);
    expect(row.partialBp).toBe(0);
    expect(row.successBp + row.failBp).toBe(10000);
  });

  it("재료의 해금 층에 따라 소요 시간이 다르다 (1층 30분 … 5층 4시간)", async () => {
    const prices = new Map((await db.select({ code: ingredients.code, p: ingredients.basePrice }).from(ingredients)).map((r) => [r.code, r.p]));
    for (const [code, expected] of [["slime_jelly", 1800], ["cave_mushroom", 3600], ["lava_pepper", 7200], ["frost_herb", 10800], ["phoenix_egg", 14400]] as const) {
      const v = await newUser({ unlocked: 5, gold: 5000 });
      const r = await place(v, code, 1, prices.get(code)!);
      expect(r.ok, code).toBe(true);
      const [row] = await rows(v);
      expect(row.durationSeconds, code).toBe(expected);
      expect(row.readyAt.getTime() - T0.getTime(), code).toBe(expected * 1000);
    }
  });

  it("시간 배율이 있으면 소요 시간이 줄어든다 (개발·테스트 전용, 30분 → 1초)", async () => {
    const w = await newUser({ gold: 100 });
    expect((await place(w, "slime_jelly", 3, 24, T0, 1800)).ok).toBe(true);
    const [fast] = await rows(w);
    expect(fast.durationSeconds).toBe(1);
    expect(fast.readyAt.getTime()).toBe(at(1).getTime());
  });

  it("동시 진행 의뢰는 최대 2개: 셋째는 등록할 수 없고 의뢰금도 나가지 않는다", async () => {
    const u = await newUser({ gold: 200 });
    expect((await place(u, "slime_jelly", 1, 8)).ok).toBe(true);
    expect((await place(u, "slime_jelly", 1, 8)).ok).toBe(true);
    const before = await gold(u);
    expect(await place(u, "slime_jelly", 1, 8)).toEqual({ ok: false, reason: "board_full" });
    expect(await gold(u)).toBe(before);
    expect((await rows(u)).map((r) => r.slotIndex)).toEqual([0, 1]);
  });

  it("동시에 여러 번 등록해도 자리는 2개뿐이고 의뢰금은 성공한 만큼만 나간다", async () => {
    const u = await newUser({ gold: 200 });
    const results = await Promise.all([1, 2, 3, 4].map(() => place(u, "slime_jelly", 1, 8)));
    expect(results.filter((r) => r.ok).length).toBe(2);
    expect(results.filter((r) => !r.ok && r.reason === "board_full").length).toBe(2);
    expect(await gold(u)).toBe(200 - 16);
    expect((await rows(u)).length).toBe(2);
  });

  it("수령 전(완료됐어도) 의뢰는 자리를 차지하고, 수령하면 자리가 비워진다", async () => {
    const u = await newUser({ gold: 200 });
    const a = await place(u, "slime_jelly", 1, 8);
    await place(u, "slime_jelly", 1, 8);
    expect(await place(u, "slime_jelly", 1, 8, at(99999))).toEqual({ ok: false, reason: "board_full" }); // 시간이 한참 지나 완료돼도 수령 전이면 자리 차지
    expect(a.ok && (await collectRequest(db, { userId: u, requestId: a.id, now: at(1800) })).ok).toBe(true);
    const again = await place(u, "slime_jelly", 1, 8, at(1801));
    expect(again.ok).toBe(true);
    expect((await rows(u)).filter((r) => r.status === "pending").map((r) => r.slotIndex)).toEqual([0, 1]);
  });

  it("골드가 부족하면 등록할 수 없고 아무것도 바뀌지 않는다", async () => {
    const u = await newUser({ gold: 10 });
    expect(await place(u, "slime_jelly", 3, 24)).toEqual({ ok: false, reason: "insufficient_gold" });
    expect(await gold(u)).toBe(10);
    expect((await rows(u)).length).toBe(0);
  });

  it("골드가 한 번 분량뿐일 때 동시에 등록해도 한 번만 되고 골드는 음수가 되지 않는다", async () => {
    const u = await newUser({ gold: 30 });
    const results = await Promise.all([place(u, "slime_jelly", 3, 24), place(u, "slime_jelly", 3, 24), place(u, "slime_jelly", 3, 24)]);
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok && r.reason === "insufficient_gold").length).toBe(2);
    expect(await gold(u)).toBe(6);
  });

  it("검증: 기본 식재료·너무 깊은 층 재료·잘못된 수량·허용 범위 밖 의뢰금은 거부된다", async () => {
    const u = await newUser({ gold: 1000, unlocked: 1 });
    expect(await place(u, "salt", 1, 2)).toEqual({ ok: false, reason: "not_available" }); // 기본 식재료
    expect(await place(u, "lava_pepper", 1, 9)).toEqual({ ok: false, reason: "not_available" }); // 3층 재료는 해금 1 + 1 = 2층까지
    expect((await place(u, "cave_mushroom", 1, 6)).ok).toBe(true); // 2층 재료 (한 층 아래)
    expect(await place(u, "slime_jelly", 6, 48)).toEqual({ ok: false, reason: "quantity_out_of_range" });
    expect(await place(u, "slime_jelly", 0, 8)).toEqual({ ok: false, reason: "bad_request" });
    expect(await place(u, "slime_jelly", 1.5, 8)).toEqual({ ok: false, reason: "bad_request" });
    expect(await place(u, "slime_jelly", 2, 7)).toEqual({ ok: false, reason: "reward_out_of_range" }); // 시세 16 의 50% = 8 미만
    expect(await place(u, "slime_jelly", 2, 49)).toEqual({ ok: false, reason: "reward_out_of_range" }); // 300% = 48 초과
    expect((await place(u, "slime_jelly", 2, 8)).ok).toBe(true); // 하한(50%)
    expect(await gold(u)).toBe(1000 - 6 - 8);
    // 잘못된 입력 형식
    for (const bad of [{ ingredientId: "1" }, { ingredientId: -1 }, { ingredientId: NaN }]) {
      const r = await placeRequest(db, { userId: u, ingredientId: bad.ingredientId, quantity: 1, reward: 8, now: T0 });
      expect(r.ok).toBe(false);
    }
    expect((await placeRequest(db, { userId: u, ingredientId: 999999999, quantity: 1, reward: 8, now: T0 })).ok).toBe(false); // 없는 재료
  });

  it("해금한 층이 올라가면 더 깊은 층 재료도 의뢰할 수 있다", async () => {
    const u = await newUser({ gold: 1000, unlocked: 2 });
    expect((await place(u, "lava_pepper", 1, 9)).ok).toBe(true); // 3층 = 해금 2 + 1
    expect(await place(u, "frost_herb", 1, 11)).toEqual({ ok: false, reason: "not_available" }); // 4층은 아직 아님
  });

  it("아직 돌아오지 않았으면 수령할 수 없다 (상태는 그대로)", async () => {
    const u = await newUser();
    const r = await place(u, "slime_jelly", 2, 16);
    if (!r.ok) throw new Error("등록 실패");
    expect(await collectRequest(db, { userId: u, requestId: r.id, now: at(1799) })).toEqual({ ok: false, reason: "not_ready" });
    expect((await rows(u))[0].status).toBe("pending");
    expect(await stock(u, "slime_jelly")).toBe(0);
  });

  it("성공: 전체 수량이 창고에 들어가고 의뢰금 환불은 없다. 결과 카드용 한마디가 저장된다", async () => {
    const u = await newUser({ gold: 100 });
    const r = await place(u, "slime_jelly", 3, 24);
    if (!r.ok) throw new Error();
    await force(r.id, { s: 10000, p: 0, f: 0 });
    const c = await collectRequest(db, { userId: u, requestId: r.id, now: at(1800) });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.result).toMatchObject({ outcome: "success", quantity: 3, received: 3, reward: 24, refund: 0 });
    expect(c.result.line.length).toBeGreaterThan(0);
    expect(c.result.line).not.toMatch(/\{(item|n)\}/);
    expect(c.result.speaker.length).toBeGreaterThan(0);
    expect(await stock(u, "slime_jelly")).toBe(3);
    expect(await gold(u)).toBe(76); // 의뢰금 24 만 나간 상태 그대로
    const [row] = await rows(u);
    expect(row).toMatchObject({ status: "collected", outcome: "success", receivedQuantity: 3, refundGold: 0 });
    expect(row.collectedAt?.getTime()).toBe(at(1800).getTime());
  });

  it("일부 성공: 수량의 절반(올림)을 받고 환불은 없다", async () => {
    const u = await newUser({ gold: 500 });
    for (const [q, got] of [[2, 1], [3, 2], [4, 2], [5, 3]] as const) {
      const r = await place(u, "slime_jelly", q, 8 * q);
      if (!r.ok) throw new Error();
      await force(r.id, { s: 0, p: 10000, f: 0 });
      const before = await stock(u, "slime_jelly");
      const c = await collectRequest(db, { userId: u, requestId: r.id, now: at(1800) });
      expect(c.ok && c.result).toMatchObject({ outcome: "partial", received: got, refund: 0 });
      expect((await stock(u, "slime_jelly")) - before).toBe(got);
    }
  });

  it("실패: 재료 없음, 의뢰금의 50% 환불", async () => {
    const u = await newUser({ gold: 100 });
    const r = await place(u, "slime_jelly", 3, 25);
    if (!r.ok) throw new Error();
    expect(await gold(u)).toBe(75);
    await force(r.id, { s: 0, p: 0, f: 10000 });
    const c = await collectRequest(db, { userId: u, requestId: r.id, now: at(1800) });
    expect(c.ok && c.result).toMatchObject({ outcome: "fail", received: 0, refund: 12 }); // 25 의 50% 내림
    expect(await stock(u, "slime_jelly")).toBe(0);
    expect(await gold(u)).toBe(75 + 12);
    expect((await rows(u))[0]).toMatchObject({ outcome: "fail", receivedQuantity: 0, refundGold: 12 });
  });

  it("결과는 의뢰 id 와 등록 시점 확률로 결정적이다 (저장 전에 계산해도 같다)", async () => {
    const u = await newUser({ gold: 500 });
    for (let i = 0; i < 2; i++) {
      const r = await place(u, "slime_jelly", 3, 24 + i);
      if (!r.ok) throw new Error();
      const [row] = (await rows(u)).filter((x) => x.id === r.id);
      const expected = rollOutcome(r.id, { successBp: row.successBp, partialBp: row.partialBp, failBp: row.failBp });
      const c = await collectRequest(db, { userId: u, requestId: r.id, now: at(1800) });
      expect(c.ok && c.result.outcome).toBe(expected);
    }
  });

  it("중복 수령 방지: 같은 의뢰를 동시에 여러 번 받아도 한 번만 반영된다", async () => {
    const u = await newUser({ gold: 100 });
    const r = await place(u, "slime_jelly", 4, 32);
    if (!r.ok) throw new Error();
    await force(r.id, { s: 10000, p: 0, f: 0 });
    const results = await Promise.all(Array.from({ length: 6 }, () => collectRequest(db, { userId: u, requestId: r.id, now: at(1800) })));
    expect(results.filter((x) => x.ok).length).toBe(1);
    expect(results.filter((x) => !x.ok && x.reason === "already_collected").length).toBe(5);
    expect(await stock(u, "slime_jelly")).toBe(4);
    // 이미 받은 의뢰를 나중에 다시 받으려 해도 마찬가지
    expect(await collectRequest(db, { userId: u, requestId: r.id, now: at(9999) })).toEqual({ ok: false, reason: "already_collected" });
    expect(await stock(u, "slime_jelly")).toBe(4);
  });

  it("중복 수령 방지(실패): 환불도 한 번만 들어온다", async () => {
    const u = await newUser({ gold: 100 });
    const r = await place(u, "slime_jelly", 3, 24);
    if (!r.ok) throw new Error();
    await force(r.id, { s: 0, p: 0, f: 10000 });
    await Promise.all([1, 2, 3, 4].map(() => collectRequest(db, { userId: u, requestId: r.id, now: at(1800) })));
    expect(await gold(u)).toBe(76 + 12);
  });

  it("남의 의뢰는 받을 수 없고, 잘못된 id 는 거부된다", async () => {
    const owner = await newUser();
    const other = await newUser();
    const r = await place(owner, "slime_jelly", 2, 16);
    if (!r.ok) throw new Error();
    await force(r.id, { s: 10000, p: 0, f: 0 });
    expect(await collectRequest(db, { userId: other, requestId: r.id, now: at(1800) })).toEqual({ ok: false, reason: "not_found" });
    expect(await stock(other, "slime_jelly")).toBe(0);
    expect((await rows(owner))[0].status).toBe("pending"); // 주인의 의뢰는 그대로
    expect(await collectRequest(db, { userId: owner, requestId: "not-a-uuid", now: at(1800) })).toEqual({ ok: false, reason: "bad_request" });
    expect(await collectRequest(db, { userId: owner, requestId: crypto.randomUUID(), now: at(1800) })).toEqual({ ok: false, reason: "not_found" });
  });

  it("의뢰 확률은 수령 전까지 DB 안에만 있고 등록 응답에는 의뢰 id 와 완료 시각뿐이다", async () => {
    const u = await newUser();
    const r = await place(u, "slime_jelly", 2, 16);
    expect(Object.keys(r).sort()).toEqual(["id", "ok", "readyAtMs"]);
  });
});
