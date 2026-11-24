import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../index";
import { artisans, cookingMethods, dishZones, dungeonFloors, ingredients, profiles, shops, userArtisans, userDishes, userIngredients } from "../schema";

// 모든 함수는 세션에서 얻은 userId 를 where 에 넣는다.

export type ArtisanView = {
  code: string;
  floorNo: number;
  name: string;
  title: string;
  toolName: string;
  methodCode: string;
  methodName: string;
  methodDescription: string;
  /** request = 부탁 대기(도구 없음), owned = 도구 보유 */
  state: "request" | "owned";
  /** 장인 화면을 아직 본 적이 없다 (처음 만남: 등장 대사를 보여 준다) */
  unseen: boolean;
  greeting: string;
  idleText: string;
  usageText: string;
  gold: number;
  request: {
    zoneName: string;
    minQuality: number;
    count: number;
    /** 창고에서 낼 수 있는 요리 (구역·품질 조건에 맞는 것, 같은 이름·품질끼리 묶음) */
    candidates: { dishId: string; name: string; quality: number; count: number }[];
    text: string;
    thanksText: string;
  };
  tool: {
    level: number;
    /** 다음 강화 (최대 단계면 null) */
    next: { gold: number; items: { name: string; qty: number; have: number }[]; text: string; label: string } | null;
    /** 지금까지 강화로 얻은 효과 문장 */
    perks: string[];
    upgradeTexts: string[];
  } | null;
};

const PERKS: Record<string, string[]> = {
  ferment: ["같은 요리에 발효 2회", "쓸 때마다 확대 배율 선택 (×1.15 / ×1.3 / ×1.45)"],
  smoke: ["같은 요리에 훈연 2회", "쓸 때마다 회전 각도 선택 (15° / 30° / 45°)"],
  grind: ["같은 요리에 갈기 2회", "한 번 갈면 다음 재료 2개에 적용"],
  steam: ["같은 요리에 찌기 2회", "쓸 때마다 끌어당김 선택 (15% / 20% / 25%)"],
};

/** 지금 가게가 있는 층의 장인 (아직 등장하지 않았으면 null). 장인 화면과 홈 카드가 쓴다. */
export async function getArtisanView(userId: string): Promise<ArtisanView | null> {
  const [row] = await db
    .select({ a: artisans, ua: userArtisans, methodName: cookingMethods.name, methodDescription: cookingMethods.description })
    .from(shops)
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
    .innerJoin(artisans, eq(artisans.floorNo, dungeonFloors.floorNo))
    .innerJoin(userArtisans, and(eq(userArtisans.artisanCode, artisans.code), eq(userArtisans.userId, userId)))
    .innerJoin(cookingMethods, eq(cookingMethods.code, artisans.methodCode))
    .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
  if (!row) return null;
  const { a, ua } = row;
  const [prof] = await db.select({ gold: profiles.gold }).from(profiles).where(eq(profiles.id, userId));
  const [zone] = await db.select({ id: dishZones.id, name: dishZones.name }).from(dishZones).where(eq(dishZones.code, a.requestZoneCode));

  const owned = ua.toolLevel !== null;
  let candidates: ArtisanView["request"]["candidates"] = [];
  if (!owned && zone) {
    const rows = await db
      .select({
        dishId: sql<string>`(array_agg(${userDishes.id} order by ${userDishes.createdAt}, ${userDishes.id}))[1]`,
        name: userDishes.name, quality: userDishes.quality, count: sql<number>`count(*)::int`,
      })
      .from(userDishes)
      .where(and(
        eq(userDishes.userId, userId), isNotNull(userDishes.collectedAt), isNull(userDishes.displayId), isNull(userDishes.soldAt),
        eq(userDishes.zoneId, zone.id), gte(userDishes.quality, a.requestMinQuality),
      ))
      .groupBy(userDishes.name, userDishes.quality)
      .orderBy(desc(userDishes.quality), asc(userDishes.name));
    candidates = rows;
  }

  let tool: ArtisanView["tool"] = null;
  if (owned) {
    const level = ua.toolLevel ?? 0;
    const cost = level < 2 ? a.upgrades[level] : undefined;
    let next: NonNullable<ArtisanView["tool"]>["next"] = null;
    if (cost) {
      const codes = cost.items.map((i) => i.ingredient);
      const [ings, have] = await Promise.all([
        db.select({ id: ingredients.id, code: ingredients.code, name: ingredients.name }).from(ingredients).where(inArray(ingredients.code, codes)),
        db.select({ id: userIngredients.ingredientId, qty: userIngredients.quantity }).from(userIngredients).where(eq(userIngredients.userId, userId)),
      ]);
      const haveById = new Map(have.map((h) => [h.id, h.qty]));
      next = {
        gold: cost.gold,
        items: cost.items.map((i) => {
          const ing = ings.find((x) => x.code === i.ingredient);
          return { name: ing?.name ?? i.ingredient, qty: i.qty, have: ing ? (haveById.get(ing.id) ?? 0) : 0 };
        }),
        text: a.upgradeTexts[level] ?? "",
        label: level === 0 ? "1단계 강화" : "2단계 강화",
      };
    }
    tool = { level, next, perks: (PERKS[a.methodCode] ?? []).slice(0, level), upgradeTexts: a.upgradeTexts };
  }

  return {
    code: a.code, floorNo: a.floorNo, name: a.name, title: a.title, toolName: a.toolName, methodCode: a.methodCode,
    methodName: row.methodName, methodDescription: row.methodDescription,
    state: owned ? "owned" : "request",
    unseen: ua.seenAt === null,
    greeting: a.greeting, idleText: a.idleText, usageText: a.usageText, gold: prof?.gold ?? 0,
    request: { zoneName: zone?.name ?? "", minQuality: a.requestMinQuality, count: a.requestCount, candidates, text: a.requestText, thanksText: a.thanksText },
    tool,
  };
}

/** 홈 카드·레일 뱃지용: 지금 층의 장인이 있으면 이름과 상태, 아직 안 본 새 장인이면 unseen. */
export async function getArtisanAlert(userId: string): Promise<{ code: string; name: string; floorNo: number; state: "request" | "owned"; unseen: boolean } | null> {
  const [row] = await db
    .select({ code: artisans.code, name: artisans.name, floorNo: artisans.floorNo, level: userArtisans.toolLevel, seenAt: userArtisans.seenAt })
    .from(shops)
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
    .innerJoin(artisans, eq(artisans.floorNo, dungeonFloors.floorNo))
    .innerJoin(userArtisans, and(eq(userArtisans.artisanCode, artisans.code), eq(userArtisans.userId, userId)))
    .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
  if (!row) return null;
  return { code: row.code, name: row.name, floorNo: row.floorNo, state: row.level === null ? "request" : "owned", unseen: row.seenAt === null };
}

/** 주방용: 도구 조리법을 어느 층 장인에게서 얻는지 (없는 도구의 실루엣 문구) */
export async function getToolSources(): Promise<Record<string, { floorNo: number; toolName: string; artisanName: string }>> {
  const rows = await db.select({ code: artisans.methodCode, floorNo: artisans.floorNo, toolName: artisans.toolName, artisanName: artisans.name }).from(artisans);
  return Object.fromEntries(rows.map((r) => [r.code, { floorNo: r.floorNo, toolName: r.toolName, artisanName: r.artisanName }]));
}
