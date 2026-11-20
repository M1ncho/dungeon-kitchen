import { Suspense } from "react";
import { BoardView } from "@/components/board/board-view";
import { PageFallback } from "@/components/console/page-fallback";
import { getBoard } from "@/db/queries/board";
import { serverNow } from "@/lib/clock";
import { requireCook } from "@/lib/session";

async function BoardContent() {
  const cook = await requireCook();
  const data = await getBoard(cook.id, serverNow());
  return <BoardView data={data} />;
}

export default function BoardPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <BoardContent />
    </Suspense>
  );
}
