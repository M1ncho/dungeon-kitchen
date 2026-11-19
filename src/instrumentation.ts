// 서버 인스턴스 시작 시 한 번 실행된다. 환경 변수가 잘못되면 여기서 바로 실패한다.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    validateEnv();
  }
}
