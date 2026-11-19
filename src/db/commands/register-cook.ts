import { asc, eq } from "drizzle-orm";
import type { Database } from "../index";
import { dungeonFloors, profiles, shops } from "../schema";

export type RegisterCookResult =
  | { ok: true }
  | { ok: false; reason: "invalid_nickname" | "invalid_shop_name" | "nickname_taken" | "already_registered" | "no_floor" };

// Database 대신 최소 인터페이스(transaction)만 요구해 테스트에서 다른 드라이버로 대체할 수 있다.
type Db = Pick<Database, "transaction">;

// 앞뒤 공백 제거 + 내부 연속 공백을 하나로. 제어문자가 있으면 빈 문자열로 만들어 검증에서 떨어뜨린다.
function normalizeName(raw: string): string {
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "";
  return raw.trim().replace(/\s+/g, " ");
}

// DB 의 char_length 는 코드포인트 기준이므로 JS 도 코드포인트로 센다.
function validLength(value: string, min: number, max: number): boolean {
  const n = [...value].length;
  return n >= min && n <= max;
}

function pgError(err: unknown): { code?: string; constraint?: string } {
  const e = err as { code?: string; constraint?: string; cause?: unknown };
  return e?.code ? e : ((e?.cause as { code?: string; constraint?: string }) ?? {});
}

/**
 * 요리사 등록 (구 RPC register_cook). userId 는 세션에서 얻은 값만 넘길 것.
 * 프로필과 가게를 한 트랜잭션으로 만든다. 중복 호출/경합은 PK·UNIQUE 위반으로 막힌다.
 */
export async function registerCook(
  db: Db,
  input: { userId: string; nickname: string; shopName: string },
): Promise<RegisterCookResult> {
  const nickname = normalizeName(input.nickname);
  const shopName = normalizeName(input.shopName);
  if (!validLength(nickname, 2, 12)) return { ok: false, reason: "invalid_nickname" };
  if (!validLength(shopName, 2, 20)) return { ok: false, reason: "invalid_shop_name" };

  try {
    return await db.transaction(async (tx): Promise<RegisterCookResult> => {
      const [existing] = await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, input.userId));
      if (existing) return { ok: false, reason: "already_registered" };

      const [floor] = await tx.select({ id: dungeonFloors.id }).from(dungeonFloors).orderBy(asc(dungeonFloors.floorNo)).limit(1);
      if (!floor) return { ok: false, reason: "no_floor" };

      await tx.insert(profiles).values({ id: input.userId, nickname });
      await tx.insert(shops).values({ ownerId: input.userId, shopType: "food_stall", name: shopName, floorId: floor.id });
      return { ok: true };
    });
  } catch (err) {
    const { code, constraint } = pgError(err);
    if (code === "23505") {
      return { ok: false, reason: constraint === "profiles_nickname_unique" ? "nickname_taken" : "already_registered" };
    }
    throw err;
  }
}
