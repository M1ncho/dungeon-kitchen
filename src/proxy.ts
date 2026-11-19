import { auth } from "@/lib/auth/server";

// 세션이 없으면 /login 으로 보낸다.
// 로그인 없이 접근해야 하는 경로는 matcher 에서 제외한다:
//  - /login (로그인·가입·이메일 인증 코드 입력이 모두 이 페이지에서 일어난다)
//  - /api/auth/* (Neon Auth 핸들러)
//  - _next 정적 자원, favicon, public/ 의 정적 파일
export default auth.middleware({ loginUrl: "/login" });

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/auth(?:/|$)|login(?:/|$)|favicon\\.ico$|.*\\.(?:svg|png|jpe?g|gif|webp|ico|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
