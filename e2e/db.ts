import { config } from "dotenv";
import { eq } from "drizzle-orm";

// e2e 전용 DB 헬퍼 (dev 브랜치의 테이블 데이터만 읽고/고친다. 브랜치·프로젝트 작업은 하지 않는다).
// 주문 손님은 확률로 등장하므로, 테스트가 "반드시 등장"하게 만들거나 숨겨진 목표를 읽어 검증할 때만 쓴다.
config({ path: ".env.local" });

// Playwright 는 TS 를 CJS 로 불러오므로 동적 import 결과가 { default: 모듈 } 로 감싸질 수 있다.
const unwrap = <T extends object>(m: T): T => ((m as { default?: T }).default ?? m) as T;

async function load() {
  const { db } = unwrap(await import("../src/db/index"));
  const schema = unwrap(await import("../src/db/schema"));
  return { db, schema };
}

/** 주문 손님 등장 확률(1/10000)을 모든 층에서 바꾸고 이전 값(층 번호 → 값)을 돌려준다. 끝나면 restoreOrderSpawnChance 로 되돌린다. */
export async function setOrderSpawnChance(bp: number): Promise<Record<number, number>> {
  const { db, schema } = await load();
  const rows = await db.select({ floorNo: schema.dungeonFloors.floorNo, bp: schema.dungeonFloors.orderSpawnBp }).from(schema.dungeonFloors);
  await db.update(schema.dungeonFloors).set({ orderSpawnBp: bp });
  return Object.fromEntries(rows.map((r) => [r.floorNo, r.bp]));
}

export async function restoreOrderSpawnChance(prev: Record<number, number>) {
  const { db, schema } = await load();
  for (const [floorNo, bp] of Object.entries(prev)) {
    await db.update(schema.dungeonFloors).set({ orderSpawnBp: bp }).where(eq(schema.dungeonFloors.floorNo, Number(floorNo)));
  }
}

/** 테스트 계정의 골드·평판·해금한 층을 직접 맞춘다 (평판 쌓기를 건너뛰기 위한 테스트 전용 장치). */
export async function setProfile(nickname: string, patch: { gold?: number; reputation?: number; unlockedFloor?: number }) {
  const { db, schema } = await load();
  await db.update(schema.profiles).set(patch).where(eq(schema.profiles.nickname, nickname));
}

/**
 * 첫 플레이 안내를 건너뜀 상태로 만들고 상황별 팁도 모두 본 것으로 한다
 * (안내·팁 말풍선이 다른 e2e 의 클릭을 가리지 않게. 안내·팁 자체는 tutorial.spec.ts 가 시험한다).
 */
export async function skipTutorialOf(nickname: string) {
  const { db, schema } = await load();
  const [p] = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  const tips = await db.select({ code: schema.tutorialTips.code }).from(schema.tutorialTips);
  await db
    .update(schema.tutorialProgress)
    .set({ status: "skipped", step: "done", finishedAt: new Date(), seenTips: tips.map((t) => t.code) })
    .where(eq(schema.tutorialProgress.userId, p.id));
  // 가이드북 공개 알림도 본 것으로 한다 (다른 e2e 화면 위에 알림 카드가 끼지 않게. 알림 자체는 critic.spec.ts 가 시험한다)
  await db.update(schema.profiles).set({ guideNoticeSeenAt: new Date() }).where(eq(schema.profiles.id, p.id));
}

/** 가이드북 공개 알림을 "아직 안 본" 상태로 되돌린다. */
export async function unseeGuideNotice(nickname: string) {
  const { db, schema } = await load();
  await db.update(schema.profiles).set({ guideNoticeSeenAt: null }).where(eq(schema.profiles.nickname, nickname));
}

/** 상황별 팁 하나를 "아직 안 본" 상태로 되돌린다 (createAccount 는 팁을 모두 본 것으로 만든다). */
export async function unseeTip(nickname: string, code: string) {
  const { db, schema } = await load();
  const [p] = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  const [t] = await db.select({ seen: schema.tutorialProgress.seenTips }).from(schema.tutorialProgress).where(eq(schema.tutorialProgress.userId, p.id));
  await db.update(schema.tutorialProgress).set({ seenTips: (t?.seen ?? []).filter((c) => c !== code) }).where(eq(schema.tutorialProgress.userId, p.id));
}

/** 의뢰의 결과 확률을 한 가지로 고정한다 (e2e 가 결과를 정해 놓고 수령 흐름을 검증할 때). */
export async function forceRequestOutcome(requestId: string, outcome: "success" | "partial" | "fail") {
  const { db, schema } = await load();
  const o = { success: [10000, 0, 0], partial: [0, 10000, 0], fail: [0, 0, 10000] }[outcome];
  await db.update(schema.ingredientRequests).set({ successBp: o[0], partialBp: o[1], failBp: o[2] }).where(eq(schema.ingredientRequests.id, requestId));
}

/** 이 유저의 의뢰 기록 (등록 순서). */
export async function readRequests(nickname: string) {
  const { db, schema } = await load();
  const [p] = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  const rows = await db.select().from(schema.ingredientRequests).where(eq(schema.ingredientRequests.userId, p.id));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** 이 유저의 안내 진행 상태. */
export async function readTutorial(nickname: string) {
  const { db, schema } = await load();
  const [p] = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  const [t] = await db.select().from(schema.tutorialProgress).where(eq(schema.tutorialProgress.userId, p.id));
  return t ?? null;
}

/** 닉네임으로 유저 id 와 현재 층 번호를 읽는다. */
export async function readPlayer(nickname: string) {
  const { db, schema } = await load();
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  const [shop] = await db
    .select({ floorNo: schema.dungeonFloors.floorNo })
    .from(schema.shops)
    .innerJoin(schema.dungeonFloors, eq(schema.dungeonFloors.id, schema.shops.floorId))
    .where(eq(schema.shops.ownerId, p.id));
  return { ...p, floorNo: shop?.floorNo ?? 0 };
}

/** 이 유저의 시험 손님 (가장 최근). */
export async function readExam(userId: string) {
  const { db, schema } = await load();
  const rows = await db.select().from(schema.specialOrders).where(eq(schema.specialOrders.userId, userId));
  return rows.filter((o) => o.kind === "exam").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** 주문의 숨겨진 목표를 테스트가 아는 값으로 바꾼다 (맞춤 요리가 반드시 통과하도록). */
export async function overrideOrderTarget(orderId: string, x: number, y: number, toxinCap = 5) {
  const { db, schema } = await load();
  await db.update(schema.specialOrders).set({ targetX: x, targetY: y, toxinCap }).where(eq(schema.specialOrders.id, orderId));
}

/** 가게가 있는 층 번호별로 이 유저의 행상 출신 층 집합 (최근 슬롯). */
export async function readPeddlerOrigins(userId: string) {
  const { db, schema } = await load();
  const rows = await db
    .select({ slot: schema.peddlerOffers.slot, floorNo: schema.dungeonFloors.floorNo })
    .from(schema.peddlerOffers)
    .innerJoin(schema.dungeonFloors, eq(schema.dungeonFloors.id, schema.peddlerOffers.floorId))
    .where(eq(schema.peddlerOffers.userId, userId));
  const bySlot = new Map<number, Set<number>>();
  for (const r of rows) bySlot.set(r.slot, (bySlot.get(r.slot) ?? new Set()).add(r.floorNo));
  return bySlot;
}

/** 주문의 숨겨진 값(목표 좌표 등) — 클라이언트에 새지 않았는지 대조하는 용도. */
export async function readOrderSecret(orderId: string) {
  const { db, schema } = await load();
  const [o] = await db.select().from(schema.specialOrders).where(eq(schema.specialOrders.id, orderId));
  return o;
}

/**
 * 연결 풀은 워커 프로세스 안에서 여러 스펙이 함께 쓰므로 스펙이 끝날 때마다 닫지 않는다
 * (한 스펙이 닫으면 같은 워커의 다음 스펙이 "Cannot use a pool after calling end" 로 실패한다).
 * 워커 프로세스가 끝나면 연결도 함께 정리된다.
 */
export async function closeDb() {
  /* 의도적으로 아무것도 하지 않는다 */
}


// ───── 미식 평론가 (e2e/critic.spec.ts) ─────

/** 창고에 수프 요리를 직접 넣는다 (조리 화면을 거치지 않고 영업을 준비하기 위한 테스트 전용 장치). 재료비 6G → 기준가 14G. */
export async function giveSoups(nickname: string, count: number, quality = 3) {
  const { db, schema } = await load();
  const [p] = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  const [zone] = await db.select({ id: schema.dishZones.id }).from(schema.dishZones).where(eq(schema.dishZones.code, "soup"));
  const [ing] = await db.select({ id: schema.ingredients.id }).from(schema.ingredients).limit(1);
  const now = new Date();
  await db.insert(schema.userDishes).values(
    Array.from({ length: count }, () => ({
      userId: p.id, zoneId: zone.id, mainIngredientId: ing.id, name: "진한 버섯 수프", quality, finalX: 0, finalY: 30, toxin: 0, steps: [],
      ingredientCost: 6, readyAt: now, collectedAt: now,
    })),
  );
}

/** 평론가 설정에서 주문 손님으로 변장할 확률(1/10000)만 바꾸고 이전 값을 돌려준다. */
export async function setCriticDisguiseBp(bp: number): Promise<number> {
  const { db, schema } = await load();
  const [s] = await db.select({ bp: schema.criticSettings.orderDisguiseBp }).from(schema.criticSettings);
  await db.update(schema.criticSettings).set({ orderDisguiseBp: bp });
  return s.bp;
}

/** 이 유저의 영업 세션 시작 시각들과 다음 평론가 방문 예정 시각. */
export async function readCriticSchedule(nickname: string) {
  const { db, schema } = await load();
  const [p] = await db.select({ id: schema.profiles.id, nextAt: schema.profiles.criticNextAt }).from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  const sessions = await db.select({ startedAt: schema.salesSessions.startedAt }).from(schema.salesSessions).where(eq(schema.salesSessions.userId, p.id));
  return { nextAt: p.nextAt, startedAt: sessions.map((s) => s.startedAt).sort((a, b) => a.getTime() - b.getTime())[0] ?? null };
}

/** 다음 평론가 방문 예정 시각을 직접 정한다 (시간 이동으로 며칠을 기다리지 않기 위한 테스트 전용 장치). */
export async function setCriticNextAt(nickname: string, at: Date) {
  const { db, schema } = await load();
  await db.update(schema.profiles).set({ criticNextAt: at }).where(eq(schema.profiles.nickname, nickname));
}

/** 이 유저의 평론가 방문 기록 (방문 순서). */
export async function readCriticVisits(nickname: string) {
  const { db, schema } = await load();
  const [p] = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  const rows = await db.select().from(schema.criticVisits).where(eq(schema.criticVisits.userId, p.id));
  return rows.sort((a, b) => a.visitedAt.getTime() - b.visitedAt.getTime());
}


// ───── 층별 장인과 도구 (e2e/artisan.spec.ts) ─────

async function userIdOf(nickname: string) {
  const { db, schema } = await load();
  const [p] = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.nickname, nickname));
  return p.id;
}

/** 창고에 요리를 직접 넣는다 (구역 코드·품질 지정). */
export async function giveDish(nickname: string, zoneCode: string, quality: number, name = "테스트 요리") {
  const { db, schema } = await load();
  const userId = await userIdOf(nickname);
  const [zone] = await db.select({ id: schema.dishZones.id }).from(schema.dishZones).where(eq(schema.dishZones.code, zoneCode));
  const [ing] = await db.select({ id: schema.ingredients.id }).from(schema.ingredients).limit(1);
  const now = new Date();
  await db.insert(schema.userDishes).values({
    userId, zoneId: zone.id, mainIngredientId: ing.id, name, quality, finalX: 0, finalY: 0, toxin: 0, steps: [], ingredientCost: 10, readyAt: now, collectedAt: now,
  });
}

/** 보유 재료를 직접 더한다 (재료 code → 개수). */
export async function giveIngredients(nickname: string, stock: Record<string, number>) {
  const { db, schema } = await load();
  const userId = await userIdOf(nickname);
  for (const [code, quantity] of Object.entries(stock)) {
    const [ing] = await db.select({ id: schema.ingredients.id }).from(schema.ingredients).where(eq(schema.ingredients.code, code));
    await db.insert(schema.userIngredients).values({ userId, ingredientId: ing.id, quantity })
      .onConflictDoUpdate({ target: [schema.userIngredients.userId, schema.userIngredients.ingredientId], set: { quantity } });
  }
}

/** 장인의 도구를 바로 준다 (단계 0~2). 장인이 아직 등장하지 않았어도 행을 만든다. */
export async function giveTool(nickname: string, artisanCode: string, level: number) {
  const { db, schema } = await load();
  const userId = await userIdOf(nickname);
  await db.insert(schema.userArtisans).values({ userId, artisanCode, toolLevel: level, deliveredAt: new Date(), seenAt: new Date() })
    .onConflictDoUpdate({ target: [schema.userArtisans.userId, schema.userArtisans.artisanCode], set: { toolLevel: level, deliveredAt: new Date() } });
}

export async function readArtisan(nickname: string, artisanCode: string) {
  const { db, schema } = await load();
  const userId = await userIdOf(nickname);
  const rows = await db.select().from(schema.userArtisans).where(eq(schema.userArtisans.userId, userId));
  return rows.find((r) => r.artisanCode === artisanCode) ?? null;
}
