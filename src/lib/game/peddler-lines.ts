import { createRng } from "./rng";

// 행상 한마디 고르기. 같은 (유저, 슬롯, 행상)이면 몇 번을 조회해도 같은 대사다 (결정적 슬롯 생성).

export type PeddlerLine = { floorNo: number; kind: "greeting" | "rare"; text: string };
export type LineOffer = { name: string; rarity: string; remaining: number };

/** 희귀·전설 품목(남아 있는 것)이 있으면 그 품목을 언급하는 대사를 우선하고, 없으면 층별 인사를 쓴다. */
export function pickPeddlerLine(floorNo: number, offers: LineOffer[], lines: PeddlerLine[], seed: string): string {
  const rng = createRng(seed);
  const rareOffers = offers.filter((o) => o.rarity !== "common" && o.remaining > 0);
  const rare = lines.filter((l) => l.floorNo === floorNo && l.kind === "rare");
  if (rareOffers.length > 0 && rare.length > 0) {
    // 전설을 먼저 언급한다
    const pool = rareOffers.some((o) => o.rarity === "legendary") ? rareOffers.filter((o) => o.rarity === "legendary") : rareOffers;
    const o = pool[Math.floor(rng() * pool.length)];
    const l = rare[Math.floor(rng() * rare.length)];
    return l.text.replace("{item}", o.name).replace("{n}", String(o.remaining));
  }
  const greet = lines.filter((l) => l.floorNo === floorNo && l.kind === "greeting");
  if (greet.length === 0) return "어서 오시오.";
  return greet[Math.floor(rng() * greet.length)].text;
}
