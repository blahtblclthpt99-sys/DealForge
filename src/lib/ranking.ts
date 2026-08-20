/**
 * DealForge discovery ranking.
 *
 * Price, discount, rating, and review values from legacy Amazon imports are not
 * authoritative enough to drive ranking. Until those fields are refreshed by
 * an approved retailer source, ranking is based on first-party engagement and
 * catalog recency only.
 */

export type RankableProduct = {
  discountPercent: number;
  rating: number;
  reviewCount: number;
  trendingScore: number;
  createdAt: Date | string;
  lastUpdated: Date | string;
  clickCount: number;
  viewCount: number;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function recencyScore(date: Date | string) {
  const ts = new Date(date).getTime();
  if (!Number.isFinite(ts)) return 0;
  const ageDays = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
  return clamp01(1 - ageDays / 90);
}

function clickScore(clicks: number) {
  if (!Number.isFinite(clicks) || clicks <= 0) return 0;
  return clamp01(Math.log10(clicks + 1) / 4);
}

function viewScore(views: number) {
  if (!Number.isFinite(views) || views <= 0) return 0;
  return clamp01(Math.log10(views + 1) / 5);
}

function ctrScore(clicks: number, views: number) {
  if (!Number.isFinite(clicks) || !Number.isFinite(views) || views <= 0) return 0;
  return clamp01(clicks / views);
}

export function computeRankScore(product: RankableProduct): number {
  const clicks = clickScore(product.clickCount);
  const views = viewScore(product.viewCount);
  const ctr = ctrScore(product.clickCount, product.viewCount);
  const recent = recencyScore(product.createdAt);

  return clicks * 0.38 + views * 0.22 + ctr * 0.2 + recent * 0.2;
}

export function sortByRank<T extends RankableProduct>(products: T[]): T[] {
  return [...products].sort((a, b) => computeRankScore(b) - computeRankScore(a));
}
