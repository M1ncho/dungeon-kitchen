import { describe, expect, it } from "vitest";
import { PEDDLER_LINES } from "../../db/seed-data/peddler-lines";
import { pickPeddlerLine } from "./peddler-lines";

describe("행상 한마디", () => {
  it("층마다 인사·희귀 대사가 여러 개 있다", () => {
    for (let f = 1; f <= 5; f++) {
      expect(PEDDLER_LINES.filter((l) => l.floorNo === f && l.kind === "greeting").length).toBeGreaterThanOrEqual(3);
      expect(PEDDLER_LINES.filter((l) => l.floorNo === f && l.kind === "rare").every((l) => l.text.includes("{item}"))).toBe(true);
    }
    expect(new Set(PEDDLER_LINES.map((l) => l.code)).size).toBe(PEDDLER_LINES.length);
  });
  it("같은 시드면 같은 대사, 희귀 품목이 있으면 그 이름을 언급한다", () => {
    const common = [{ name: "물", rarity: "common", remaining: 5 }];
    expect(pickPeddlerLine(2, common, PEDDLER_LINES, "a")).toBe(pickPeddlerLine(2, common, PEDDLER_LINES, "a"));
    expect(pickPeddlerLine(2, common, PEDDLER_LINES, "a")).not.toContain("{");
    const rare = [...common, { name: "송로", rarity: "rare", remaining: 2 }];
    const t = pickPeddlerLine(2, rare, PEDDLER_LINES, "b");
    expect(t).toContain("송로");
    expect(t).not.toContain("{");
  });
});
