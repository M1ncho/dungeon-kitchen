import { describe, expect, it } from "vitest";
import { HELP_TOPICS, TUTORIAL_CUSTOMER, TUTORIAL_LINES, TUTORIAL_SETTINGS, TUTORIAL_TIPS } from "../../db/seed-data/tutorial";
import { CUSTOMER_ORDER_PROFILES, ORDER_SETTINGS, ORDER_TEXTS } from "../../db/seed-data/orders";
import { ZONES } from "../../db/seed-data/cooking";
import { I, M, ing, sim } from "./cooking.fixtures";
import { buildDictionaries, generateOrder, judgeOrder } from "./orders";
import {
  DONE_STEP, STEP_IDS, TUTORIAL_CUSTOMER_CODE, TUTORIAL_RECIPE, TUTORIAL_STEPS, fillTokens, isInfoStep, kitchenPhase, nextStepId, onStepRoute, stallPhase,
} from "./tutorial";

const RECIPE = [I(TUTORIAL_RECIPE.ingredients[0]), I(TUTORIAL_RECIPE.ingredients[1]), M(TUTORIAL_RECIPE.method)];

describe("안내 수프 레시피 (기본 식재료로 계산)", () => {
  it("안내 순서대로 하면 반드시 수프 구역 안에서 완성되고 품질은 좋음 이상이다", () => {
    const r = sim(RECIPE);
    expect(r.canFinish).toBe(true);
    expect(r.zone?.code).toBe(TUTORIAL_RECIPE.zone);
    expect(r.quality).toBeGreaterThanOrEqual(2);
    expect(r.toxin).toBe(0);
  });

  it("실제로는 완벽(★3)이다: 끓이기까지 해도 구역 중심 근처", () => {
    const r = sim(RECIPE);
    expect(r.quality).toBe(3);
  });

  it("각 단계마다 안내 문장과 맞게 움직인다: 첫 재료는 구역 가장자리에 걸치고, 둘째 재료로 한가운데에 간다", () => {
    const soup = ZONES.find((z) => z.code === "soup")!;
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - soup.centerX, p.y - soup.centerY);
    const afterFirst = sim(RECIPE.slice(0, 1));
    const afterSecond = sim(RECIPE.slice(0, 2));
    const afterMethod = sim(RECIPE);
    expect(dist(afterFirst.position)).toBeLessThanOrEqual(soup.radius); // 이미 구역에 걸침
    expect(dist(afterSecond.position)).toBeLessThan(dist(afterFirst.position)); // 소금으로 한가운데에 가까워짐
    expect(afterMethod.zone?.code).toBe("soup"); // 끓이기 후에도 구역 안
  });

  it("재료는 모두 기본 식재료(언제든 살 수 있다)이고 재료비로 기준가가 정해진다", () => {
    for (const code of TUTORIAL_RECIPE.ingredients) expect(ing(code)).toBeDefined();
    expect(ZONES.some((z) => z.code === TUTORIAL_RECIPE.zone && z.unlockFloor === 1)).toBe(true);
  });

  it("안내 순서와 다르게 넣으면 완성 조건이 달라진다 (순서가 틀렸을 때 안내가 '처음부터'를 권하는 이유)", () => {
    const wrong = sim([I("salt"), I("salt"), M("fry")]);
    expect(wrong.zone?.code === "soup" && wrong.quality === 3).toBe(false);
  });
});

describe("안내 주문 (조합장)", () => {
  const dict = buildDictionaries(ORDER_TEXTS);
  const cfg = { ...ORDER_SETTINGS, toxCapMin: ORDER_SETTINGS.toxCapMax };
  const profile = { code: TUTORIAL_CUSTOMER.code, style: TUTORIAL_CUSTOMER.style, regions: TUTORIAL_CUSTOMER.regions.map((r) => ({ ...r })) };

  it("목표는 수프 구역 근처이고, 안내 수프(맞춤)로 항상 대성공 범위에 든다", () => {
    const soup = sim(RECIPE);
    for (let n = 0; n < 200; n++) {
      const o = generateOrder(`seed-${n}:tutorial`, profile, dict, cfg as never);
      expect(Math.hypot(o.target.x - 0, o.target.y - 30)).toBeLessThanOrEqual(6.5);
      const j = judgeOrder(o.target, soup.position, soup.toxin, "custom", cfg as never);
      expect(j.grade).toBe("great");
    }
  });

  it("있는 요리 내주기(수프)도 항상 '가까움'이다", () => {
    const soup = sim(RECIPE);
    for (let n = 0; n < 200; n++) {
      const o = generateOrder(`seed-${n}:tutorial`, profile, dict, cfg as never);
      const j = judgeOrder(o.target, soup.position, soup.toxin, "served_dish", cfg as never);
      expect(j.grade).toBe("close");
    }
  });

  it("독성 상한은 가장 느슨하고, 같은 시드는 같은 주문이다", () => {
    const a = generateOrder("s:tutorial", profile, dict, cfg as never);
    expect(a.target.toxinCap).toBe(ORDER_SETTINGS.toxCapMax);
    expect(generateOrder("s:tutorial", profile, dict, cfg as never)).toEqual(a);
  });

  it("조합장 말투가 시드 문장 사전에 있다", () => {
    expect(TUTORIAL_CUSTOMER.style).toBe("guildmaster");
    expect(ORDER_TEXTS.some((t) => t.style === "guildmaster" && t.kind === "template")).toBe(true);
    expect(ORDER_TEXTS.filter((t) => t.style === "guildmaster" && t.kind === "reaction").length).toBe(7);
    expect(CUSTOMER_ORDER_PROFILES[TUTORIAL_CUSTOMER.code]).toBeUndefined(); // 일반 손님 프로필 표에는 없다 (안내 전용)
    expect(TUTORIAL_CUSTOMER.code).toBe(TUTORIAL_CUSTOMER_CODE);
  });

  it("안내 주문의 판정 범위 배율은 1 이상(넉넉함)", () => {
    expect(TUTORIAL_SETTINGS.orderJudgeScale).toBeGreaterThanOrEqual(1);
    expect(TUTORIAL_SETTINGS.firstTickSeconds).toBeGreaterThan(0);
  });
});

describe("단계 그래프", () => {
  it("단계 id 는 중복이 없고 마지막 다음은 없다", () => {
    expect(new Set(STEP_IDS).size).toBe(STEP_IDS.length);
    expect(nextStepId(STEP_IDS[STEP_IDS.length - 1])).toBeNull();
    expect(nextStepId(DONE_STEP)).toBeNull();
    expect(nextStepId("nope")).toBeNull();
  });

  it("순서: 등록 인사 → 홈 → 시장 → 구매 → 조리 → 판매 → 주문 → 마무리", () => {
    expect(STEP_IDS).toEqual([
      "intro", "home", "market_info", "market_buy", "kitchen_cook", "kitchen_done", "stall_open", "wait_sale", "sale_done",
      "order_info", "order_serve", "order_done", "finale",
    ]);
  });

  it("행동 단계(서버 이벤트로만 넘어감)는 정보 단계로 취급되지 않는다", () => {
    for (const id of ["market_buy", "kitchen_cook", "stall_open", "wait_sale", "order_serve"]) expect(isInfoStep(id)).toBe(false);
    for (const id of ["intro", "home", "market_info", "kitchen_done", "sale_done", "order_info", "order_done", "finale"]) expect(isInfoStep(id)).toBe(true);
    expect(isInfoStep("nope")).toBe(false);
  });

  it("단계의 화면 판별", () => {
    expect(onStepRoute("home", "/")).toBe(true);
    expect(onStepRoute("home", "/market")).toBe(false);
    expect(onStepRoute("market_buy", "/market")).toBe(true);
    expect(onStepRoute("order_serve", "/kitchen")).toBe(true);
    expect(onStepRoute("order_serve", "/stall")).toBe(true);
    expect(onStepRoute("order_done", "/anything")).toBe(true); // 어느 화면에서나
    expect(onStepRoute("finale", "/floors")).toBe(true);
  });
});

describe("주방·포장마차 세부 단계", () => {
  const ids = { mushroom: 11, salt: 12 };
  const m = { type: "ingredient", id: 11 } as const;
  const s = { type: "ingredient", id: 12 } as const;
  const boil = { type: "method", code: "boil" } as const;
  const none = { ack1: false, ack2: false };
  const both = { ack1: true, ack2: true };

  it("안내 순서대로 진행하면 단계가 차례로 바뀐다", () => {
    expect(kitchenPhase([], ids, none)).toBe("pick1");
    expect(kitchenPhase([m], ids, none)).toBe("explain1");
    expect(kitchenPhase([m], ids, { ...none, ack1: true })).toBe("pick2");
    expect(kitchenPhase([m, s], ids, { ...none, ack1: true })).toBe("explain2");
    expect(kitchenPhase([m, s], ids, both)).toBe("method");
    expect(kitchenPhase([m, s, boil], ids, both)).toBe("finish");
  });
  it("순서가 다르거나 더 넣으면 off", () => {
    expect(kitchenPhase([s], ids, none)).toBe("off");
    expect(kitchenPhase([m, m], ids, both)).toBe("off");
    expect(kitchenPhase([m, s, { type: "method", code: "fry" }], ids, both)).toBe("off");
    expect(kitchenPhase([m, s, boil, m], ids, both)).toBe("off");
  });
  it("포장마차: 수프를 올리면 기준가 설명(한 번) 뒤 영업 시작", () => {
    expect(stallPhase({ hasSoupSlot: false, ackPrice: false })).toBe("display");
    expect(stallPhase({ hasSoupSlot: true, ackPrice: false })).toBe("price");
    expect(stallPhase({ hasSoupSlot: true, ackPrice: true })).toBe("start");
  });
  it("대사 자리 채우기", () => {
    expect(fillTokens("{floor}층에서 {nextRep}", { floor: 1, nextRep: 30 })).toBe("1층에서 30");
    expect(fillTokens("{n}/2", {})).toBe("{n}/2");
  });
});

describe("시드 대사·팁·도움말", () => {
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  const TARGETS = new Set([
    "", "hud", "hud-floor", "shop-window", "facilities", "nav-home", "tab-HOME", "tab-MKT", "tab-KIT", "tab-STL", "market-staples", "kitchen-map",
    "kitchen-ingredients", "kitchen-methods", "kitchen-finish", "kitchen-reset", "stall-slots", "stall-start", "stall-open", "stall-order", "floors-map",
  ]);

  it("모든 단계에 본 대사가 있고(세부 단계 포함), 화면이 다른 단계에는 길 안내가 있다", () => {
    for (const def of TUTORIAL_STEPS) {
      const lines = TUTORIAL_LINES.filter((l) => l.step === def.id);
      const main = lines.filter((l) => l.phase === "");
      const phased = lines.filter((l) => l.phase !== "" && l.phase !== "nav");
      expect(main.length + phased.length, def.id).toBeGreaterThan(0);
      if (def.routes.length > 0) expect(lines.some((l) => l.phase === "nav"), `${def.id} nav`).toBe(true);
    }
  });

  it("대사는 한 번에 두 문장 이내이고, 대상은 정해 둔 data-tutorial-target 이름뿐이다", () => {
    for (const l of TUTORIAL_LINES) {
      expect(sentences(l.text), l.text).toBeLessThanOrEqual(2);
      expect(TARGETS.has(l.target), `${l.step}/${l.phase}: ${l.target}`).toBe(true);
    }
  });

  it("(step, phase, seq) 가 중복되지 않는다 (시드 code 충돌 방지)", () => {
    const keys = TUTORIAL_LINES.map((l) => `${l.step}.${l.phase || "main"}.${l.seq}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("행동 단계의 기본 안내는 행동을 시키는 mission 이고, 정보 단계는 say 이다", () => {
    for (const def of TUTORIAL_STEPS) {
      const main = TUTORIAL_LINES.filter((l) => l.step === def.id && l.phase === "");
      if (main.length === 0) continue;
      for (const l of main) expect(l.kind, def.id).toBe(def.kind === "action" ? "mission" : "say");
    }
  });

  it("상황별 팁 7종과 도움말 주제 7종, 팁도 두 문장 이내", () => {
    expect(TUTORIAL_TIPS.map((t) => t.code)).toEqual(["rare_ingredient", "toxin_4", "locked_zone", "exam_waiting", "sold_out", "first_request", "first_review"]);
    for (const t of TUTORIAL_TIPS) expect(sentences(t.text), t.text).toBeLessThanOrEqual(2);
    expect(HELP_TOPICS.map((t) => t.code)).toEqual(["market", "taste_map", "methods", "toxin", "stall", "orders", "floors"]);
    for (const h of HELP_TOPICS) expect(h.body.length).toBeGreaterThan(20);
  });

  it("마무리 대사의 자리 표시는 서버가 채우는 이름뿐이다", () => {
    for (const l of TUTORIAL_LINES) for (const m of l.text.matchAll(/\{(\w+)\}/g)) expect(["floor", "nextFloor", "nextRep", "n"]).toContain(m[1]);
  });
});
