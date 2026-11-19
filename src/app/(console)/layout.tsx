import { Suspense } from "react";
import { Hud } from "@/components/cozy/hud";
import { TutorialProvider } from "@/components/tutorial/tutorial-layer";
import { getTutorialPanel } from "@/db/queries/tutorial";
import { serverNow } from "@/lib/clock";
import { requireCook } from "@/lib/session";

// cacheComponents: 세션(cookies) 접근은 Suspense 경계 안에서 해야 한다.
async function ConsoleShell({ children }: { children: React.ReactNode }) {
  const cook = await requireCook();
  const panel = await getTutorialPanel(cook.id, serverNow().getTime()); // 첫 플레이 안내·상황별 팁 (유저별 데이터라 캐시하지 않는다)

  return (
    <div className="dk-page flex min-h-screen flex-1 flex-col">
      <Hud cook={cook} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-8 sm:px-5">
        <TutorialProvider panel={panel}>{children}</TutorialProvider>
      </main>
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={<div className="dk-page flex flex-1 items-center justify-center font-display text-base text-dk-paper-badge">조합 콘솔 접속 중…</div>}
    >
      <ConsoleShell>{children}</ConsoleShell>
    </Suspense>
  );
}
