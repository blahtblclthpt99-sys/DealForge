import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Briefcase,
  Car,
  Cpu,
  Dumbbell,
  Gamepad2,
  Home,
  PawPrint,
  Puzzle,
  Shirt,
  ShoppingBasket,
  Sparkles,
  TreePine,
  Wrench,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  cpu: Cpu,
  home: Home,
  wrench: Wrench,
  car: Car,
  "gamepad-2": Gamepad2,
  shirt: Shirt,
  sparkles: Sparkles,
  "paw-print": PawPrint,
  briefcase: Briefcase,
  "tree-pine": TreePine,
  dumbbell: Dumbbell,
  puzzle: Puzzle,
  "shopping-basket": ShoppingBasket,
  "book-open": BookOpen,
};

export function CategoryGrid({
  categories,
}: {
  categories: { id: string; name: string; slug: string; icon: string; _count?: { products: number } }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
      {categories.map((cat) => {
        const Icon = ICONS[cat.icon] || Home;
        return (
          <Link
            key={cat.id}
            href={`/categories/${cat.slug}`}
            className="dn-card group flex flex-col items-center gap-2 px-3 py-5 text-center transition hover:-translate-y-0.5 hover:border-forest/40"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-forest/10 text-forest transition group-hover:bg-forest group-hover:text-white">
              <Icon className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-forest-ink">{cat.name}</span>
            {cat._count && (
              <span className="text-xs text-forest-muted">{cat._count.products} items</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
