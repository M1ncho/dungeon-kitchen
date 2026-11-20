"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { registerCook as registerCookCommand } from "@/db/commands/register-cook";

export type RegisterState = { error?: string };

const ERRORS = {
  invalid_nickname: "닉네임은 2~12자여야 합니다.",
  invalid_shop_name: "가게 이름은 2~20자여야 합니다.",
  forbidden_word: "가이드북에 공개되는 이름이라 쓸 수 없는 말이 들어 있어요. 다른 이름을 골라 주세요.",
  nickname_taken: "이미 사용 중인 닉네임입니다.",
  no_floor: "던전 데이터가 준비되지 않았습니다. 관리자에게 문의하세요.",
} as const;

export async function registerCook(_: RegisterState, formData: FormData): Promise<RegisterState> {
  const user = await requireUser(); // user id 는 항상 세션에서만 가져온다

  const result = await registerCookCommand(db, {
    userId: user.id,
    nickname: String(formData.get("nickname") ?? ""),
    shopName: String(formData.get("shop_name") ?? ""),
  });

  if (!result.ok) {
    if (result.reason === "already_registered") redirect("/");
    return { error: ERRORS[result.reason] };
  }
  redirect("/");
}
