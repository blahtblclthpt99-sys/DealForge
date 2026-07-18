/**
 * Extract pack / unit quantity from Amazon-style product titles.
 * Examples: "132 Count", "72 Total", "Pack of 4", "18 Ct", "4 Flip-Top Packs"
 */
export function parseQuantityFromTitle(title: string): number | null {
  if (!title) return null;
  const t = title.replace(/,/g, "");

  const patterns: RegExp[] = [
    /\b(\d{1,5})\s*(?:count|ct\.?|pcs?|pieces?|wipes?|diapers?|pads?)\b/i,
    /\b(\d{1,5})\s*total\b/i,
    /\bpack\s*of\s*(\d{1,5})\b/i,
    /\b(\d{1,5})\s*(?:-?\s*)?pack(?:s)?\b/i,
    /\b(\d{1,5})\s*x\s*(?:flip[- ]?top|packs?)\b/i,
    /\((\d{1,5})\s*(?:count|ct\.?|pcs?|pack)\)/i,
    // Amazon diaper style: "Size 4 (22-37 lbs), 108, Up to 100%..."
    /\)\s*,\s*(\d{2,5})\s*,/i,
    /,\s*(\d{2,5})\s*,\s*(?:up to|fragrance|hypoallergenic|absorbent|nighttime|babyproof)/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100_000) return n;
  }
  return null;
}

export function formatQuantityLabel(quantity: number | null | undefined) {
  if (quantity == null || !(quantity >= 1)) return null;
  return `QNTY ${quantity.toLocaleString()}`;
}
