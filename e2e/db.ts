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
