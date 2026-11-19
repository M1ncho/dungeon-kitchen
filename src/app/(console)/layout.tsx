import { Suspense } from "react";
import { Hud } from "@/components/cozy/hud";
import { requireCook } from "@/lib/session";

// cacheComponents: 세션(cookies) 접근은 Suspense 경계 안에서 해야 한다.
async function ConsoleShell({ children }: { children: React.ReactNode }) {
  const cook = await requireCook();

  return (
    <div className="dk-page flex min-h-screen flex-1 flex-col">
      <Hud cook={cook} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-8 sm:px-5">{children}</main>
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
