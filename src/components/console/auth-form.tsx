"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  resendVerificationCode,
  signIn,
  signUp,
  verifyEmailCode,
  type AuthState,
} from "@/app/actions/auth";

const initial: AuthState = {};

function VerifyForm({ email, onBack }: { email: string; onBack: () => void }) {
  const [verifyState, verifyAction, verifying] = useActionState(verifyEmailCode, initial);
  const [resendState, resendAction, resending] = useActionState(resendVerificationCode, initial);
  // 가장 최근에 실행된 쪽의 결과를 보여준다 (재전송 안내 / 검증 오류).
  const state = resendState.message || resendState.error ? resendState : verifyState;
  const pending = verifying || resending;

  if (verifyState.message) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-emerald-400">{verifyState.message}</p>
        <Button type="button" className="w-full" onClick={onBack}>
          로그인으로
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4">
      <input type="hidden" name="email" value={email} />
      <p className="text-sm text-muted-foreground">
        <span className="font-mono">{email}</span> 로 인증 코드를 보냈습니다. 코드는 15분 후 만료됩니다.
      </p>
      <div className="space-y-2">
        <Label htmlFor="otp">인증 코드</Label>
        <Input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" required />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.message && <p className="text-sm text-emerald-400">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" formAction={verifyAction} disabled={pending} className="flex-1">
          인증
        </Button>
        <Button type="submit" formAction={resendAction} formNoValidate disabled={pending} variant="outline" className="flex-1">
          코드 재전송
        </Button>
      </div>
      <Button type="button" variant="ghost" size="sm" className="w-full" onClick={onBack}>
        처음으로
      </Button>
    </form>
  );
}

export function AuthForm() {
  const [inState, inAction, inPending] = useActionState(signIn, initial);
  const [upState, upAction, upPending] = useActionState(signUp, initial);
  // 사용자가 인증 화면에서 "처음으로" 를 누르면 그 시점의 state 객체를 기억해 숨긴다.
  // 새 요청의 결과는 새 객체이므로 다시 인증 화면이 열린다.
  const [dismissed, setDismissed] = useState<AuthState | null>(null);

  const verifyState = [upState, inState].find((s) => s.verify && s !== dismissed);
  if (verifyState?.verify) {
    return <VerifyForm email={verifyState.verify.email} onBack={() => setDismissed(verifyState)} />;
  }

  const state = upState.error ? upState : inState.error ? inState : upState;
  const pending = inPending || upPending;

  return (
    <form className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">이메일</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">비밀번호</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.message && <p className="text-sm text-emerald-400">{state.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" formAction={inAction} disabled={pending} className="flex-1">
          로그인
        </Button>
        <Button type="submit" formAction={upAction} disabled={pending} variant="outline" className="flex-1">
          조합 가입
        </Button>
      </div>
    </form>
  );
}
