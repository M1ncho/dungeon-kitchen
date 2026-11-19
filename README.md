# 던전 포장마차 (dungeon-kitchen)

던전 상업 조합 관리 콘솔 컨셉의 비동기 요리 게임. Next.js + Drizzle + Neon (Postgres, Auth).

## 로컬 실행
1. Node 22+ 와 [Neon](https://neon.com) 프로젝트를 준비한다. 개발은 `dev` 브랜치, 배포는 `main` 브랜치를 쓴다.
2. Neon Console 에서 `dev` 브랜치의 **Auth 를 활성화**하고 `NEON_AUTH_BASE_URL` 을 확인한다. `DATABASE_URL` 과 `NEON_AUTH_BASE_URL` 은 **같은 브랜치**에서 복사해야 한다. 이메일 인증은 기본 꺼짐이며, 켜도(필수/선택, 코드 방식) 동작한다.
3. 환경 변수 설정:
   ```bash
   cp .env.example .env.local   # DATABASE_URL, DATABASE_URL_UNPOOLED, NEON_AUTH_* 채우기
   ```
4. 설치, 마이그레이션, 시드, 실행:
   ```bash
   npm install
   npm run db:migrate   # drizzle/ 의 SQL 적용 (direct 연결 사용)
   npm run db:seed      # 층/재료/손님 시드 (재실행하면 수치 변경이 반영됨)
   npm run dev          # http://localhost:3000
   ```

## 스키마 변경
`src/db/schema/` 를 수정한 뒤 `npm run db:generate` → `npm run db:migrate`. `npm run db:studio` 로 데이터를 볼 수 있다.

## 구조
- `src/db/` 스키마, 쿼리(`queries/`), 도메인 커맨드(`commands/`), 시드
- `src/lib/auth/` Neon Auth 서버 인스턴스와 `requireUser()`
- `src/app/actions/` Server Action
- `legacy/supabase-migrations/` 이전 Supabase SQL (참고용)

설계 원칙은 `CLAUDE.md` 참고.

## 수동 테스트 체크리스트 (가입 → 등록)
1. `npm run db:migrate && npm run db:seed && npm run dev`
2. `/login` 에서 이메일·비밀번호(8자 이상)로 **조합 가입**.
   - 인증이 필수 설정이면 인증 코드 입력 화면으로 바뀐다 → 메일의 숫자 코드를 입력(15분 내). 코드가 안 오면 **코드 재전송**.
   - 인증이 꺼져 있거나 선택이면 바로 세션이 생긴다.
   - 어느 쪽이든 마지막에 `/onboarding`(요리사 등록)으로 이동한다.
3. 닉네임(2~12자)·가게 이름(2~20자)을 등록하면 홈 콘솔에 닉네임, 가게 이름, 골드·평판, 1층 위치가 보인다.
4. 로그아웃 후 다시 로그인하면 등록 화면을 건너뛰고 홈으로 간다. (등록된 상태로 `/onboarding` 에 직접 가도 홈으로 돌아온다)
5. `npm run db:studio` 에서 `profiles` 행이 생겼는지, `profiles.id` 가 Neon Auth 유저 id(Neon Console > Auth > Users 또는 SQL Editor 의 `select id, email from neon_auth."user"`)와 같은지 확인한다. `shops` 에도 1행이 있어야 한다.
6. `npm run db:seed` 를 다시 실행해도 에러 없이 끝난다 (재료·층·손님은 code 기준 upsert).
7. 문제가 생기면 `.env.local` 에 `NEON_AUTH_LOG_LEVEL=debug` 를 추가하고 dev 서버를 재시작한 뒤 터미널 로그를 본다.

| 에러 코드 | 의미 |
|---|---|
| `NETWORK_DNS` | `NEON_AUTH_BASE_URL` 호스트를 찾지 못함 (URL 오타, 다른/삭제된 브랜치) |
| `NETWORK_REFUSED` | 연결이 거부됨 (Auth 비활성화, 잘못된 포트) |
| `NETWORK_TIMEOUT` | 응답 시간 초과 (네트워크 문제 또는 Auth 서버 지연) |
| `NETWORK_TLS` | TLS/인증서 오류 (프록시, `http://` 와 `https://` 혼동) |
| `NETWORK_RESET` | 연결이 도중에 끊김 (재시도) |
| `NETWORK_ABORT` | 요청이 중단됨 |
| `NETWORK_ERROR` | 그 외 네트워크 오류 (`debug` 로그의 상세 내용 확인) |

앱이 시작되자마자 `[env] 환경 변수 설정 오류` 로 종료되면 `.env.local` 의 누락/형식 오류(쿠키 시크릿 32자 미만 포함)를 메시지대로 고치면 된다.

### 이메일 인증 설정별 동작
| 설정 | 가입 직후 | 비고 |
|---|---|---|
| 꺼짐 / 선택 | 세션 생성 → 바로 등록 화면 | `emailVerified` 는 false 일 수 있으나 게임 진행에는 영향 없음 |
| 필수 (코드 방식) | 세션 없음 → 인증 코드 입력 → 등록 화면 | 기본 공유 이메일 제공자는 코드 방식만 가능. 링크 방식은 커스텀 이메일 제공자 필요 |

## 테스트
- `npm run test:unit` — 순수 함수(행상 생성, 슬롯) 단위 테스트. DB 불필요.
- `npm test` — 단위 + 재료 시장 통합 테스트. **`DATABASE_URL` 의 Neon dev 브랜치에 임시 테스트 유저를 만들고 끝나면 삭제한다.** 동시 구매·동시 조회는 여기서 실제 연결 여러 개로 검증한다.
- `npm run test:pglite` — 같은 통합 테스트를 인메모리 Postgres(PGlite)로 실행. 연결이 하나라 동시 요청은 직렬화되므로 로직 검증용이다.
- `npm run test:e2e` — Playwright (가입→등록, 재료 시장 구매). 개발 서버를 직접 띄우며 Neon dev 브랜치를 쓴다.

### 재료 시장 수동 확인
1. 가입→등록 직후 헤더 골드가 200 G, 홈에 "현재 방문 중인 행상" 카드와 다음 슬롯까지 남은 시간이 보인다.
2. 사이드바 **재료 시장**(`/market`)에서 행상 2명(서로 다른 층)과 기본 식재료 5종이 보인다.
3. 기본 식재료를 수량을 정해 구매하면 골드가 줄고 "보유 재료"에 쌓인다. 새로고침해도 같은 행상·같은 재고다.
4. 행상 품목을 구매하면 해당 품목의 남은 수량이 줄고, 0이 되면 "품절"이 된다.
5. 골드보다 비싼 수량을 사려 하면 "골드가 부족합니다." 가 나오고 아무것도 차감되지 않는다.

## 알려진 무해한 로그
- `next build` 중 `[neon-auth] Cookie validation error before getSession upstream call … During prerendering, cookies() rejects when the prerender is complete` 경고가 라우트마다 출력된다. Cache Components 가 prerender 단계에서 `cookies()` 를 의도적으로 거절할 때 Neon Auth 라이브러리가 남기는 로그이며, 해당 부분은 `<Suspense>` 안에서 런타임에 스트리밍되므로 동작에는 영향이 없다. `NEON_AUTH_LOG_LEVEL` 은 기본값(`warn`)을 유지한다.
- `@neondatabase/auth` 는 베타(`0.5.0-beta`)라서 `package.json` 에 정확한 버전으로 고정했다. 업그레이드는 의도적으로 할 것.
