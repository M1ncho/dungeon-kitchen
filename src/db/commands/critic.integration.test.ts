import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { orderScore, publishAtMs, type CriticOrderResult } from "../../lib/game/critic";
import type { Database } from "../index";
import {
  criticSettings, criticVisits, customerTypes, dishZones, dungeonFloors, ingredients, profiles, salesRecords, salesSessions, shops, specialOrders, userDishes,
} from "../schema";

// 가이드북 쿼리는 "server-only" 를 import 한다. 통합 테스트(Node)에서는 빈 모듈로 바꾼다.
vi.mock("server-only", () => ({}));

import { dismissGuideNotice, markReviewsSeen, publishDueCriticReviews, setGuideListed } from "./critic";
import { getWaitingOrderView, serveWithDish } from "./orders";
import { addDisplay, closeSession, settleSessions, startSession } from "./sales";

// 미식 평론가 통합 테스트: 방문 일정, 변장, 평가, 발행, 별점 효과, 공개 범위. 모든 호출에 시각을 직접 넘겨 "시간 경과"를 만든다.
// 설정(critic_settings)을 잠시 바꾸는 테스트가 있어 끝나면 원래 값으로 되돌린다 (방문 예정이 있는 이 테스트의 유저에게만 영향이 있다).
const usePglite = process.env.TEST_DB === "pglite";
const enabled = usePglite || !!process.env.DATABASE_URL;

const T0 = new Date("2030-06-01T03:00:00.000Z"); // 한국 시간 12:00
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!enabled)("미식 평론가 (통합)", () => {
  let db: Database;
  let original: typeof criticSettings.$inferSelect;
  let guide: typeof import("../queries/guide");
  const users: string[] = [];
  let soupZoneId = 0;
  let floorId = 0;
  let anyIngredientId = 0;

  /** 유저 + 포장마차 + 수프 요리 (재료비 10 → 기준가 24G) */
  async function newUser(o: { dishes?: number; quality?: number; nextAtMin?: number | null; extra?: { zone: string; count: number; quality?: number }[] } = {}) {
    const id = crypto.randomUUID();
    await db.insert(profiles).values({
      id, nickname: `cr${id.slice(0, 8)}`, gold: 100, reputation: 0,
      criticNextAt: o.nextAtMin === null || o.nextAtMin === undefined ? null : at(o.nextAtMin),
    });
    await db.insert(shops).values({ ownerId: id, name: "테스트 포장마차", floorId });
    users.push(id);
    const make = (zoneId: number, count: number, quality: number, name: string) =>
      db.insert(userDishes).values(
        Array.from({ length: count }, () => ({
          userId: id, zoneId, mainIngredientId: anyIngredientId, name, quality, finalX: 0, finalY: 30, toxin: 0, steps: [],
          ingredientCost: 10, readyAt: T0, collectedAt: T0,
        })),
      );
    await make(soupZoneId, o.dishes ?? 60, o.quality ?? 3, "진한 버섯 수프");
    for (const e of o.extra ?? []) {
      const [z] = await db.select({ id: dishZones.id }).from(dishZones).where(eq(dishZones.code, e.zone));
      await make(z.id, e.count, e.quality ?? 3, `테스트 ${e.zone}`);
    }
    return id;
  }
  const dishOf = async (u: string, zoneId = soupZoneId) =>
    (await db.select().from(userDishes).where(and(eq(userDishes.userId, u), eq(userDishes.zoneId, zoneId))).orderBy(userDishes.createdAt))
      .find((d) => d.displayId === null && d.soldAt === null)!;
  const visits = (u: string) => db.select().from(criticVisits).where(eq(criticVisits.userId, u)).orderBy(criticVisits.visitedAt);
  const profileOf = async (u: string) => (await db.select().from(profiles).where(eq(profiles.id, u)))[0];
  const settle = (u: string, minutes: number) => settleSessions(db, u, at(minutes));
  const setCritic = (patch: Partial<typeof criticSettings.$inferInsert>) => db.update(criticSettings).set(patch).where(eq(criticSettings.id, 1));

  /** 영업 시작: 수프 n개를 가격 price 로 진열 (기준가 24G) */
  async function open(u: string, quantity = 50, price = 24, minutes = 0) {
    const dish = await dishOf(u);
    expect(await startSession(db, { userId: u, now: at(minutes), displays: [{ dishId: dish.id, quantity, price }] })).toEqual({ ok: true });
    return (await db.select().from(salesSessions).where(eq(salesSessions.userId, u)))[0];
  }

  /** 5분 틱 경계마다 정산하며 방문이 생길 때까지 시간을 보낸다 (일반 주문 손님이 먼저 대기 중이면 변장 방문이 늦게 온다). 방문이 생긴 시각(분)을 돌려준다. */
  async function stepUntilVisit(u: string, from = 15, to = 240): Promise<number> {
    for (let m = from; m <= to; m += 5) {
      await settle(u, m);
      if ((await visits(u)).length > 0) return m;
    }
    throw new Error("평론가가 방문하지 않았습니다");
  }

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
    guide = await import("../queries/guide");
    soupZoneId = (await db.select({ id: dishZones.id }).from(dishZones).where(eq(dishZones.code, "soup")))[0].id;
    floorId = (await db.select({ id: dungeonFloors.id }).from(dungeonFloors).where(eq(dungeonFloors.floorNo, 1)))[0].id;
    anyIngredientId = (await db.select({ id: ingredients.id }).from(ingredients).limit(1))[0].id;
    [original] = await db.select().from(criticSettings);
    expect(original, "critic_settings 가 비어 있습니다. npm run db:seed 를 실행하세요.").toBeTruthy();
  });
  afterAll(async () => {
    if (original) await db.update(criticSettings).set(original).where(eq(criticSettings.id, 1));
    if (usePglite) return;
    if (users.length) await db.delete(profiles).where(inArray(profiles.id, users));
    await db.$client.end();
  });

  it("첫 영업 시작 때 첫 방문이 3~5일 뒤로 예약되고, 이미 예약돼 있으면 그대로다", async () => {
    await setCritic({ ...original });
    const fresh = await newUser({ nextAtMin: null });
    await open(fresh);
    const next = (await profileOf(fresh)).criticNextAt!;
    expect(next.getTime() - T0.getTime()).toBeGreaterThanOrEqual(3 * DAY);
    expect(next.getTime() - T0.getTime()).toBeLessThanOrEqual(5 * DAY);

    const booked = await newUser({ nextAtMin: 1000 });
    await open(booked);
    expect((await profileOf(booked)).criticNextAt!.getTime()).toBe(at(1000).getTime());
  });

  it("예정 시각 전에는 방문하지 않고, 이후 첫 영업 틱에 지나가는 손님으로 방문해 평가가 저장된다", async () => {
    await setCritic({ orderDisguiseBp: 0 }); // 항상 지나가는 손님으로 변장
    const u = await newUser({ nextAtMin: 60 });
    const session = await open(u, 50, 24);
    await settle(u, 30);
    expect(await visits(u)).toHaveLength(0);

    await settle(u, 90);
    const [v, ...rest] = await visits(u);
    expect(rest).toHaveLength(0);
    expect(v).toMatchObject({ status: "ready", disguise: "passerby", deferred: false, floorNo: 1, sessionId: session.id, orderId: null });
    expect(v.visitedAt.getTime()).toBe(at(60).getTime()); // 예정 시각(60분)과 같거나 이후에 끝나는 첫 틱 (틱 11: 55~60분)
    expect(v.scheduledAt.getTime()).toBe(at(60).getTime());
    // 진열 스냅샷: 수프(완벽) 한 묶음, 가격은 기준가 그대로 → 대표 3 + 다양성 1 + 가격 3 = 7/9 → 1층 ★2
    expect(v.scores).toEqual({ signature: 3, variety: 1, price: 3, order: null });
    expect(v.stars).toBe(2);
    expect(v.reviewText!.split("\n")).toHaveLength(4);
    expect(v.reviewText).toContain("테스트 포장마차");
    expect(v.publishAt.getTime()).toBe(publishAtMs(v.visitedAt.getTime(), 9));

    // 판매 기록에는 일반 손님처럼 남는다 (주문·판매 테이블에는 평론가 표시 컬럼이 없다)
    const [rec] = await db.select().from(salesRecords).where(eq(salesRecords.id, v.salesRecordId!));
    expect(rec).toMatchObject({ source: "passerby", customerTypeId: v.customerTypeId, dishName: "진한 버섯 수프", price: 24, quality: 3 });
    expect(Object.keys(rec).some((k) => /critic/i.test(k))).toBe(false);

    // 다음 방문은 방문 시각으로부터 3~5일 뒤로 다시 예약된다
    const next = (await profileOf(u)).criticNextAt!.getTime();
    expect(next - v.visitedAt.getTime()).toBeGreaterThanOrEqual(3 * DAY);
    expect(next - v.visitedAt.getTime()).toBeLessThanOrEqual(5 * DAY);

    // 다시 정산해도 방문은 한 번이다
    await settle(u, 150);
    await settle(u, 150);
    expect(await visits(u)).toHaveLength(1);
  });

  it("같은 시각까지 정산하면 정산을 몇 번에 나눠 하든 방문 시각과 평가가 같다", async () => {
    await setCritic({ orderDisguiseBp: 0 });
    const a = await newUser({ nextAtMin: 50 });
    const b = await newUser({ nextAtMin: 50 });
    const sa = await open(a, 50, 24);
    const sb = await open(b, 50, 24);
    await settle(a, 120); // 한 번에
    for (const m of [20, 41, 55, 61, 70, 99, 120]) await settle(b, m); // 여러 번에 나눠
    const [va] = await visits(a);
    const [vb] = await visits(b);
    expect(va.visitedAt.getTime() - sa.startedAt.getTime()).toBe(vb.visitedAt.getTime() - sb.startedAt.getTime());
    expect(va.tick).toBe(vb.tick);
    expect(va.scores).toEqual(vb.scores);
    expect(va.stars).toBe(vb.stars);
  });

  it("가게가 닫혀 있으면 방문이 미뤄지고, 다음 영업의 첫 틱에 일어난다", async () => {
    await setCritic({ orderDisguiseBp: 0 });
    const u = await newUser({ nextAtMin: 10 });
    await settle(u, 120); // 영업 중이 아니다
    expect(await visits(u)).toHaveLength(0);
    expect((await profileOf(u)).criticNextAt!.getTime()).toBe(at(10).getTime()); // 예정 시각은 그대로 (다음 영업까지 미뤄짐)

    await open(u, 50, 24, 180);
    await settle(u, 200);
    const [v] = await visits(u);
    expect(v.visitedAt.getTime()).toBe(at(185).getTime()); // 영업 첫 틱
    expect(v.deferred).toBe(false); // 닫혀 있어서 미뤄진 것은 "빈 진열대"가 아니다
  });

  it("방문 시점에 진열이 비어 있으면 평가하지 않고, 진열이 다시 채워진 뒤 첫 틱으로 미뤄 '빈 진열대' 도입이 붙는다", async () => {
    await setCritic({ orderDisguiseBp: 0 });
    const u = await newUser({ nextAtMin: 180, dishes: 10 });
    await open(u, 1, 12); // 1개를 반값에 — 금방 품절
    await settle(u, 190); // 예정 시각(180분) 이후 진열이 비어 있다
    expect(await visits(u)).toHaveLength(0);
    expect((await profileOf(u)).criticDeferred).toBe(true);
    expect((await profileOf(u)).criticNextAt!.getTime()).toBe(at(180).getTime());

    const dish = await dishOf(u);
    expect(await addDisplay(db, { userId: u, now: at(190), display: { dishId: dish.id, quantity: 3, price: 24 } })).toEqual({ ok: true });
    await settle(u, 215);
    const [v] = await visits(u);
    expect(v.deferred).toBe(true);
    expect(v.visitedAt.getTime()).toBe(at(195).getTime()); // 다시 채워진 뒤 첫 틱 (채운 시각 이후에 시작하는 틱)
    expect(v.reviewText!.split("\n")[0]).toMatch(/빈 진열대|휑|허탕|비어 있던 진열대/);
    expect((await profileOf(u)).criticDeferred).toBe(false); // 방문 후 표시는 지워진다
  });

  it("발행: 방문 다음 날 09:00(KST) 전에는 가이드북에 없고, 이후 가게 별점이 생기며 평과 변장이 공개된다", async () => {
    await setCritic({ orderDisguiseBp: 0 });
    const u = await newUser({ nextAtMin: 60 });
    await open(u, 50, 24);
    await settle(u, 90);
    const [v] = await visits(u);
    const publishAt = v.publishAt.getTime();
    expect(new Date(publishAt).toISOString()).toBe("2030-06-02T00:00:00.000Z"); // 2030-06-01 13:00 KST 방문 → 6/2 09:00 KST

    // 발행 전: 가이드북·뱃지·가게 별점 어디에도 없다
    expect(await publishDueCriticReviews(db, new Date(publishAt - 1000))).toBe(0);
    const before = await guide.getGuide(u, publishAt - 1000, db);
    expect(before.issue.filter((r) => r.shopName === "테스트 포장마차")).toHaveLength(0);
    expect(before.mine.reviews).toHaveLength(0);
    expect(before.mine.stars).toBeNull(); // 미평가
    expect(await guide.getUnseenReviewCount(u, db)).toBe(0);

    // 발행 시각이 되면 실린다 (누가 접속하든 지연 발행, 같은 평은 한 번만)
    expect(await publishDueCriticReviews(db, new Date(publishAt))).toBeGreaterThanOrEqual(1);
    expect(await publishDueCriticReviews(db, new Date(publishAt))).toBe(0);
    const [published] = await visits(u);
    expect(published.status).toBe("published");
    expect(published.publishedAt!.getTime()).toBe(publishAt); // 언제 실행했든 발행 시각은 방문 날짜에서 정해진 값
    const [shop] = await db.select().from(shops).where(eq(shops.ownerId, u));
    expect(shop.guideStars).toBe(v.stars);

    const after = await guide.getGuide(u, publishAt, db);
    expect(after.mine.stars).toBe(v.stars);
    expect(after.mine.reviews).toHaveLength(1);
    expect(after.mine.reviews[0].lines).toHaveLength(4);
    expect(after.issue.some((r) => r.id === v.id)).toBe(true);
    expect(after.shops.some((s) => s.mine && s.stars === v.stars && s.oneLine)).toBe(true);
    // 발행 이후에만 "그 손님이 평론가였다"가 판매 기록과 이어서 공개된다
    expect(after.mine.reviews[0].reveal).toMatchObject({ kind: "passerby", dishName: "진한 버섯 수프", price: 24 });

    // 알림 뱃지: 발행 후에만, 본 뒤에는 사라진다
    expect(await guide.getUnseenReviewCount(u, db)).toBe(1);
    await markReviewsSeen(db, u, new Date(publishAt + 1000));
    expect(await guide.getUnseenReviewCount(u, db)).toBe(0);
  });

  it("공개 설정: 끄면 가게 목록·이번 호에서 빠지지만 내 가게 탭과 별점은 그대로이고, 관리자가 숨긴 가게도 빠진다", async () => {
    await setCritic({ orderDisguiseBp: 0 });
    const u = await newUser({ nextAtMin: 60 });
    await open(u, 50, 24);
    await settle(u, 90);
    const [v] = await visits(u);
    const publishAt = v.publishAt.getTime();
    await publishDueCriticReviews(db, new Date(publishAt));
    const mineIn = (d: Awaited<ReturnType<typeof guide.getGuide>>) => d.shops.some((s) => s.mine);

    expect(mineIn(await guide.getGuide(u, publishAt, db))).toBe(true);
    await setGuideListed(db, u, false);
    const off = await guide.getGuide(u, publishAt, db);
    expect(mineIn(off)).toBe(false);
    expect(off.issue.some((r) => r.id === v.id)).toBe(false);
    expect(off.mine.reviews).toHaveLength(1); // 내 가게 탭에는 그대로
    expect(off.mine.stars).toBe(v.stars); // 평가와 별점은 그대로
    expect(off.mine.listed).toBe(false);

    await setGuideListed(db, u, true);
    expect(mineIn(await guide.getGuide(u, publishAt, db))).toBe(true);
    await db.update(shops).set({ guideHidden: true }).where(eq(shops.ownerId, u));
    const hidden = await guide.getGuide(u, publishAt, db);
    expect(mineIn(hidden)).toBe(false);
    expect(hidden.issue.some((r) => r.id === v.id)).toBe(false);
  });

  it("가이드북 공개 알림은 처음 한 번만 뜨고, 안내가 진행 중이면 미룬다", async () => {
    const u = await newUser({ nextAtMin: null });
    expect(await guide.getGuideSettings(u, db)).toEqual({ listed: true, noticePending: true }); // 기존 계정(안내 기록 없음)은 첫 접속에 알림
    await dismissGuideNotice(db, u, at(1));
    expect((await guide.getGuideSettings(u, db)).noticePending).toBe(false);
    await dismissGuideNotice(db, u, at(999)); // 두 번째는 시각을 덮어쓰지 않는다
    expect((await profileOf(u)).guideNoticeSeenAt!.getTime()).toBe(at(1).getTime());
  });

  it("별점 효과: 가이드북에 실린 별점이 있으면 그 시각 이후의 틱에서 손님이 늘어 판매가 늘어난다", async () => {
    await setCritic({ orderDisguiseBp: 0, starCustomerBp: 10000, starReliefBp: 0 }); // 효과를 키워 통계 비교를 안정시킨다
    const star = async () => {
      const u = await newUser({ nextAtMin: null, dishes: 99 });
      const [ct] = await db.select({ id: customerTypes.id }).from(customerTypes).limit(1);
      await db.insert(criticVisits).values({
        userId: u, scheduledAt: at(-3000), visitedAt: at(-2900), status: "published", disguise: "passerby", customerTypeId: ct.id, floorNo: 1,
        snapshot: { dishes: [] }, scores: { signature: 3, variety: 3, price: 3, order: null }, stars: 3, reviewText: "x", publishAt: at(-1000), publishedAt: at(-1000),
      });
      return u;
    };
    const plain = async () => newUser({ nextAtMin: null, dishes: 99 });
    const soldIn = async (u: string) => {
      await open(u, 99, 12); // 반값: 오는 손님은 거의 다 산다
      await settle(u, 240);
      return (await db.select().from(salesRecords).where(eq(salesRecords.userId, u))).length;
    };
    let withStar = 0;
    let without = 0;
    for (let i = 0; i < 3; i++) {
      withStar += await soldIn(await star());
      without += await soldIn(await plain());
    }
    expect(withStar).toBeGreaterThan(without * 1.2);

    // 발행 시각이 영업보다 뒤라면 효과가 없다 (효과는 발행 시각부터)
    const later = await newUser({ nextAtMin: null, dishes: 99 });
    const [ct] = await db.select({ id: customerTypes.id }).from(customerTypes).limit(1);
    await db.insert(criticVisits).values({
      userId: later, scheduledAt: at(-3000), visitedAt: at(-2900), status: "ready", disguise: "passerby", customerTypeId: ct.id, floorNo: 1,
      snapshot: { dishes: [] }, scores: { signature: 3, variety: 3, price: 3, order: null }, stars: 3, reviewText: "x", publishAt: at(24 * 60), publishedAt: null,
    });
    const laterSold = await soldIn(later);
    expect(laterSold).toBeLessThan(withStar / 3); // 별점이 있는 유저 한 명 몫보다 확실히 적다
  }, 300_000);

  it("주문 손님으로 변장: 일반 주문 손님과 같은 모양이고, 응대하면 판정 결과가 평가에 반영된다", async () => {
    await setCritic({ orderDisguiseBp: 10000 }); // 항상 주문 손님으로 변장
    const u = await newUser({ nextAtMin: 10, dishes: 60 });
    await open(u, 50, 24);
    const m = await stepUntilVisit(u);
    const [v] = await visits(u);
    expect(v).toMatchObject({ disguise: "order", status: "order_waiting", salesRecordId: null });
    expect(v.scores).toBeNull();
    expect(v.stars).toBeNull(); // 응대 결과가 나오기 전에는 평가가 없다
    const [order] = await db.select().from(specialOrders).where(eq(specialOrders.id, v.orderId!));
    expect(order).toMatchObject({ kind: "order", status: "waiting", userId: u, customerTypeId: v.customerTypeId });
    expect(Object.keys(order).some((k) => /critic/i.test(k))).toBe(false);

    // 클라이언트가 받는 주문 정보(OrderView)에는 평론가 단서가 없다
    const view = await getWaitingOrderView(db, u, at(m + 1));
    expect(view?.id).toBe(v.orderId);
    expect(JSON.stringify(view)).not.toMatch(/critic|평론가|은설|가면|disguise|variety|stars/i);

    // 있는 요리를 내주면 응대가 끝나고 평가가 확정된다
    const serve = await dishOf(u);
    const result = await serveWithDish(db, { userId: u, orderId: v.orderId!, dishId: serve.id, now: at(m + 2) });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/critic|평론가|은설|disguise|variety|stars/i); // 응대 직후 결과 카드에도 평론가 단서가 없다
    const [done] = await visits(u);
    expect(done.status).toBe("ready");
    const [served] = await db.select().from(specialOrders).where(eq(specialOrders.id, v.orderId!));
    expect(served.status).toBe("served");
    const expected: CriticOrderResult = { kind: "served", grade: served.grade as "close" | "normal" | "far" };
    expect((done.scores as { order: number }).order).toBe(orderScore(expected));
    expect(done.reviewText!.split("\n")).toHaveLength(4);
    expect(done.publishAt.getTime()).toBe(publishAtMs(done.visitedAt.getTime(), 9));
  });

  it("일반 주문 손님과 변장한 주문 손님의 OrderView 는 키와 모양이 같다", async () => {
    await setCritic({ orderDisguiseBp: 10000 });
    const c = await newUser({ nextAtMin: 10 });
    await open(c, 50, 24);
    const mc = await stepUntilVisit(c);
    const criticView = await getWaitingOrderView(db, c, at(mc + 1));

    // 평론가 없이 일반 주문 손님이 오는 유저 (등장은 틱마다 30%라 영업을 오래 보낸다)
    const r = await newUser({ nextAtMin: null });
    await open(r, 50, 24);
    let regularView = null;
    for (let m = 5; m <= 235 && !regularView; m += 5) {
      await settle(r, m);
      regularView = await getWaitingOrderView(db, r, at(m));
    }
    expect(regularView, "일반 주문 손님이 한 번도 오지 않았습니다").toBeTruthy();
    expect(Object.keys(criticView!).sort()).toEqual(Object.keys(regularView!).sort());
    for (const k of Object.keys(criticView!) as (keyof typeof criticView)[]) expect(typeof criticView![k], String(k)).toBe(typeof regularView![k]);
  });

  it("주문 손님으로 변장해 왔는데 응대하지 않고 떠나면(대기 시간 초과) 응대 항목이 0점으로 감점된다", async () => {
    await setCritic({ orderDisguiseBp: 10000 });
    const u = await newUser({ nextAtMin: 10 });
    await open(u, 50, 24);
    const m = await stepUntilVisit(u);
    const [v] = await visits(u);
    expect(v.status).toBe("order_waiting");
    const [order] = await db.select().from(specialOrders).where(eq(specialOrders.id, v.orderId!));
    // 대기 시간(30분)이 지나도록 응대하지 않았다
    await settle(u, m + 60);
    const [gone] = await visits(u);
    expect(gone.status).toBe("ready");
    expect(gone.scores).toMatchObject({ order: 0 });
    expect(gone.stars).toBeLessThanOrEqual(1); // 대표 3 + 다양성 1 + 가격 3 + 응대 0 = 7/12 → 1층 ★1 (★2 는 8점부터)
    const [expired] = await db.select().from(specialOrders).where(eq(specialOrders.id, order.id));
    expect(expired.status).toBe("expired");
    expect(gone.reviewText).toMatch(/답이 없|새겨듣지|귀를 열/); // 응대 없이 떠난 아쉬움 문장
  });

  it("영업을 마감해 주문 손님이 돌아가도 응대하지 않은 것으로 평가된다", async () => {
    await setCritic({ orderDisguiseBp: 10000 });
    const u = await newUser({ nextAtMin: 10 });
    await open(u, 50, 24);
    const m = await stepUntilVisit(u);
    expect((await visits(u))[0].status).toBe("order_waiting");
    expect(await closeSession(db, { userId: u, now: at(m + 3) })).toEqual({ ok: true });
    const [v] = await visits(u);
    expect(v.status).toBe("ready");
    expect(v.scores).toMatchObject({ order: 0 });
  });

  it("이미 주문 손님이 대기 중이면 주문 변장 방문은 오지 못하고, 대기가 끝난 뒤 틱으로 미뤄진다", async () => {
    await setCritic({ orderDisguiseBp: 10000 });
    const u = await newUser({ nextAtMin: 10 });
    const session = await open(u, 50, 24);
    const [ct] = await db.select({ id: customerTypes.id }).from(customerTypes).limit(1);
    // 일반 주문 손님이 이미 대기 중이다 (1분~31분)
    await db.insert(specialOrders).values({
      userId: u, sessionId: session.id, tick: 999, customerTypeId: ct.id, kind: "order", status: "waiting", targetX: 0, targetY: 0, toxinCap: 5,
      orderText: "아무거나", hintText: "힌트", arrivesAt: at(1), expiresAt: at(31),
    });
    await settle(u, 90);
    const [v] = await visits(u);
    expect(v.disguise).toBe("order");
    const [critic] = await db.select().from(specialOrders).where(eq(specialOrders.id, v.orderId!));
    expect(critic.arrivesAt.getTime()).toBeGreaterThanOrEqual(at(31).getTime()); // 대기 중인 손님이 떠난 뒤에 도착한다
    expect(v.visitedAt.getTime()).toBeGreaterThanOrEqual(at(31).getTime());
  });

  it("발행 전에는 가이드북 쿼리 결과 어디에도 방문 예정·변장·점수·평 문장이 없다", async () => {
    await setCritic({ orderDisguiseBp: 0 });
    const u = await newUser({ nextAtMin: 60 });
    await open(u, 50, 24);
    await settle(u, 90);
    const [v] = await visits(u);
    expect(v.status).toBe("ready");
    const data = await guide.getGuide(u, v.publishAt.getTime() - 1, db);
    const json = JSON.stringify(data) + JSON.stringify(await guide.getGuideSettings(u, db)) + String(await guide.getUnseenReviewCount(u, db));
    const next = (await profileOf(u)).criticNextAt!;
    for (const secret of [v.reviewText!, v.id, next.toISOString(), String(next.getTime()), at(60).toISOString(), "order_waiting", "passerby", "scores", "snapshot", "signature", "deferred"]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(data.mine.reviews).toHaveLength(0);
    // 같은 방문이 이 유저의 마지막 방문 기록이다 (다른 유저의 것을 보고 있지 않다)
    expect((await db.select().from(criticVisits).where(and(eq(criticVisits.userId, u), eq(criticVisits.status, "ready")))).length).toBe(1);
    expect((await db.select().from(criticVisits).orderBy(desc(criticVisits.createdAt)).limit(1)).length).toBe(1);
  });
});
