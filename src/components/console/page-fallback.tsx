// 페이지 안 <Suspense> 의 fallback. 세션·DB 를 읽는 페이지는 "공유 레이아웃 아래"에 자기 경계를 둬야
// 클라이언트 이동에서도 즉시 전환된다 (Next instant navigation 규칙).
export function PageFallback() {
  return (
    <div className="flex items-center justify-center py-16 font-mono text-sm text-muted-foreground">불러오는 중…</div>
  );
}
