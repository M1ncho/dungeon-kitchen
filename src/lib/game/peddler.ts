import { createRng, randInt, weightedIndex, type Rng } from "./rng";

export type Rarity = "common" | "rare" | "legendary";

export type PeddlerPoolItem = { ingredientId: number; rarity: Rarity; weight: number; basePrice: number };

/** 층 하나의 행상 생성 규칙 + 그 층의 재료 풀. DB 시드에서 읽어 인자로 넘긴다. */
export type PeddlerFloorRule = {
  floorId: number;
  floorNo: number;
  itemsMin: number;
  itemsMax: number;
  qtyMin: number;
  qtyMax: number;
  rareBp: number; // 1/10000
  legendaryBp: number; // 1/10000
  priceMinPct: number;
  priceMaxPct: number;
  pool: PeddlerPoolItem[];
};

export type GeneratedPeddlerItem = { ingredientId: number; rarity: Rarity; quantity: number; price: number };
export type GeneratedPeddler = { peddlerIndex: number; floorId: number; items: GeneratedPeddlerItem[] };

const FALLBACK: Record<Rarity, Rarity[]> = {
  legendary: ["legendary", "rare", "common"],
  rare: ["rare", "common"],
  common: ["common"],
};

function rollRarity(rng: Rng, rule: PeddlerFloorRule): Rarity {
  const r = rng() * 10000;
  if (r < rule.legendaryBp) return "legendary";
  if (r < rule.legendaryBp + rule.rareBp) return "rare";
  return "common";
}

function generateOne(rng: Rng, peddlerIndex: number, rule: PeddlerFloorRule): GeneratedPeddler {
  const remaining = [...rule.pool];
  const wanted = randInt(rng, rule.itemsMin, rule.itemsMax);
  const items: GeneratedPeddlerItem[] = [];

  while (items.length < wanted && remaining.length > 0) {
    // 굴린 등급의 풀이 비어 있으면 낮은 등급으로 대체한다. 그래도 없으면 남은 아무 재료.
    const rolled = rollRarity(rng, rule);
    let candidates: PeddlerPoolItem[] = [];
    for (const tier of FALLBACK[rolled]) {
      candidates = remaining.filter((p) => p.rarity === tier);
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) candidates = remaining;

    const picked = candidates[weightedIndex(rng, candidates.map((c) => c.weight))];
    remaining.splice(remaining.indexOf(picked), 1);

    // 수량: 일반은 규칙 범위, 희귀는 1/3 (최소 1), 전설은 1개.
    const base = randInt(rng, rule.qtyMin, rule.qtyMax);
    const quantity = picked.rarity === "legendary" ? 1 : picked.rarity === "rare" ? Math.max(1, Math.floor(base / 3)) : base;
    const price = Math.max(1, Math.round((picked.basePrice * randInt(rng, rule.priceMinPct, rule.priceMaxPct)) / 100));

    items.push({ ingredientId: picked.ingredientId, rarity: picked.rarity, quantity, price });
  }

  return { peddlerIndex, floorId: rule.floorId, items };
}

export type OriginWeights = { same: number; deeper: number; shallower: number };

/**
 * 행상 출신 층을 뽑는다 (순수 함수, 같은 시드 → 같은 결과).
 * 내 가게가 있는 층(shopFloor) 기준으로 같은 층 / 한 층 아래(더 깊은 층) / 위층(한 층 얕은 층)의 가중치로
 * 서로 다른 층을 count 개 뽑는다. 후보 중 없는 층은 빼고 남은 가중치로 다시 계산한다.
 * 후보가 count 보다 적으면 가까운 층부터 채운다.
 */
export function pickPeddlerOrigins(
  shopFloor: number,
  rules: { floorNos: readonly number[]; weights: OriginWeights; count: number },
  seed: string,
): number[] {
  const rng = createRng(`${seed}:origins`);
  const weightOf = (floorNo: number) =>
    floorNo === shopFloor ? rules.weights.same : floorNo === shopFloor + 1 ? rules.weights.deeper : floorNo === shopFloor - 1 ? rules.weights.shallower : 0;
  const remaining = [...rules.floorNos].filter((f) => weightOf(f) > 0);
  const picked: number[] = [];
  while (picked.length < rules.count && remaining.length > 0) {
    const i = weightedIndex(rng, remaining.map(weightOf));
    picked.push(remaining.splice(i, 1)[0]);
  }
  if (picked.length < rules.count) {
    const rest = rules.floorNos.filter((f) => !picked.includes(f)).sort((a, b) => Math.abs(a - shopFloor) - Math.abs(b - shopFloor) || a - b);
    for (const f of rest) if (picked.length < rules.count) picked.push(f);
  }
  return picked;
}

/**
 * 슬롯의 행상 방문을 결정적으로 생성한다 (순수 함수).
 * - 시드: `peddler:{userId}:{slot}` — 같은 입력이면 항상 같은 결과.
 * - 행상은 서로 다른 층 출신이며, 출신 층은 "내 가게가 있는 층" 기준으로 뽑는다 (pickPeddlerOrigins).
 */
export function generatePeddlers(input: {
  userId: string;
  slot: number;
  peddlersPerSlot: number;
  shopFloorNo: number;
  originWeights: OriginWeights;
  rules: PeddlerFloorRule[];
}): GeneratedPeddler[] {
  const seed = `peddler:${input.userId}:${input.slot}`;
  const rng = createRng(seed);
  const available = input.rules.filter((r) => r.pool.length > 0);
  const count = Math.min(input.peddlersPerSlot, available.length);
  const origins = pickPeddlerOrigins(input.shopFloorNo, { floorNos: available.map((r) => r.floorNo), weights: input.originWeights, count }, seed);
  return origins.map((floorNo, i) => generateOne(rng, i, available.find((r) => r.floorNo === floorNo)!));
}
