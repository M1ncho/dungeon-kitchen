import "server-only";
import { redirect } from "next/navigation";
import { auth } from "./server";

export type SessionUser = { id: string; email: string; name: string };

/** 세션이 있으면 사용자 정보를, 없으면 null 을 돌려준다. 세션(cookies)을 읽으므로 Suspense 안에서 호출한다. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user) return null;
  return { id: String(user.id), email: user.email, name: user.name };
}

/**
 * 모든 서버 함수의 진입점. user id 는 반드시 여기서(세션에서) 얻는다.
 * 클라이언트 입력(FormData, 인자)으로 받은 user id 는 절대 쿼리에 쓰지 않는다.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
