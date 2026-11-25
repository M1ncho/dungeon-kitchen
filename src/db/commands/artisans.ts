import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../index";
import { artisanTools, artisans, dishZones, ingredients, profiles, userArtisans, userDishes, userIngredients, userToolLevels, visitedFloors } from "../schema";

// 층별 장인: 등장(가 본 층), 부탁 납품(도구 획득), 도구 강화. 모든 상태 전이는 조건부 update 로 한 번만 일어난다.

export type ArtisanFailure =
  | "bad_request" | "not_found" | "already_delivered" | "no_tool" | "dish_mismatch" | "max_level" | "insufficient_gold" | "insufficient_ingredients" | "stale";

class Abort extends Error {
  constructor(public reason: ArtisanFailure) {
    super(reason);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z_]{1,32}$/;

/**
 * 이 유저가 가 본 층에 장인이 있으면 등장시킨다 (없을 때만 insert, 여러 번 불려도 한 번만). 백그라운드 작업 없이 접속 시점에 지연 실행.
 * 부탁이 없는 장인(1층 고니, request_zone_code 가 null)은 가 본 층과 상관없이 모두에게 등장하고 도구는 이미 가진 것(0단계)으로 본다.
 */
export async function ensureArtisans(db: Pick<Database, "execute">, userId: string): Promise<void> {
  await db.execute(sql`
    insert into user_artisans (user_id, artisan_code, delivered_at, tool_level)
    select ${userId}::uuid, a.code,
           case when a.request_zone_code is null then now() end,
           case when a.request_zone_code is null then 0 end
    from artisans a
    where a.request_zone_code is null
       or exists (select 1 from visited_floors v where v.floor_no = a.floor_no and v.user_id = ${userId}::uuid)
    on conflict do nothing`);
}

/** 처음 가 본 층을 기록하고 그 층의 장인을 등장시킨다 (층 이동 트랜잭션 안에서 호출). */
export async function recordFloorVisit(tx: Pick<Database, "insert" | "execute">, userId: string, floorNo: number): Promise<void> {
  await tx.insert(visitedFloors).values({ userId, floorNo }).onConflictDoNothing();
  await ensureArtisans(tx, userId);
}

export type DeliverResult = { ok: true; toolName: string; methodCode: string } | { ok: false; reason: ArtisanFailure };

/**
 * 부탁 납품: 창고의 요리를 소모하고 도구를 받는다.
 * 한 트랜잭션에서 (1) 요리를 조건부 update(내 창고 요리 + 요구 구역 + 요구 품질 이상 + 진열·판매 아님)로 선점
 * (2) 도구를 tool_level is null 조건부 update 로 선점한다. 하나라도 실패하면 전체 롤백 (요리도 소모되지 않는다).
 */
export async function deliverRequest(db: Database, input: { userId: string; artisanCode: unknown; dishId: unknown; now: Date }): Promise<DeliverResult> {
  if (typeof input.artisanCode !== "string" || !CODE.test(input.artisanCode) || typeof input.dishId !== "string" || !UUID.test(input.dishId)) {
    return { ok: false, reason: "bad_request" };
  }
  const code = input.artisanCode;
  const dishId = input.dishId;
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          zoneCode: artisans.requestZoneCode, minQuality: artisans.requestMinQuality, count: artisans.requestCount, toolLevel: userArtisans.toolLevel,
        })
        .from(userArtisans)
        .innerJoin(artisans, eq(artisans.code, userArtisans.artisanCode))
        .where(and(eq(userArtisans.userId, input.userId), eq(userArtisans.artisanCode, code)));
      if (!row) throw new Abort("not_found"); // 아직 등장하지 않은 장인
      if (row.toolLevel !== null || row.zoneCode === null || row.minQuality === null) throw new Abort("already_delivered"); // 부탁이 없는 장인은 납품할 것이 없다
      const tools = await tx.select({ methodCode: artisanTools.methodCode, toolName: artisanTools.toolName }).from(artisanTools).where(eq(artisanTools.artisanCode, code)).orderBy(artisanTools.sortOrder);
      if (tools.length === 0) throw new Abort("not_found");
      const minQuality = row.minQuality;
      const [zone] = await tx.select({ id: dishZones.id }).from(dishZones).where(eq(dishZones.code, row.zoneCode!));
      if (!zone) throw new Abort("dish_mismatch");

      const eligible = and(
        eq(userDishes.userId, input.userId), isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt),
        eq(userDishes.zoneId, zone.id), gte(userDishes.quality, minQuality),
      );
      const [first] = await tx.update(userDishes).set({ soldAt: input.now }).where(and(eq(userDishes.id, dishId), eligible)).returning({ id: userDishes.id });
      if (!first) throw new Abort("dish_mismatch");
      if (row.count > 1) {
        // 더 필요한 만큼은 같은 조건의 다른 요리에서 선점한다 (모자라면 롤백)
        const more = await tx
          .update(userDishes)
          .set({ soldAt: input.now })
          .where(and(eligible, sql`${userDishes.id} in (select id from user_dishes d2 where d2.user_id = ${input.userId}::uuid and d2.collected_at is not null and d2.display_id is null and d2.sold_at is null and d2.zone_id = ${zone.id} and d2.quality >= ${minQuality} and d2.id <> ${dishId}::uuid limit ${row.count - 1})`))
          .returning({ id: userDishes.id });
        if (more.length < row.count - 1) throw new Abort("dish_mismatch");
      }
      const [got] = await tx
        .update(userArtisans)
        .set({ deliveredAt: input.now, toolLevel: 0, seenAt: sql`coalesce(${userArtisans.seenAt}, ${input.now.toISOString()}::timestamptz)` })
        .where(and(eq(userArtisans.userId, input.userId), eq(userArtisans.artisanCode, code), isNull(userArtisans.toolLevel)))
        .returning({ code: userArtisans.artisanCode });
      if (!got) throw new Abort("already_delivered");
      // 도구(조리법)를 0단계로 가진다. 이미 있으면 그대로 (강화 단계를 덮어쓰지 않는다).
      await tx.insert(userToolLevels).values(tools.map((t) => ({ userId: input.userId, methodCode: t.methodCode, level: 0 }))).onConflictDoNothing();
      return { ok: true as const, toolName: tools[0].toolName, methodCode: tools[0].methodCode };
    });
  } catch (err) {
    if (err instanceof Abort) return { ok: false, reason: err.reason };
    throw err;
  }
}

export type UpgradeResult = { ok: true; level: number; toolName: string; methodCode: string } | { ok: false; reason: ArtisanFailure };

/**
 * 도구 강화: 골드와 재료를 내고 다음 단계로. 단계를 "현재 단계 조건"으로 선점하므로 같은 요청이 두 번 와도 한 번만 강화된다.
 * 골드·재료는 모두 조건부 차감이고, 하나라도 모자라면 전체 롤백된다 (단계도 오르지 않는다).
 * 장인이 도구를 여럿 다루면(1층 고니) methodCode 로 어느 조리법인지 고른다. 도구가 하나뿐이면 생략할 수 있다.
 * 단계는 user_tool_levels(조리법별)가 기준이고, 도구가 하나이던 때의 user_artisans.tool_level 도 함께 맞춘다 (배포 중 옛 코드가 읽는 값).
 */
export async function upgradeTool(db: Database, input: { userId: string; artisanCode: unknown; methodCode?: unknown }): Promise<UpgradeResult> {
  if (typeof input.artisanCode !== "string" || !CODE.test(input.artisanCode)) return { ok: false, reason: "bad_request" };
  if (input.methodCode !== undefined && (typeof input.methodCode !== "string" || !CODE.test(input.methodCode))) return { ok: false, reason: "bad_request" };
  const code = input.artisanCode;
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ primaryMethod: artisans.methodCode, legacyLevel: userArtisans.toolLevel })
        .from(userArtisans)
        .innerJoin(artisans, eq(artisans.code, userArtisans.artisanCode))
        .where(and(eq(userArtisans.userId, input.userId), eq(userArtisans.artisanCode, code)));
      if (!row) throw new Abort("not_found");
      if (row.legacyLevel === null) throw new Abort("no_tool"); // 아직 부탁을 들어주지 않았다
      const tools = await tx.select().from(artisanTools).where(eq(artisanTools.artisanCode, code));
      const tool = input.methodCode === undefined ? (tools.length === 1 ? tools[0] : undefined) : tools.find((t) => t.methodCode === input.methodCode);
      if (!tool) throw new Abort(input.methodCode === undefined ? "bad_request" : "not_found");

      const [own] = await tx
        .select({ level: userToolLevels.level })
        .from(userToolLevels)
        .where(and(eq(userToolLevels.userId, input.userId), eq(userToolLevels.methodCode, tool.methodCode)));
      const isPrimary = tool.methodCode === row.primaryMethod;
      const level = Math.max(own?.level ?? 0, isPrimary ? row.legacyLevel : 0); // 기본 조리법은 행이 없으면 0단계
      const cost = level < 2 ? tool.upgrades[level] : undefined;
      if (!cost) throw new Abort("max_level");

      const claimed = own
        ? await tx
            .update(userToolLevels)
            .set({ level: level + 1 })
            .where(and(eq(userToolLevels.userId, input.userId), eq(userToolLevels.methodCode, tool.methodCode), eq(userToolLevels.level, own.level)))
            .returning({ level: userToolLevels.level })
        : await tx
            .insert(userToolLevels)
            .values({ userId: input.userId, methodCode: tool.methodCode, level: level + 1 })
            .onConflictDoNothing()
            .returning({ level: userToolLevels.level });
      if (claimed.length === 0) throw new Abort("stale");
      if (isPrimary) await tx.update(userArtisans).set({ toolLevel: level + 1 }).where(and(eq(userArtisans.userId, input.userId), eq(userArtisans.artisanCode, code)));

      const [paid] = await tx
        .update(profiles)
        .set({ gold: sql`${profiles.gold} - ${cost.gold}` })
        .where(and(eq(profiles.id, input.userId), sql`${profiles.gold} >= ${cost.gold}`))
        .returning({ gold: profiles.gold });
      if (!paid) throw new Abort("insufficient_gold");

      for (const item of cost.items) {
        const [ing] = await tx.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.code, item.ingredient));
        if (!ing) throw new Abort("insufficient_ingredients");
        const [took] = await tx
          .update(userIngredients)
          .set({ quantity: sql`${userIngredients.quantity} - ${item.qty}` })
          .where(and(eq(userIngredients.userId, input.userId), eq(userIngredients.ingredientId, ing.id), sql`${userIngredients.quantity} >= ${item.qty}`))
          .returning({ id: userIngredients.ingredientId });
        if (!took) throw new Abort("insufficient_ingredients");
      }
      return { ok: true as const, level: level + 1, toolName: tool.toolName, methodCode: tool.methodCode };
    });
  } catch (err) {
    if (err instanceof Abort) return { ok: false, reason: err.reason };
    throw err;
  }
}

/** 장인 화면을 처음 본 시각을 남긴다 (알림 뱃지를 끈다). 내 장인만, 이미 봤으면 변화 없음. */
export async function markArtisanSeen(db: Pick<Database, "update">, userId: string, artisanCode: string, now: Date): Promise<void> {
  await db
    .update(userArtisans)
    .set({ seenAt: now })
    .where(and(eq(userArtisans.userId, userId), eq(userArtisans.artisanCode, artisanCode), isNull(userArtisans.seenAt)));
}
