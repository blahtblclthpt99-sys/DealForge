/**
 * Ranking algorithm for DealForge product discovery.
 * Prioritizes discount, rating, reviews, trending, freshness, and CTR.
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

const WEIGHTS = {
  discount: 0.28,
  rating: 0.2,
  reviews: 0.15,
  trending: 0.15,
  freshness: 0.12,
  ctr: 0.1,
} as const;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function freshnessScore(date: Date | string) {
  const ts = new Date(date).getTime();
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  // Full score within 2 days, decays toward 0 over ~45 days
  return clamp01(1 - ageDays / 45);
}

function reviewScore(count: number) {
  // Log-scale so mega-reviewed items don't dominate
  return clamp01(Math.log10(count + 1) / 5);
}

function ctrScore(clicks: number, views: number) {
  if (views <= 0) return clicks > 0 ? 0.5 : 0;
  return clamp01(clicks / Math.max(views, 1));
}

export function computeRankScore(product: RankableProduct): number {
  const discount = clamp01(product.discountPercent / 70);
  const rating = clamp01(product.rating / 5);
  const reviews = reviewScore(product.reviewCount);
  const trending = clamp01(product.trendingScore / 100);
  const freshness = freshnessScore(product.lastUpdated || product.createdAt);
  const ctr = ctrScore(product.clickCount, product.viewCount);

  return (
    discount * WEIGHTS.discount +
    rating * WEIGHTS.rating +
    reviews * WEIGHTS.reviews +
    trending * WEIGHTS.trending +
    freshness * WEIGHTS.freshness +
    ctr * WEIGHTS.ctr
  );
}

export function sortByRank<T extends RankableProduct>(products: T[]): T[] {
  return [...products].sort(
    (a, b) => computeRankScore(b) - computeRankScore(a),
  );
}
