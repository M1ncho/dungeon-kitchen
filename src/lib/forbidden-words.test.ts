import { describe, expect, it } from "vitest";
import { containsForbidden, normalizeForFilter, publicName, FALLBACK_SHOP_NAME } from "./forbidden-words";

describe("금지어 필터", () => {
  it("금지어가 든 이름은 걸러내고, 띄어쓰기·기호·숫자로 숨겨도 잡는다", () => {
    expect(containsForbidden("씨발포차")).toBe(true);
    expect(containsForbidden("씨 발 포차")).toBe(true);
    expect(containsForbidden("씨.발 포차")).toBe(true);
    expect(containsForbidden("ㅅ1ㅂ")).toBe(true);
    expect(containsForbidden("FUCK 식당")).toBe(true);
    expect(containsForbidden("f u c k")).toBe(true);
  });

  it("흔한 가게 이름은 막지 않는다", () => {
    for (const ok of ["이끼 낀 솥단지", "달빛 국수 포장마차", "씹는 맛이 좋은 집", "자지러지는 맛", "새끼 고양이 식당", "던전 버섯 수프", "마력의 샘 곁불"]) {
      expect(containsForbidden(ok), ok).toBe(false);
    }
    expect(containsForbidden("")).toBe(false);
  });

  it("공개 화면용 이름: 금지어면 대체 문구", () => {
    expect(publicName("씨발포차", FALLBACK_SHOP_NAME)).toBe(FALLBACK_SHOP_NAME);
    expect(publicName("솥단지", FALLBACK_SHOP_NAME)).toBe("솥단지");
    expect(normalizeForFilter("A b-C 12")).toBe("abc");
  });
});
