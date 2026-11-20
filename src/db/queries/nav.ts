import "server-only";
import { serverNow } from "@/lib/clock";
import { getBoardSummary } from "./board";
import { getExamAlert } from "./floors";
import { getPeddlerSnapshot } from "./market";
import { getSalesStatus } from "./stall";

// 시설 이동 탭의 알림 뱃지. 모두 읽기 전용이고 userId 는 세션에서 얻은 값만 받는다.
export type NavBadge = { text: string; tone: "alert" | "moss" | "lantern" };
export type NavData = {
  badges: Partial<Record<"HOME" | "MKT" | "KIT" | "STL" | "REQ" | "INV", NavBadge>>;
  /** 새 행상 슬롯 표시용 (클라이언트가 "이 슬롯을 시장에서 봤는지"를 기억한다) */
  peddler: { count: number; slotKey: number };
};

export async function getNavData(userId: string): Promise<NavData> {
  const now = serverNow();
  const [snapshot, sales, exam, board] = await Promise.all([
    getPeddlerSnapshot(userId),
    getSalesStatus(userId),
    getExamAlert(userId),
    getBoardSummary(userId, now),
  ]);
  const badges: NavData["badges"] = {};
  if (exam) badges.HOME = { text: "시험 손님", tone: "alert" };
  if (board.ready > 0) badges.REQ = { text: `완료 ${board.ready}`, tone: "lantern" };
  if (sales.waitingOrder) badges.STL = { text: "주문 손님", tone: "alert" };
  else if (sales.state === "soldout") badges.STL = { text: "품절", tone: "lantern" };
  else if (sales.state === "open" && sales.emptySlots > 0) badges.STL = { text: `빈 칸 ${sales.emptySlots}`, tone: "moss" };
  return { badges, peddler: { count: snapshot.peddlers.length, slotKey: snapshot.endsAtMs } };
}
