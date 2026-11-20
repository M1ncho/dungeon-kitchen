import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { TUTORIAL_RECIPE, fillTokens, stepDef } from "../../lib/game/tutorial";
import { db } from "../index";
import { getTutorial } from "../commands/tutorial";
import {
  criticVisits, dishZones, dungeonFloors, helpTopics, ingredientRequests, ingredients, profiles, salesSessions, tutorialLines, tutorialSettings, tutorialTips,
  userIngredients,
} from "../schema";
import { getExamAlert } from "./floors";
import { getSalesStatus } from "./stall";

// 모든 함수는 세션에서 얻은 userId 를 where 에 넣는다.
// 🔒 안내 주문의 목표 좌표 등 주문 내부 값은 여기서도 읽지 않는다 (주문 id 와 상태만).

export type TutorialLineView = { phase: string; seq: number; kind: "say" | "mission"; target: string; text: string };

export type TutorialPanel = {
  guide: { name: string; title: string };
  /** 진행 중인 안내 (없으면 null: 완료·건너뜀·기록 없음) */
  active: null | {
    step: string;
    kind: "info" | "action";
    routes: string[];
    /** 이 단계의 대사 (+ 길 안내 "nav") */
    lines: TutorialLineView[];
    /** 재료 시장 단계: 안내 수프 재료 중 갖춘 종류 수 (0~2) */
    marketHave: number;
    /** 첫 손님 대기 단계: 첫 틱이 끝나는 시각(ms) */
    waitUntilMs: number | null;
    serverNowMs: number;
  };
  /** 상황별 팁: 전체 문장, 이미 본 것, 서버가 지금 조건이 맞다고 본 것 */
  tips: { code: string; text: string }[];
  seenTips: string[];
  pendingTips: string[];
  /** 주방에서 잠긴 구역이 보이는가 (locked_zone 팁은 주방 화면에서만 띄운다) */
  lockedZones: boolean;
};

export async function getTutorialPanel(userId: string, serverNowMs: number): Promise<TutorialPanel> {
  const [tut, [settings], tips] = await Promise.all([
    getTutorial(db, userId),
    db.select().from(tutorialSettings),
    db.select().from(tutorialTips).orderBy(asc(tutorialTips.sort)),
  ]);
  const seen = tut?.seenTips ?? [];
  const guide = { name: settings?.guideName ?? "바르둔", title: settings?.guideTitle ?? "상업 조합장" };

  // 상황별 팁 조건 (서버가 판단): 희귀 재료 보유, 승급 시험 손님 대기, 영업 중 품절, 잠긴 구역이 있는가
  const unseen = tips.filter((t) => !seen.includes(t.code)).map((t) => t.code);
  const pending: string[] = [];
  let lockedZones = false;
  if (unseen.length > 0) {
    const [rare, exam, status, locked, requested, reviewed] = await Promise.all([
      unseen.includes("rare_ingredient")
        ? db
            .select({ id: userIngredients.ingredientId })
            .from(userIngredients)
            .innerJoin(ingredients, eq(ingredients.id, userIngredients.ingredientId))
            .where(and(eq(userIngredients.userId, userId), ne(ingredients.rarity, "common")))
            .limit(1)
        : Promise.resolve([]),
      unseen.includes("exam_waiting") ? getExamAlert(userId) : Promise.resolve(null),
      unseen.includes("sold_out") ? getSalesStatus(userId) : Promise.resolve(null),
      unseen.includes("locked_zone")
        ? db
            .select({ unlocked: profiles.unlockedFloor, deepest: sql<number>`(select max(${dishZones.unlockFloor}) from ${dishZones})::int` })
            .from(profiles)
            .where(eq(profiles.id, userId))
        : Promise.resolve([]),
      unseen.includes("first_request")
        ? db.select({ id: ingredientRequests.id }).from(ingredientRequests).where(eq(ingredientRequests.userId, userId)).limit(1)
        : Promise.resolve([]),
      unseen.includes("first_review")
        ? db.select({ id: criticVisits.id }).from(criticVisits).where(and(eq(criticVisits.userId, userId), eq(criticVisits.status, "published"))).limit(1)
        : Promise.resolve([]),
    ]);
    if (rare.length > 0) pending.push("rare_ingredient");
    if (exam) pending.push("exam_waiting");
    if (status?.state === "soldout") pending.push("sold_out");
    if (requested.length > 0) pending.push("first_request"); // 첫 의뢰를 붙였을 때
    if (reviewed.length > 0) pending.push("first_review"); // 첫 평론가의 평이 발행됐을 때
    lockedZones = !!locked[0] && locked[0].unlocked < locked[0].deepest;
  }

  const base = { guide, tips: tips.map((t) => ({ code: t.code, text: t.text })), seenTips: seen, pendingTips: pending, lockedZones };
  if (!tut || tut.status !== "active") return { ...base, active: null };

  const def = stepDef(tut.step);
  if (!def) return { ...base, active: null };

  const lineRows = await db.select().from(tutorialLines).where(eq(tutorialLines.step, tut.step)).orderBy(asc(tutorialLines.seq));
  const vars = await tokenValues(userId);
  const lines: TutorialLineView[] = lineRows.map((l) => ({
    phase: l.phase, seq: l.seq, kind: l.kind as "say" | "mission", target: l.target, text: fillTokens(l.text, vars),
  }));

  let marketHave = 0;
  if (tut.step === "market_buy") {
    const rows = await db
      .select({ code: ingredients.code, quantity: userIngredients.quantity })
      .from(userIngredients)
      .innerJoin(ingredients, eq(ingredients.id, userIngredients.ingredientId))
      .where(and(eq(userIngredients.userId, userId), inArray(ingredients.code, [...TUTORIAL_RECIPE.ingredients])));
    marketHave = rows.filter((r) => r.quantity >= 1).length;
  }
  let waitUntilMs: number | null = null;
  if (tut.step === "wait_sale") {
    const [s] = await db
      .select({ startedAt: salesSessions.startedAt, tickSeconds: salesSessions.tickSeconds })
      .from(salesSessions)
      .where(and(eq(salesSessions.userId, userId), eq(salesSessions.isTutorial, true)));
    if (s) waitUntilMs = s.startedAt.getTime() + s.tickSeconds * 1000;
  }
  return { ...base, active: { step: tut.step, kind: def.kind, routes: [...def.routes], lines, marketHave, waitUntilMs, serverNowMs } };
}

/** 대사 안의 {floor} {nextFloor} {nextRep} 에 들어갈 실제 값. */
async function tokenValues(userId: string): Promise<Record<string, string | number>> {
  const [prof] = await db.select({ unlocked: profiles.unlockedFloor }).from(profiles).where(eq(profiles.id, userId));
  const floors = await db.select({ floorNo: dungeonFloors.floorNo, rep: dungeonFloors.unlockReputation }).from(dungeonFloors).orderBy(asc(dungeonFloors.floorNo));
  const unlocked = prof?.unlocked ?? 1;
  const next = floors.find((f) => f.floorNo === unlocked + 1);
  return { floor: unlocked, nextFloor: next?.floorNo ?? unlocked, nextRep: next?.rep ?? 0 };
}

// ───── 도움말 ─────

export type HelpData = {
  guide: { name: string; title: string };
  topics: { code: string; title: string; body: string }[];
  /** 지금까지 본 상황별 팁 (본 순서 무관, 정렬 순) */
  seenTips: { code: string; text: string }[];
};

export async function getHelpData(userId: string): Promise<HelpData> {
  const [tut, [settings], topics, tips] = await Promise.all([
    getTutorial(db, userId),
    db.select().from(tutorialSettings),
    db.select().from(helpTopics).orderBy(asc(helpTopics.sort)),
    db.select().from(tutorialTips).orderBy(asc(tutorialTips.sort)),
  ]);
  const seen = new Set(tut?.seenTips ?? []);
  return {
    guide: { name: settings?.guideName ?? "바르둔", title: settings?.guideTitle ?? "상업 조합장" },
    topics: topics.map((t) => ({ code: t.code, title: t.title, body: t.body })),
    seenTips: tips.filter((t) => seen.has(t.code)).map((t) => ({ code: t.code, text: t.text })),
  };
}
