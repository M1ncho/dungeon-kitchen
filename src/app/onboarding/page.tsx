import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ChefHat } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "@/components/console/register-form";
import { requireUser } from "@/lib/auth";
import { getProfile } from "@/db/queries/player";

async function OnboardingGate() {
  const user = await requireUser();
  if (await getProfile(user.id)) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <ChefHat className="size-4" /> DCG-REG
          </div>
          <CardTitle>요리사 등록</CardTitle>
          <CardDescription>던전 상업 지구에 포장마차를 입점합니다. 닉네임과 가게 이름을 정해주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm />
        </CardContent>
      </Card>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingGate />
    </Suspense>
  );
}
