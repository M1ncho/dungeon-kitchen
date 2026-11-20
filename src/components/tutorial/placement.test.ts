import { describe, expect, it } from "vitest";
import { placeBubble } from "./placement";

const vp = { w: 1280, h: 800 };
const size = { w: 400, h: 150 };

describe("placeBubble", () => {
  it("위쪽 대상은 아래에 붙고 꼬리는 대상 가운데를 가리킨다", () => {
    const p = placeBubble({ rect: { left: 500, top: 100, width: 100, height: 40 }, size, viewport: vp, topInset: 72 });
    expect(p.side).toBe("below");
    expect(p.top).toBe(156);
    expect(p.left + p.tail).toBeCloseTo(550);
  });
  it("화면 아래쪽 대상은 위에 붙는다", () => {
    const p = placeBubble({ rect: { left: 500, top: 700, width: 100, height: 40 }, size, viewport: vp });
    expect(p.side).toBe("above");
    expect(p.top + size.h + 16).toBe(700);
  });
  it("아래에 자리가 없으면 반대편(위)으로 옮긴다", () => {
    const p = placeBubble({ rect: { left: 500, top: 300, width: 100, height: 400 }, size, viewport: { w: 1280, h: 760 } });
    expect(["above", "right", "left"]).toContain(p.side);
    expect(p.side).not.toBe("below");
  });
  it("화면 가장자리에서도 말풍선이 밖으로 나가지 않는다", () => {
    const p = placeBubble({ rect: { left: 1200, top: 100, width: 60, height: 40 }, size, viewport: vp });
    expect(p.left + size.w).toBeLessThanOrEqual(vp.w - 12);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.tail).toBeGreaterThanOrEqual(26);
  });
  it("가로로 가득 찬 큰 대상은 옆으로 가거나 꼬리 없이 둔다", () => {
    const p = placeBubble({ rect: { left: 0, top: 80, width: 1280, height: 700 }, size, viewport: vp, topInset: 72 });
    expect(p.side).toBe("free");
    expect(p.top).toBeGreaterThanOrEqual(72);
    expect(p.top + size.h).toBeLessThanOrEqual(vp.h - 12);
  });
  it("왼쪽 세로 탭 대상은 오른쪽에 붙을 수 있다", () => {
    const p = placeBubble({ rect: { left: 0, top: 100, width: 88, height: 600 }, size, viewport: vp, topInset: 72 });
    expect(p.side).toBe("right");
    expect(p.left).toBe(88 + 16);
  });
});
