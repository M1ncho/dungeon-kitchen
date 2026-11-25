import { config } from "dotenv";
import { notInArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  cookingMethods, cookingSettings, customerTypes, dishModifiers, dishZones, dungeonFloors, floorIngredients, ingredients,
  customerFloorWeights, helpTopics, marketSettings, orderSettings, orderTexts, peddlerRules, salesSettings, tutorialLines, tutorialSettings,
  tutorialTips, peddlerLines, artisans, artisanTools as artisanToolsTable, requestSettings, requestTexts, criticSettings, criticTexts,
} from "./schema";
import * as schema from "./schema";
import { COOKING_SETTINGS, METHODS, MODIFIERS, ZONES } from "./seed-data/cooking";
import { CUSTOMER_ORDER_PROFILES, ORDER_SETTINGS, ORDER_TEXTS } from "./seed-data/orders";
import { CUSTOMER_FLOOR_WEIGHTS, CUSTOMER_TASTES, SALES_SETTINGS } from "./seed-data/sales";
import { EXAM_SETTINGS, FLOORS, FLOOR_DROPS, NEW_CUSTOMERS, PEDDLER_ORIGIN_WEIGHTS, PEDDLER_RULES, SUPERVISORS } from "./seed-data/floors";
import { REQUEST_SETTINGS, REQUEST_TEXTS } from "./seed-data/requests";
import { ARTISANS, artisanTools } from "./seed-data/artisans";
import { PEDDLER_LINES } from "./seed-data/peddler-lines";
import { CRITIC_SETTINGS, CRITIC_TEXTS, FLOOR_CRITIC_STRICTNESS } from "./seed-data/critic";
import { HELP_TOPICS, TUTORIAL_CUSTOMER, TUTORIAL_LINES, TUTORIAL_SETTINGS, TUTORIAL_TIPS } from "./seed-data/tutorial";
import { BASE_PRICES, INGREDIENTS, INGREDIENT_FLOORS, SHORT_NAMES, STAPLES } from "./seed-data/ingredients";

// 마스터 데이터 시드. 재료/층/손님은 code(또는 floor_no) 기준 upsert 이므로
// 수치를 고치고 다시 실행하면 DB 에 반영된다.

// [code, name, race, job, icon, heat, umami, sweet, mana, toxin, budgetMin, budgetMax, spawnWeight]
const CUSTOMERS: [string, string, string, string, string, number, number, number, number, number, number, number, number][] = [
  ["human_warrior", "인간 전사", "인간", "전사", "sword", 4, 6, 1, -2, -6, 20, 60, 30],
  ["elf_mage", "엘프 마법사", "엘프", "마법사", "wand-sparkles", -2, 2, 4, 9, -4, 30, 90, 15],
  ["dwarf_miner", "드워프 광부", "드워프", "광부", "pickaxe", 6, 7, 0, -3, 0, 15, 50, 25],
  ["halfling_thief", "하플링 도적", "하플링", "도적", "ghost", 1, 3, 8, 0, 3, 10, 40, 20],
  ["orc_berserker", "오크 광전사", "오크", "광전사", "axe", 8, 5, -2, -4, 5, 20, 70, 10],
  ["beast_hunter", "수인 사냥꾼", "수인", "사냥꾼", "crosshair", 3, 8, 2, 1, -3, 25, 80, 15],
  // 성장 1단계: 새 손님 유형 (예산·옛 속성 선호는 판매 판단에 쓰지 않는다)
  ...NEW_CUSTOMERS.map(([code, name, race, job, icon]) => [code, name, race, job, icon, 0, 0, 0, 0, 0, 20, 120, 10] as [string, string, string, string, string, number, number, number, number, number, number, number, number]),
  // 층 시험 감독관 (일반 손님 가중치 표에는 없다)
  ...SUPERVISORS.map(([code, name, race, job, icon]) => [code, name, race, job, icon, 0, 0, 0, 0, 0, 0, 0, 1] as [string, string, string, string, string, number, number, number, number, number, number, number, number]),
];
// 첫 플레이 안내의 주문 손님(조합장 본인): 일반 손님 가중치 표에는 넣지 않는다 (seed-data/tutorial.ts)
CUSTOMERS.push([TUTORIAL_CUSTOMER.code, TUTORIAL_CUSTOMER.name, TUTORIAL_CUSTOMER.race, TUTORIAL_CUSTOMER.job, TUTORIAL_CUSTOMER.icon, 0, 0, 0, 0, 0, 0, 0, 1]);
const ORDER_PROFILES: Record<string, { style: string; customBasePrice: number; regions: { cx: number; cy: number; r: number; w: number; minFloor?: number }[] }> = {
  ...CUSTOMER_ORDER_PROFILES,
  [TUTORIAL_CUSTOMER.code]: { style: TUTORIAL_CUSTOMER.style, customBasePrice: TUTORIAL_CUSTOMER.customBasePrice, regions: TUTORIAL_CUSTOMER.regions.map((r) => ({ ...r })) },
};
const EXAM_FLOOR_OF = new Map(SUPERVISORS.map(([code, , , , , floor]) => [code, floor]));

const excluded = (col: string) => sql.raw(`excluded."${col}"`);

export async function seedWorld(db: PgDatabase<PgQueryResultHKT, typeof schema>) {
  await db.transaction(async (tx) => {
    await tx
      .insert(dungeonFloors)
      .values(FLOORS.map((f) => ({ ...f, criticStrictnessBp: FLOOR_CRITIC_STRICTNESS[f.floorNo] ?? 10000 })))
      .onConflictDoUpdate({
        target: dungeonFloors.floorNo,
        set: {
          name: excluded("name"),
          description: excluded("description"),
          durationSeconds: excluded("duration_seconds"),
          dangerLevel: excluded("danger_level"),
          theme: excluded("theme"),
          unlockReputation: excluded("unlock_reputation"),
          moveCost: excluded("move_cost"),
          priceMultiplier: excluded("price_multiplier"),
          orderSpawnBp: excluded("order_spawn_bp"),
          orderJudgeScale: excluded("order_judge_scale"),
          qualityFlatScale: excluded("quality_flat_scale"),
          normalPenalty: excluded("normal_penalty"),
          criticStrictnessBp: excluded("critic_strictness_bp"),
        },
      });

    const ingredientRows = [
      ...INGREDIENTS.map(([code, name, icon, rarity, heat, umami, sweet, mana, toxin, description]) => ({
        code, name, icon, rarity, heat, umami, sweet, mana, toxin, description,
        shortName: SHORT_NAMES[code] ?? name, basePrice: BASE_PRICES[code] ?? 0, isStaple: false,
        unlockFloor: INGREDIENT_FLOORS[code] ?? 1,
      })),
      ...STAPLES.map(([code, name, icon, heat, umami, sweet, mana, toxin, basePrice, description]) => ({
        code, name, icon, rarity: "common" as const, heat, umami, sweet, mana, toxin, description,
        shortName: SHORT_NAMES[code] ?? name, basePrice, isStaple: true,
        unlockFloor: INGREDIENT_FLOORS[code] ?? 1,
      })),
    ];
    await tx
      .insert(ingredients)
      .values(ingredientRows)
      .onConflictDoUpdate({
        target: ingredients.code,
        set: {
          name: excluded("name"), shortName: excluded("short_name"), icon: excluded("icon"), rarity: excluded("rarity"),
          heat: excluded("heat"), umami: excluded("umami"), sweet: excluded("sweet"),
          mana: excluded("mana"), toxin: excluded("toxin"), description: excluded("description"),
          basePrice: excluded("base_price"), isStaple: excluded("is_staple"), unlockFloor: excluded("unlock_floor"),
        },
      });

    const floorRows = await tx.select({ id: dungeonFloors.id, floorNo: dungeonFloors.floorNo }).from(dungeonFloors);
    const ingRows = await tx.select({ id: ingredients.id, code: ingredients.code }).from(ingredients);
    const floorId = new Map(floorRows.map((r) => [r.floorNo, r.id]));
    const ingId = new Map(ingRows.map((r) => [r.code, r.id]));

    // 행상 품목표는 월드 데이터이므로 통째로 다시 만든다 (층 개편으로 빠진 품목이 남지 않게)
    await tx.delete(floorIngredients);
    await tx
      .insert(floorIngredients)
      .values(
        FLOOR_DROPS.map(([floorNo, code, weight]) => ({
          floorId: floorId.get(floorNo)!,
          ingredientId: ingId.get(code)!,
          weight,
        })),
      )
      .onConflictDoUpdate({
        target: [floorIngredients.floorId, floorIngredients.ingredientId],
        set: { weight: excluded("weight") },
      });

    // 행상 설정: 슬롯 길이 1시간, 슬롯당 2명 (서로 다른 층)
    await tx
      .insert(marketSettings)
      .values({
        id: 1, slotSeconds: 3600, peddlersPerSlot: 2,
        originSameWeight: PEDDLER_ORIGIN_WEIGHTS.same, originDeeperWeight: PEDDLER_ORIGIN_WEIGHTS.deeper,
        originShallowerWeight: PEDDLER_ORIGIN_WEIGHTS.shallower,
      })
      .onConflictDoUpdate({
        target: marketSettings.id,
        set: {
          slotSeconds: excluded("slot_seconds"), peddlersPerSlot: excluded("peddlers_per_slot"),
          originSameWeight: excluded("origin_same_weight"), originDeeperWeight: excluded("origin_deeper_weight"),
          originShallowerWeight: excluded("origin_shallower_weight"),
        },
      });

    await tx
      .insert(peddlerRules)
      .values(
        PEDDLER_RULES.map(([floorNo, itemsMin, itemsMax, qtyMin, qtyMax, rareBp, legendaryBp, priceMinPct, priceMaxPct]) => ({
          floorId: floorId.get(floorNo)!,
          itemsMin, itemsMax, qtyMin, qtyMax, rareBp, legendaryBp, priceMinPct, priceMaxPct,
        })),
      )
      .onConflictDoUpdate({
        target: peddlerRules.floorId,
        set: {
          itemsMin: excluded("items_min"), itemsMax: excluded("items_max"),
          qtyMin: excluded("qty_min"), qtyMax: excluded("qty_max"), rareBp: excluded("rare_bp"),
          legendaryBp: excluded("legendary_bp"), priceMinPct: excluded("price_min_pct"), priceMaxPct: excluded("price_max_pct"),
        },
      });

    // 조리 설정·조리법·요리 구역·수식어 (code 기준 upsert)
    await tx
      .insert(cookingSettings)
      .values({ id: 1, ...COOKING_SETTINGS })
      .onConflictDoUpdate({
        target: cookingSettings.id,
        set: {
          kScale: excluded("k_scale"), mapLimit: excluded("map_limit"), toxinLimit: excluded("toxin_limit"),
          minIngredients: excluded("min_ingredients"), maxIngredients: excluded("max_ingredients"),
          diluentCode: excluded("diluent_code"), diluentPullBp: excluded("diluent_pull_bp"),
          diluentToxinDelta: excluded("diluent_toxin_delta"), agingSeconds: excluded("aging_seconds"),
          perfectRatio: excluded("perfect_ratio"), goodRatio: excluded("good_ratio"),
          maxMethodUses: excluded("max_method_uses"), secondUseBp: excluded("second_use_bp"), grindMaxAffected: excluded("grind_max_affected"),
        },
      });
    await tx
      .insert(cookingMethods)
      .values(METHODS.map((m) => ({ ...m })))
      .onConflictDoUpdate({
        target: cookingMethods.code,
        set: {
          name: excluded("name"), dx: excluded("dx"), dy: excluded("dy"), pullBp: excluded("pull_bp"),
          toxinDelta: excluded("toxin_delta"), aging: excluded("aging"), sortOrder: excluded("sort_order"),
          description: excluded("description"),
          agingSeconds: excluded("aging_seconds"), kind: excluded("kind"), param: excluded("param"), zeroToxin: excluded("zero_toxin"),
          tool: excluded("tool"), usesByLevel: excluded("uses_by_level"), sizes: excluded("sizes"), nextCountByLevel: excluded("next_count_by_level"),
          sizeToxin: excluded("size_toxin"), secondToxinDelta: excluded("second_toxin_delta"), agingByLevel: excluded("aging_by_level"),
        },
      });
    await tx
      .insert(dishZones)
      .values(ZONES.map((z) => ({ ...z })))
      .onConflictDoUpdate({
        target: dishZones.code,
        set: {
          name: excluded("name"), unlockFloor: excluded("unlock_floor"), centerX: excluded("center_x"), centerY: excluded("center_y"), radius: excluded("radius"),
          signature: excluded("signature"), effectName: excluded("effect_name"), effectDesc: excluded("effect_desc"),
          description: excluded("description"),
        },
      });
    await tx
      .insert(dishModifiers)
      .values(MODIFIERS.map((m) => ({ ...m })))
      .onConflictDoUpdate({
        target: dishModifiers.code,
        set: { direction: excluded("direction"), word: excluded("word"), minDistance: excluded("min_distance") },
      });

    await tx
      .insert(customerTypes)
      .values(
        CUSTOMERS.map(([code, name, race, job, icon, prefHeat, prefUmami, prefSweet, prefMana, prefToxin, budgetMin, budgetMax, spawnWeight]) => ({
          code, name, race, job, icon, prefHeat, prefUmami, prefSweet, prefMana, prefToxin, budgetMin, budgetMax, spawnWeight,
          preferredZones: CUSTOMER_TASTES[code]?.preferred ?? [],
          avoidedZones: CUSTOMER_TASTES[code]?.avoided ?? [],
          toxicPrefMin: CUSTOMER_TASTES[code]?.toxicPrefMin ?? null,
          orderStyle: ORDER_PROFILES[code]?.style ?? "plain",
          customBasePrice: ORDER_PROFILES[code]?.customBasePrice ?? 30,
          orderRegions: ORDER_PROFILES[code]?.regions ?? [],
          examFloor: EXAM_FLOOR_OF.get(code) ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: customerTypes.code,
        set: {
          name: excluded("name"), race: excluded("race"), job: excluded("job"), icon: excluded("icon"),
          prefHeat: excluded("pref_heat"), prefUmami: excluded("pref_umami"), prefSweet: excluded("pref_sweet"),
          prefMana: excluded("pref_mana"), prefToxin: excluded("pref_toxin"),
          budgetMin: excluded("budget_min"), budgetMax: excluded("budget_max"), spawnWeight: excluded("spawn_weight"),
          preferredZones: excluded("preferred_zones"), avoidedZones: excluded("avoided_zones"), toxicPrefMin: excluded("toxic_pref_min"),
          orderStyle: excluded("order_style"), customBasePrice: excluded("custom_base_price"), orderRegions: excluded("order_regions"),
          examFloor: excluded("exam_floor"),
        },
      });

    // 영업 설정, 층별 손님 가중치
    await tx
      .insert(salesSettings)
      .values({ id: 1, ...SALES_SETTINGS })
      .onConflictDoUpdate({
        target: salesSettings.id,
        set: {
          displaySlots: excluded("display_slots"), tickSeconds: excluded("tick_seconds"),
          maxSessionSeconds: excluded("max_session_seconds"), priceMinPct: excluded("price_min_pct"),
          priceMaxPct: excluded("price_max_pct"), priceMultiplier: excluded("price_multiplier"),
          customersMin: excluded("customers_min"), customersMax: excluded("customers_max"),
          preferBonus: excluded("prefer_bonus"), avoidPenalty: excluded("avoid_penalty"),
          burdenSlope: excluded("burden_slope"), discountSlope: excluded("discount_slope"),
          reliefGood: excluded("relief_good"), reliefPerfect: excluded("relief_perfect"),
          flatGood: excluded("flat_good"), flatPerfect: excluded("flat_perfect"),
          buyBase: excluded("buy_base"), buyScale: excluded("buy_scale"),
          repGood: excluded("rep_good"), repPerfect: excluded("rep_perfect"), repPreferred: excluded("rep_preferred"),
        },
      });
    // 주문 손님 설정·문장 사전
    await tx
      .insert(orderSettings)
      .values({ id: 1, ...ORDER_SETTINGS, examWaitSeconds: EXAM_SETTINGS.waitSeconds, examRetrySeconds: EXAM_SETTINGS.retrySeconds })
      .onConflictDoUpdate({
        target: orderSettings.id,
        set: Object.fromEntries(
          [...Object.keys(ORDER_SETTINGS), "examWaitSeconds", "examRetrySeconds"].map((k) => [k, excluded(k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))]),
        ) as never,
      });
    await tx
      .insert(orderTexts)
      .values(ORDER_TEXTS)
      .onConflictDoUpdate({
        target: orderTexts.code,
        set: { kind: excluded("kind"), key: excluded("key"), style: excluded("style"), text: excluded("text") },
      });
    // 첫 플레이 안내: 설정, 대사, 상황별 팁, 도움말 (code 기준 upsert, 문장은 이 파일들을 고치고 다시 시드)
    await tx
      .insert(tutorialSettings)
      .values({ id: 1, ...TUTORIAL_SETTINGS })
      .onConflictDoUpdate({
        target: tutorialSettings.id,
        set: { guideName: excluded("guide_name"), guideTitle: excluded("guide_title"), firstTickSeconds: excluded("first_tick_seconds"), orderJudgeScale: excluded("order_judge_scale") },
      });
    await tx
      .insert(tutorialLines)
      .values(TUTORIAL_LINES.map((l) => ({ ...l, code: `${l.step}.${l.phase || "main"}.${l.seq}` })))
      .onConflictDoUpdate({
        target: tutorialLines.code,
        set: { step: excluded("step"), phase: excluded("phase"), seq: excluded("seq"), kind: excluded("kind"), target: excluded("target"), text: excluded("text") },
      });
    await tx
      .insert(tutorialTips)
      .values(TUTORIAL_TIPS.map((t) => ({ ...t })))
      .onConflictDoUpdate({ target: tutorialTips.code, set: { sort: excluded("sort"), text: excluded("text") } });
    await tx
      .insert(helpTopics)
      .values(HELP_TOPICS.map((t) => ({ ...t })))
      .onConflictDoUpdate({ target: helpTopics.code, set: { sort: excluded("sort"), title: excluded("title"), body: excluded("body") } });
    // 의뢰 게시판: 설정과 모험가 한마디 (code 기준 upsert)
    await tx
      .insert(requestSettings)
      .values({ id: 1, ...REQUEST_SETTINGS })
      .onConflictDoUpdate({
        target: requestSettings.id,
        set: Object.fromEntries(Object.keys(REQUEST_SETTINGS).map((k) => [k, excluded(k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))])) as never,
      });
    await tx
      .insert(requestTexts)
      .values(REQUEST_TEXTS.map((t) => ({ ...t })))
      .onConflictDoUpdate({ target: requestTexts.code, set: { outcome: excluded("outcome"), speaker: excluded("speaker"), text: excluded("text") } });
    // 층별 장인과 도구 (code 기준 upsert, 빠진 code 는 지운다)
    await tx
      .insert(artisans)
      .values(ARTISANS.map((a) => { const { tools, ...row } = a; void tools; return row; }))
      .onConflictDoUpdate({
        target: artisans.code,
        set: Object.fromEntries(
          ["floor_no", "name", "title", "tool_name", "method_code", "request_zone_code", "request_min_quality", "request_count", "greeting", "request_text", "thanks_text", "usage_text", "idle_text", "upgrade_texts", "upgrades"].map((k) => [
            k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), excluded(k),
          ]),
        ) as never,
      });
    // 장인의 도구 (method_code 기준 upsert, 빠진 도구는 지운다)
    const toolRows = ARTISANS.flatMap((a) => artisanTools(a).map((t, i) => ({ methodCode: t.methodCode, artisanCode: a.code, toolName: t.toolName, sortOrder: i, upgradeTexts: t.upgradeTexts, upgrades: t.upgrades })));
    await tx
      .insert(artisanToolsTable)
      .values(toolRows)
      .onConflictDoUpdate({
        target: artisanToolsTable.methodCode,
        set: { artisanCode: excluded("artisan_code"), toolName: excluded("tool_name"), sortOrder: excluded("sort_order"), upgradeTexts: excluded("upgrade_texts"), upgrades: excluded("upgrades") },
      });
    await tx.delete(artisanToolsTable).where(notInArray(artisanToolsTable.methodCode, toolRows.map((t) => t.methodCode)));
    // 행상 한마디 (code 기준 upsert, 빠진 code 는 지운다)
    await tx
      .insert(peddlerLines)
      .values(PEDDLER_LINES.map((l) => ({ ...l })))
      .onConflictDoUpdate({ target: peddlerLines.code, set: { floorNo: excluded("floor_no"), kind: excluded("kind"), text: excluded("text") } });
    await tx.delete(peddlerLines).where(notInArray(peddlerLines.code, PEDDLER_LINES.map((l) => l.code)));
    // 미식 평론가: 설정과 평 문장 템플릿 (code 기준 upsert)
    await tx
      .insert(criticSettings)
      .values({ id: 1, ...CRITIC_SETTINGS })
      .onConflictDoUpdate({
        target: criticSettings.id,
        set: Object.fromEntries(Object.keys(CRITIC_SETTINGS).map((k) => [k, excluded(k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))])) as never,
      });
    await tx
      .insert(criticTexts)
      .values(CRITIC_TEXTS.map((t) => ({ ...t })))
      .onConflictDoUpdate({
        target: criticTexts.code,
        set: { kind: excluded("kind"), item: excluded("item"), tier: excluded("tier"), tag: excluded("tag"), text: excluded("text") },
      });
    // 이름이 바뀌거나 빠진 문장이 남지 않게, 이번 시드에 없는 code 는 지운다
    await tx.delete(criticTexts).where(notInArray(criticTexts.code, CRITIC_TEXTS.map((t) => t.code)));
    const customerRows = await tx.select({ id: customerTypes.id, code: customerTypes.code }).from(customerTypes);
    const customerId = new Map(customerRows.map((r) => [r.code, r.id]));
    const weightRows = Object.entries(CUSTOMER_FLOOR_WEIGHTS).flatMap(([floorNo, byCode]) =>
      Object.entries(byCode).map(([code, weight]) => ({
        floorId: floorId.get(Number(floorNo))!,
        customerTypeId: customerId.get(code)!,
        weight,
      })),
    );
    await tx.delete(customerFloorWeights); // 층 개편으로 빠진 손님이 남지 않게 통째로 다시 만든다
    await tx
      .insert(customerFloorWeights)
      .values(weightRows)
      .onConflictDoUpdate({
        target: [customerFloorWeights.floorId, customerFloorWeights.customerTypeId],
        set: { weight: excluded("weight") },
      });
  });
}

// CLI: `npm run db:seed`
async function main() {
  config({ path: ".env.local" });
  config();
  const { db } = await import("./index");
  try {
    await seedWorld(db);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(ingredients);
    console.log(`seed complete (ingredients: ${n})`);
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
