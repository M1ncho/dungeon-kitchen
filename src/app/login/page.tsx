import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthForm } from "@/components/console/auth-form";
import { getSessionUser } from "@/lib/auth";

// 이미 로그인한 사용자는 콘솔로 보낸다 (세션 확인은 Suspense 안에서).
async function LoggedInRedirect() {
  if (await getSessionUser()) redirect("/");
  return null;
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={null}>
        <LoggedInRedirect />
      </Suspense>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Landmark className="size-4" /> DCG-AUTH
          </div>
          <CardTitle>던전 상업 조합</CardTitle>
          <CardDescription>조합원 인증 창구입니다. 로그인하거나 신규 가입하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm />
        </CardContent>
      </Card>
    </main>
  );
}
