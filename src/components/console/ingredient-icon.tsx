import {
  Cherry, Droplet, Droplets, Drumstick, Egg, Feather, Fish, Flame, FlameKindling, Flower2, GlassWater, Gem,
  Leaf, Package, Shell, Snowflake, Sparkles, Sprout, Wheat, Zap, type LucideIcon,
} from "lucide-react";

// ingredients.icon 에 저장된 lucide 아이콘 이름 → 컴포넌트. 없으면 Package.
const ICONS: Record<string, LucideIcon> = {
  cherry: Cherry, droplet: Droplet, droplets: Droplets, drumstick: Drumstick, egg: Egg, feather: Feather,
  fish: Fish, flame: Flame, "flame-kindling": FlameKindling, "flower-2": Flower2, "glass-water": GlassWater,
  gem: Gem, leaf: Leaf, package: Package, shell: Shell, snowflake: Snowflake, sparkles: Sparkles,
  sprout: Sprout, wheat: Wheat, zap: Zap,
};

export function IngredientIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Package;
  return <Icon className={className} />;
}
