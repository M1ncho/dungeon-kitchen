import "server-only";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { FALLBACK_NICKNAME, FALLBACK_SHOP_NAME, publicName } from "@/lib/forbidden-words";
import { GRADE_LABEL, type Grade } from "@/lib/game/orders";
import { db, type Database } from "../index";
import { getTutorial } from "../commands/tutorial";
import { criticSettings, criticVisits, customerTypes, dungeonFloors, profiles, salesRecords, shops, specialOrders } from "../schema";

// 미식 가이드북 데이터. 공개되는 것은 가게 이름·닉네임·층·별점·평 문장뿐이다 (이메일 등 다른 정보는 읽지도 않는다).
// 🔒 발행(status = 'published') 전의 방문 기록은 어떤 쿼리로도 읽지 않는다: 방문 예정 시각·변장·점수·진열 스냅샷은 여기에 없다.
//    컬럼을 명시해서 읽고 select * 를 쓰지 않는다. 내 가게 탭의 "그날의 손님"(변장 공개)은 발행된 내 평에만 붙는다.

/** 테스트에서 다른 드라이버(인메모리 DB)를 넘길 수 있다. 기본은 앱의 DB. */
type Exec = Pick<Database, "select">;

export const ISSUE_DAYS = 7; // "이번 호" = 최근 7일 안에 발행된 평
const ISSUE_LIMIT = 80;
const SHOP_LIMIT = 400;

export type GuideReview = {
  id: string;
  shopName: string;
  nickname: string;
  floorNo: number;
  stars: number;
  /** 평 문장 (네 줄: 도입 / 칭찬 / 아쉬움 / 별점 줄) */
  lines: string[];
  publishedAtMs: number;
};

export type GuideShop = { shopName: string; nickname: string; floorNo: number; stars: number | null; oneLine: string | null; mine: boolean };

export type MyReview = GuideReview & {
  /** 발행 후에만 공개되는 "그날의 손님": 평론가가 어떤 손님으로 변장했었는지 */
  reveal: {
    kind: "passerby" | "order";
    customerName: string;
    dishName: string | null;
    price: number | null;
    orderText: string | null;
    resultLabel: string | null;
  };
};

export type GuideData = {
  critic: { name: string; title: string };
  floors: { floorNo: number; name: string }[];
  issue: GuideReview[];
  shops: GuideShop[];
  mine: {
    shopName: string;
    floorNo: number;
    /** null = 미평가 */
    stars: number | null;
    listed: boolean;
    reviews: MyReview[];
  };
};

const splitLines = (text: string | null) => (text ?? "").split("\n").filter(Boolean);
const oneLineOf = (text: string | null) => splitLines(text)[1] ?? splitLines(text)[0] ?? null; // 칭찬 한 줄

export async function getGuide(userId: string, nowMs: number, exec: Exec = db): Promise<GuideData> {
  const since = new Date(nowMs - ISSUE_DAYS * 24 * 60 * 60 * 1000);
  const [[settings], floors, issueRows, shopRows, mineRows, [me]] = await Promise.all([
    exec.select({ name: criticSettings.name, title: criticSettings.title }).from(criticSettings),
    exec.select({ floorNo: dungeonFloors.floorNo, name: dungeonFloors.name }).from(dungeonFloors).orderBy(asc(dungeonFloors.floorNo)),
    // 이번 호: 최근 발행된 평. 가이드북에 싣지 않기로 한 가게·숨긴 가게는 뺀다
    exec
      .select({
        id: criticVisits.id, floorNo: criticVisits.floorNo, stars: criticVisits.stars, text: criticVisits.reviewText, publishedAt: criticVisits.publishedAt,
        shopName: shops.name, nickname: profiles.nickname,
      })
      .from(criticVisits)
      .innerJoin(shops, and(eq(shops.ownerId, criticVisits.userId), eq(shops.shopType, "food_stall")))
      .innerJoin(profiles, eq(profiles.id, criticVisits.userId))
      .where(and(eq(criticVisits.status, "published"), gte(criticVisits.publishedAt, since), eq(profiles.guideListed, true), eq(shops.guideHidden, false)))
      .orderBy(desc(criticVisits.publishedAt))
      .limit(ISSUE_LIMIT),
    // 가게 목록: 모든 유저의 가게 (싣지 않기로 한 가게·숨긴 가게 제외). 최근 평 한 줄은 가장 최근에 발행된 평에서
    exec
      .select({
        ownerId: shops.ownerId, shopName: shops.name, nickname: profiles.nickname, floorNo: dungeonFloors.floorNo, stars: shops.guideStars,
        latest: sql<string | null>`(select ${criticVisits.reviewText} from ${criticVisits} where ${criticVisits.userId} = ${shops.ownerId} and ${criticVisits.status} = 'published' order by ${criticVisits.publishAt} desc limit 1)`,
      })
      .from(shops)
      .innerJoin(profiles, eq(profiles.id, shops.ownerId))
      .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
      .where(and(eq(shops.shopType, "food_stall"), eq(profiles.guideListed, true), eq(shops.guideHidden, false)))
      .orderBy(desc(sql`coalesce(${shops.guideStars}, -1)`), asc(shops.name))
      .limit(SHOP_LIMIT),
    // 내 가게: 지난 평 기록 전체 (발행된 것만) + 변장 공개 (판매 기록·주문 기록과 연결, 발행 이후에만)
    exec
      .select({
        id: criticVisits.id, floorNo: criticVisits.floorNo, stars: criticVisits.stars, text: criticVisits.reviewText, publishedAt: criticVisits.publishedAt,
        disguise: criticVisits.disguise, customerName: customerTypes.name,
        saleDish: salesRecords.dishName, salePrice: salesRecords.price,
        orderText: specialOrders.orderText, orderMode: specialOrders.mode, orderGrade: specialOrders.grade, orderDish: specialOrders.dishName, orderStatus: specialOrders.status,
      })
      .from(criticVisits)
      .innerJoin(customerTypes, eq(customerTypes.id, criticVisits.customerTypeId))
      .leftJoin(salesRecords, eq(salesRecords.id, criticVisits.salesRecordId))
      .leftJoin(specialOrders, eq(specialOrders.id, criticVisits.orderId))
      .where(and(eq(criticVisits.userId, userId), eq(criticVisits.status, "published")))
      .orderBy(desc(criticVisits.publishedAt)),
    exec
      .select({ shopName: shops.name, floorNo: dungeonFloors.floorNo, stars: shops.guideStars, listed: profiles.guideListed, nickname: profiles.nickname })
      .from(shops)
      .innerJoin(profiles, eq(profiles.id, shops.ownerId))
      .innerJoin(dungeonFloors, eq(dungeonFloors.id, shops.floorId))
      .where(and(eq(shops.ownerId, userId), eq(shops.shopType, "food_stall"))),
  ]);

  const nick = (n: string) => publicName(n, FALLBACK_NICKNAME);
  const name = (n: string) => publicName(n, FALLBACK_SHOP_NAME);
  const toReview = (r: { id: string; floorNo: number; stars: number | null; text: string | null; publishedAt: Date | null }, shopName: string, nickname: string): GuideReview => ({
    id: r.id, shopName: name(shopName), nickname: nick(nickname), floorNo: r.floorNo, stars: r.stars ?? 0, lines: splitLines(r.text),
    publishedAtMs: r.publishedAt?.getTime() ?? 0,
  });

  return {
    critic: { name: settings?.name ?? "은설", title: settings?.title ?? "가면 미식가" },
    floors,
    issue: issueRows.map((r) => toReview(r, r.shopName, r.nickname)),
    shops: shopRows.map((r) => ({
      shopName: name(r.shopName), nickname: nick(r.nickname), floorNo: r.floorNo, stars: r.stars, oneLine: oneLineOf(r.latest), mine: r.ownerId === userId,
    })),
    mine: {
      shopName: me ? name(me.shopName) : FALLBACK_SHOP_NAME,
      floorNo: me?.floorNo ?? 1,
      stars: me?.stars ?? null,
      listed: me?.listed ?? true,
      reviews: mineRows.map((r) => ({
        ...toReview(r, me?.shopName ?? "", me?.nickname ?? ""),
        reveal: {
          kind: r.disguise === "order" ? "order" : "passerby",
          customerName: r.customerName,
          dishName: r.disguise === "order" ? (r.orderStatus === "served" ? r.orderDish : null) : r.saleDish,
          price: r.disguise === "order" ? null : r.salePrice,
          orderText: r.disguise === "order" ? r.orderText : null,
          resultLabel:
            r.disguise !== "order" ? null : r.orderStatus === "served" && r.orderGrade ? (GRADE_LABEL[r.orderGrade as Grade] ?? null) : "응대 없이 떠났어요",
        },
      })),
    },
  };
}

/** 내 가게의 미확인 평 수 (레일 가이드 탭 뱃지·홈 알림). 발행된 내 평만 센다. */
export async function getUnseenReviewCount(userId: string, exec: Exec = db): Promise<number> {
  const [row] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(criticVisits)
    .where(and(eq(criticVisits.userId, userId), eq(criticVisits.status, "published"), isNull(criticVisits.seenAt)));
  return row?.n ?? 0;
}

/** 가이드북 공개 설정과 "공개된다" 알림 (안내가 진행 중이면 알림은 미룬다). */
export async function getGuideSettings(userId: string, exec: Exec = db): Promise<{ listed: boolean; noticePending: boolean }> {
  const [[p], tut] = await Promise.all([
    exec.select({ listed: profiles.guideListed, noticeSeenAt: profiles.guideNoticeSeenAt }).from(profiles).where(eq(profiles.id, userId)),
    getTutorial(exec, userId),
  ]);
  return { listed: p?.listed ?? true, noticePending: !!p && p.noticeSeenAt === null && tut?.status !== "active" };
}
