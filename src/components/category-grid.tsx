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
            className="dn-card dn-card-interactive group flex min-h-36 flex-col items-center justify-center gap-2 px-3 py-5 text-center"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-forest/9 text-forest transition group-hover:bg-forest group-hover:text-white">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-sm font-extrabold text-forest-ink group-hover:text-forest">{cat.name}</span>
            {cat._count ? (
              <span className="text-[11px] font-medium text-forest-muted">{cat._count.products.toLocaleString()} items</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
