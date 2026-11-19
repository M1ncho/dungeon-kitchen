"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerCook, type RegisterState } from "@/app/actions/onboarding";

export function RegisterForm() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerCook, {});

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="nickname">요리사 닉네임</Label>
        <Input id="nickname" name="nickname" minLength={2} maxLength={12} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="shop_name">가게 이름</Label>
        <Input id="shop_name" name="shop_name" minLength={2} maxLength={20} required />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        입점 신청
      </Button>
    </form>
  );
}
