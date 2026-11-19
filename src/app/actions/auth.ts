"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getProfile } from "@/db/queries/player";

// verify: 이메일 인증 코드 입력 단계로 전환하라는 신호
export type AuthState = { error?: string; message?: string; verify?: { email: string } };

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

function isUnverified(error: { code?: string; status?: number; message?: string }) {
  return (
    error.code === "EMAIL_NOT_VERIFIED" ||
    error.status === 403 ||
    /not verified|verify your email/i.test(error.message ?? "")
  );
}

/**
 * 로그인 직후 보낼 곳. 요리사 등록이 안 된 유저를 "/" 로 보내면 콘솔 레이아웃이 다시 "/onboarding" 으로
 * redirect 하게 되므로, 처음부터 알맞은 곳으로 보낸다.
 */
async function destinationFor(userId: string | undefined) {
  return userId && (await getProfile(userId)) ? "/" : "/onboarding";
}

async function sendCode(email: string) {
  return auth.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
}

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: "이메일과 비밀번호를 입력하세요." };

  const { data, error } = await auth.signIn.email({ email, password });
  if (error) {
    // 인증이 필수인 설정에서 미인증 계정: 코드를 보내고 입력 화면으로 전환한다.
    if (isUnverified(error)) {
      await sendCode(email);
      return { verify: { email } };
    }
    return { error: "로그인에 실패했습니다. 이메일/비밀번호를 확인하세요." };
  }

  redirect(await destinationFor(data?.user?.id));
}

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email) return { error: "이메일을 입력하세요." };
  if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다." };

  const { data, error } = await auth.signUp.email({ email, password, name: email.split("@")[0] || "요리사" });
  if (error) return { error: "가입에 실패했습니다. 이미 가입된 이메일이거나 형식이 올바르지 않습니다." };

  // 인증이 선택/꺼짐이면 가입과 동시에 세션이 만들어지고 응답에 토큰이 온다 → 바로 진행 (등록 화면으로 이어짐).
  // 토큰이 없으면 인증이 필수인 설정 → 가입 시 발송된 코드를 입력받는다.
  // (같은 요청 안에서 방금 설정한 쿠키는 getSession() 으로 읽히지 않으므로 응답 값으로 판단한다.)
  if (data?.token) redirect("/onboarding"); // 방금 만든 계정이라 요리사 등록 전이다
  return { verify: { email } };
}

/** 인증 코드 검증. 성공하면 세션이 생기고 요리사 등록 화면으로 이어진다. */
export async function verifyEmailCode(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const otp = String(formData.get("otp") ?? "").replace(/\s+/g, "");
  if (!email) return { error: "이메일 정보가 없습니다. 처음부터 다시 시도하세요." };
  if (!/^\d{4,10}$/.test(otp)) return { verify: { email }, error: "인증 코드를 숫자로 입력하세요." };

  const { data, error } = await auth.emailOtp.verifyEmail({ email, otp });
  if (error) return { verify: { email }, error: "인증 코드가 올바르지 않거나 만료되었습니다. (유효시간 15분)" };

  if (data?.token) redirect(await destinationFor(data.user?.id));
  // 자동 로그인이 꺼진 설정: 인증은 끝났으니 로그인만 하면 된다.
  return { message: "이메일 인증이 완료되었습니다. 로그인해 주세요." };
}

export async function resendVerificationCode(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "이메일 정보가 없습니다. 처음부터 다시 시도하세요." };

  const { error } = await sendCode(email);
  if (error) return { verify: { email }, error: "코드를 보내지 못했습니다. 잠시 후 다시 시도하세요." };
  return { verify: { email }, message: "새 인증 코드를 보냈습니다. (유효시간 15분)" };
}

export async function signOut() {
  await auth.signOut();
  redirect("/login");
}
