import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../index";
import { loadUserTools } from "../commands/cooking-data";
import { artisanTools, artisans, cookingMethods, dishZones, dungeonFloors, ingredients, profiles, shops, userArtisans, userDishes, userIngredients } from "../schema";

// 모든 함수는 세션에서 얻은 userId 를 where 에 넣는다.

export type ToolView = {
  methodCode: string;
  methodName: string;
  methodDescription: string;
  toolName: string;
  /** 강화 단계 (0/1/2). null 이면 아직 도구가 없다 (부탁 대기) */
  level: number | null;
  /** 다음 강화 (최대 단계거나 도구가 없으면 null) */
  next: { gold: number; items: { name: string; qty: number; have: number }[]; text: string; label: string; effect: string } | null;
  /** 지금까지 강화로 얻은 효과 문장 */
  perks: string[];
  upgradeTexts: string[];
};

export type ArtisanTab = { code: string; name: string; floorNo: number };

export type ArtisanView = {
  code: string;
  floorNo: number;
  name: string;
  title: string;
  /** request = 부탁 대기(도구 없음), owned = 도구 보유 (부탁이 없는 장인은 항상 owned) */
  state: "request" | "owned";
  /** 지금 가게가 이 장인의 층에 있다 (처음 만나는 부탁·납품은 이때만 할 수 있다) */
  atShop: boolean;
  /** 장인 화면을 아직 본 적이 없다 (처음 만남: 등장 대사를 보여 준다) */
  unseen: boolean;
  greeting: string;
  idleText: string;
  usageText: string;
  gold: number;
  /** 부탁 (부탁이 없는 장인은 null) */
  request: {
    zoneName: string;
    minQuality: number;
    count: number;
    /** 창고에서 낼 수 있는 요리 (구역·품질 조건에 맞는 것, 같은 이름·품질끼리 묶음) */
    candidates: { dishId: string; name: string; quality: number; count: number }[];
    text: string;
    thanksText: string;
  } | null;
  tools: ToolView[];
};

/** 강화 단계별 효과 문장 (index = 단계 − 1). 2회째 효과 비율과 화구 칸 규칙은 seed-data/cooking.ts 의 설정 */
const SECOND = "(2회째는 효과 1/3)";
const PERKS: Record<string, string[]> = {
  grill: [`같은 요리에 굽기 2회 ${SECOND}`, "쓸 때마다 불 세기 선택 (이동량 ×0.8 / ×1 / ×1.2)"],
  boil: [`같은 요리에 끓이기 2회 ${SECOND}, 2회째는 독성 감소 없음`, "쓸 때마다 불 세기 선택 (당김 12 / 15 / 18%, 독성 −2 / −3 / −4)"],
  fry: [`같은 요리에 튀기기 2회 ${SECOND}`, "쓸 때마다 선택 (이동량 ×0.8 / ×1 / ×1.2, 약하게 튀기면 독성 증가 없음)"],
  pickle: [`같은 요리에 절이기 2회 ${SECOND}`, "쓸 때마다 선택 (이동량 ×0.8 / ×1 / ×1.2), 숙성 시간 −30% (10분 → 7분)"],
  ferment: [`같은 요리에 발효 2회 ${SECOND}`, "쓸 때마다 확대 배율 선택 (×1.15 / ×1.3 / ×1.45)"],
  smoke: [`같은 요리에 훈연 2회 ${SECOND}`, "쓸 때마다 회전 각도 선택 (15° / 30° / 45°)"],
  grind: [`같은 요리에 갈기 2회 (한 요리에서 영향받는 재료는 합쳐 최대 2개)`, "한 번 갈면 다음 재료 2개에 적용"],
  steam: [`같은 요리에 찌기 2회 ${SECOND}`, "쓸 때마다 끌어당김 선택 (15% / 20% / 25%)"],
};

/** 다음 강화가 무엇을 열어 주는지 (강화 카드 문구) */
function nextEffect(methodCode: string, level: number): string {
  return PERKS[methodCode]?.[level] ?? "";
}

/**
 * 장인 화면 데이터. 만날 수 있는 장인(= 도구를 받은 층의 장인, 부탁 없는 장인, 지금 가게가 있는 층의 장인)의 탭 목록과, 고른 장인의 화면.
 * 처음 만나는 부탁·납품은 가게가 그 층에 있을 때만 가능하고, 이미 도구를 받은 장인의 공방은 가게가 어느 층에 있든 찾아갈 수 있다.
 */
export async function getArtisanScreen(userId: string, requestedCode?: string | null): Promise<{ tabs: ArtisanTab[]; view: ArtisanView | null; shopFloorNo: number | null }> {
  const [shopRow] = await db
    .select({ floorNo: dungeonFloors.floorNo })
    .from(shops)
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
    .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
  const shopFloorNo = shopRow?.floorNo ?? null;

  const rows = await db
    .select({ a: artisans, ua: userArtisans })
    .from(userArtisans)
    .innerJoin(artisans, eq(artisans.code, userArtisans.artisanCode))
    .where(eq(userArtisans.userId, userId))
    .orderBy(asc(artisans.floorNo));
  const visitable = rows.filter((r) => r.ua.toolLevel !== null || r.a.floorNo === shopFloorNo);
  const tabs: ArtisanTab[] = visitable.map((r) => ({ code: r.a.code, name: r.a.name, floorNo: r.a.floorNo }));
  const pick =
    visitable.find((r) => r.a.code === requestedCode) ??
    visitable.find((r) => r.a.floorNo === shopFloorNo) ??
    visitable[0];
  if (!pick) return { tabs, view: null, shopFloorNo };

  const { a, ua } = pick;
  const owned = ua.toolLevel !== null;
  const [[prof], toolRows, tools] = await Promise.all([
    db.select({ gold: profiles.gold }).from(profiles).where(eq(profiles.id, userId)),
    db
      .select({ t: artisanTools, methodName: cookingMethods.name, methodDescription: cookingMethods.description })
      .from(artisanTools)
      .innerJoin(cookingMethods, eq(cookingMethods.code, artisanTools.methodCode))
      .where(eq(artisanTools.artisanCode, a.code))
      .orderBy(asc(artisanTools.sortOrder)),
    loadUserTools(db, userId),
  ]);

  let request: ArtisanView["request"] = null;
  if (a.requestZoneCode !== null && a.requestMinQuality !== null) {
    const [zone] = await db.select({ id: dishZones.id, name: dishZones.name }).from(dishZones).where(eq(dishZones.code, a.requestZoneCode));
    let candidates: NonNullable<ArtisanView["request"]>["candidates"] = [];
    if (!owned && zone) {
      candidates = await db
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
    }
    request = { zoneName: zone?.name ?? "", minQuality: a.requestMinQuality, count: a.requestCount, candidates, text: a.requestText, thanksText: a.thanksText };
  }

  // 다음 강화 재료의 이름·보유량
  const wanted = new Set<string>();
  for (const r of toolRows) for (const c of r.t.upgrades) for (const i of c.items) wanted.add(i.ingredient);
  const [ings, have] = owned && wanted.size > 0
    ? await Promise.all([
        db.select({ id: ingredients.id, code: ingredients.code, name: ingredients.name }).from(ingredients).where(inArray(ingredients.code, [...wanted])),
        db.select({ id: userIngredients.ingredientId, qty: userIngredients.quantity }).from(userIngredients).where(eq(userIngredients.userId, userId)),
      ])
    : [[], []];
  const haveById = new Map(have.map((h) => [h.id, h.qty]));

  const toolViews: ToolView[] = toolRows.map((r) => {
    // 부탁이 없는 장인의 기본 도구는 행이 없어도 0단계로 가진 것이다. 부탁이 있는 장인은 부탁을 들어줘야 도구가 있다.
    const level = owned ? (tools[r.t.methodCode] ?? 0) : null;
    const cost = level !== null && level < 2 ? r.t.upgrades[level] : undefined;
    return {
      methodCode: r.t.methodCode, methodName: r.methodName, methodDescription: r.methodDescription, toolName: r.t.toolName, level,
      next: cost && level !== null
        ? {
            gold: cost.gold,
            items: cost.items.map((i) => {
              const ing = ings.find((x) => x.code === i.ingredient);
              return { name: ing?.name ?? i.ingredient, qty: i.qty, have: ing ? (haveById.get(ing.id) ?? 0) : 0 };
            }),
            text: r.t.upgradeTexts[level] ?? "",
            label: level === 0 ? "1단계 강화" : "2단계 강화",
            effect: nextEffect(r.t.methodCode, level),
          }
        : null,
      perks: level === null ? [] : (PERKS[r.t.methodCode] ?? []).slice(0, level),
      upgradeTexts: r.t.upgradeTexts,
    };
  });

  return {
    tabs,
    shopFloorNo,
    view: {
      code: a.code, floorNo: a.floorNo, name: a.name, title: a.title,
      state: owned ? "owned" : "request",
      atShop: a.floorNo === shopFloorNo,
      unseen: ua.seenAt === null,
      greeting: a.greeting, idleText: a.idleText, usageText: a.usageText, gold: prof?.gold ?? 0,
      request, tools: toolViews,
    },
  };
}

export type ArtisanAlert = {
  /** 지금 층의 부탁 있는 장인 (아직 부탁을 안 들어줬거나 처음 만난 경우만 알림). 없으면 null */
  current: { code: string; name: string; floorNo: number; state: "request" | "owned"; unseen: boolean } | null;
  /** 공방(도구 강화)에 갈 수 있는 장인 수 */
  workshops: number;
};

/** 홈 카드·레일 뱃지용: 지금 층의 장인(부탁이 있는 장인만)과, 찾아갈 수 있는 공방 수. */
export async function getArtisanAlert(userId: string): Promise<ArtisanAlert> {
  const rows = await db
    .select({ code: artisans.code, name: artisans.name, floorNo: artisans.floorNo, hasRequest: sql<boolean>`${artisans.requestZoneCode} is not null`, level: userArtisans.toolLevel, seenAt: userArtisans.seenAt })
    .from(userArtisans)
    .innerJoin(artisans, eq(artisans.code, userArtisans.artisanCode))
    .where(eq(userArtisans.userId, userId));
  const [shopRow] = await db
    .select({ floorNo: dungeonFloors.floorNo })
    .from(shops)
    .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
    .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall")));
  const here = rows.find((r) => r.hasRequest && r.floorNo === shopRow?.floorNo);
  return {
    current: here ? { code: here.code, name: here.name, floorNo: here.floorNo, state: here.level === null ? "request" : "owned", unseen: here.seenAt === null } : null,
    workshops: rows.filter((r) => r.level !== null).length,
  };
}

/** 주방용: 각 조리법의 도구를 어느 층 장인에게서 얻는지·어디서 강화하는지 */
export async function getToolSources(): Promise<Record<string, { floorNo: number; toolName: string; artisanName: string; artisanCode: string; basic: boolean }>> {
  const rows = await db
    .select({ code: artisanTools.methodCode, floorNo: artisans.floorNo, toolName: artisanTools.toolName, artisanName: artisans.name, artisanCode: artisans.code, basic: sql<boolean>`${artisans.requestZoneCode} is null` })
    .from(artisanTools)
    .innerJoin(artisans, eq(artisans.code, artisanTools.artisanCode));
  return Object.fromEntries(rows.map((r) => [r.code, { floorNo: r.floorNo, toolName: r.toolName, artisanName: r.artisanName, artisanCode: r.artisanCode, basic: r.basic }]));
}
