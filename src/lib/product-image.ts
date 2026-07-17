const PLACEHOLDER = "/images/placeholder-product.svg";

const AMAZON_I =
  /^(https?:)?\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/I\//i;
const AMAZON_P =
  /^(https?:)?\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/P\//i;

/** Encode + in URL path so browsers don't treat it as a space. */
function encodePlusInPath(url: string): string {
  const q = url.indexOf("?");
  const path = q >= 0 ? url.slice(0, q) : url;
  const qs = q >= 0 ? url.slice(q) : "";
  if (!path.includes("+")) return url;
  return path.replace(/\+/g, "%2B") + qs;
}

/** Collapse broken Amazon size / webp token chains into a stable SL500 asset. */
function stabilizeAmazonI(url: string): string {
  if (!AMAZON_I.test(url)) return url;
  if (!/\.__AC_|FMwebp|_AC_SX\d+/i.test(url)) return url;
  const m = url.match(/^(https?:\/\/[^/]+\/images\/I\/[^./]+)/i);
  if (!m) return url;
  return `${m[1]}._AC_SL500_.jpg`;
}

/** Make Amazon CDN URLs more reliable (https, encoded +, no sprites). */
export function normalizeProductImage(url?: string | null): string {
  if (!url) return PLACEHOLDER;
  let u = url.trim().replace(/\\u002F/g, "/");
  if (!u) return PLACEHOLDER;
  if (u.startsWith("//")) u = `https:${u}`;
  if (u.startsWith("/")) return u;

  const isAmazon = AMAZON_I.test(u) || AMAZON_P.test(u);
  if (!isAmazon) return u;

  // Skip Amazon UI sprites
  if (/\/I\/[A-Za-z0-9]+\._RC/i.test(u) || /sprite|transparent-pixel/i.test(u)) {
    return PLACEHOLDER;
  }

  u = stabilizeAmazonI(u);
  u = encodePlusInPath(u);

  // Only add a size token when the URL has none — rewriting existing tokens can 404
  if (
    AMAZON_I.test(u) &&
    !/\._[A-Za-z0-9,%_-]+_\.(jpe?g|png|webp)/i.test(u) &&
    /\.(jpe?g|png|webp)(\?.*)?$/i.test(u)
  ) {
    u = u.replace(/\.(jpe?g|png|webp)(\?.*)?$/i, "._AC_SL500_.$1$2");
  }

  return u;
}

export function productImagePlaceholder() {
  return PLACEHOLDER;
}

/** Prefer a same-origin proxy so the browser isn't rate-limited by Amazon CDN. */
export function proxiedProductImage(url?: string | null): string {
  const normalized = normalizeProductImage(url);
  if (!normalized || normalized === PLACEHOLDER || normalized.startsWith("/")) {
    return normalized || PLACEHOLDER;
  }
  if (!/media-amazon\.com|images-amazon\.com|amazon-adsystem\.com/i.test(normalized)) {
    return normalized;
  }
  return `/api/img?u=${encodeURIComponent(normalized)}`;
}
