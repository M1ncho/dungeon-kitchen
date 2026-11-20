import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { closeDb } from "./db";
import { createAccount } from "./helpers";

// 모바일 점검: 360px · 390px · 가로 모드에서 모든 화면의 가로 넘침, 하단 탭 바에 가려지는 본문, 화면 밖으로 나간 요소를 검사하고 캡처한다.
// 캡처는 screenshots/mobile/ (git 제외). 파일 이름의 prefix 로 수정 전(before-)·후(after-)를 구분한다 (MOBILE_SHOT_PREFIX 환경 변수).
test.afterAll(() => closeDb());

const PREFIX = process.env.MOBILE_SHOT_PREFIX ?? "after";
const VIEWPORTS = [
  { tag: "360", width: 360, height: 740 },
  { tag: "390", width: 390, height: 844 },
  { tag: "landscape", width: 844, height: 390 },
] as const;
const PAGES = [
  ["home", "/"], ["market", "/market"], ["kitchen", "/kitchen"], ["inventory", "/inventory"],
  ["stall", "/stall"], ["board", "/board"], ["floors", "/floors"], ["help", "/help"],
] as const;

test("모바일: 모든 화면이 가로로 넘치지 않고 하단 탭 바에 본문이 가려지지 않는다", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync("screenshots/mobile", { recursive: true });
  await createAccount(page);
  const problems: string[] = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const [name, url] of PAGES) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `screenshots/mobile/${PREFIX}-${vp.tag}-${name}.png`, fullPage: true });

      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const overflowX = document.documentElement.scrollWidth - vw;
        // 화면 폭 밖으로 나간 요소 (고정 위치·숨김 제외)
        const wide: string[] = [];
        for (const el of document.querySelectorAll("main *")) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.position === "fixed" || cs.visibility === "hidden") continue;
          if (b.right > vw + 1 || b.left < -1) {
            // 가로 스크롤 가능한 상자 안의 것은 제외
            let p: Element | null = el.parentElement;
            let scrollable = false;
            while (p && p !== document.body) {
              const o = getComputedStyle(p).overflowX;
              if (o === "auto" || o === "scroll" || o === "hidden") { scrollable = true; break; }
              p = p.parentElement;
            }
            if (!scrollable) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(b.left)}..${Math.round(b.right)}]`);
          }
        }
        return { overflowX, wide: wide.slice(0, 4) };
      });
      if (r.overflowX > 1) problems.push(`${vp.tag} ${name}: 가로 스크롤 ${r.overflowX}px`);
      if (r.wide.length) problems.push(`${vp.tag} ${name}: 화면 밖 요소 ${r.wide.join(" | ")}`);

      // 맨 아래까지 내렸을 때 마지막 본문이 하단 탭 바에 가려지지 않는다 (모바일 탭 바가 보일 때만)
      const bar = page.getByTestId("facility-nav-bottom");
      if (await bar.isVisible()) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const barTop = (await bar.boundingBox())!.y;
        const lastBottom = await page.evaluate(() => (document.querySelector("main")!.lastElementChild as HTMLElement).getBoundingClientRect().bottom);
        if (lastBottom > barTop + 1) problems.push(`${vp.tag} ${name}: 본문 끝(${Math.round(lastBottom)})이 탭 바(${Math.round(barTop)})에 가려짐`);
      }
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});
