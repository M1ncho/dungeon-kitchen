import type { FacilityIconKey } from "@/components/cozy/icons";

export type Facility = {
  code: string;
  href: string;
  label: string;
  description: string;
  iconKey: FacilityIconKey;
  /** 구현된 시설인지. 아니면 홈에서 흐리게 "준비 중"으로 보여 준다. */
  implemented: boolean;
};

// 홈의 3×2 타일 순서와 같다.
export const FACILITIES: Facility[] = [
  { code: "MKT", href: "/market", label: "재료 시장", description: "찾아온 모험가 행상과 기본 식재료 상점에서 재료를 사요.", iconKey: "market", implemented: true },
  { code: "KIT", href: "/kitchen", label: "주방", description: "재료를 조합해 새로운 요리를 만들어요.", iconKey: "kitchen", implemented: true },
  { code: "STL", href: "/stall", label: "포장마차", description: "요리를 진열하고 가격을 정해 영업을 열어요.", iconKey: "stall", implemented: true },
  { code: "REQ", href: "/requests", label: "의뢰 게시판", description: "원하는 재료에 골드를 걸고 모험가에게 의뢰해요.", iconKey: "request", implemented: false },
  { code: "GDE", href: "/guide", label: "미식 가이드", description: "내 레시피를 공유하고 다른 요리사의 요리를 평가해요.", iconKey: "guide", implemented: false },
  { code: "INV", href: "/inventory", label: "창고", description: "가지고 있는 재료와 만든 요리를 한눈에 확인해요.", iconKey: "inventory", implemented: true },
];
