const PLACEHOLDER = "/images/placeholder-product.svg";

/** Make Amazon CDN URLs more reliable (https, no sprites). */
export function normalizeProductImage(url?: string | null): string {
  if (!url) return PLACEHOLDER;
  let u = url.trim().replace(/\\u002F/g, "/");
  if (!u) return PLACEHOLDER;
  if (u.startsWith("//")) u = `https:${u}`;

  const isAmazonCdn =
    /m\.media-amazon\.com\/images\/I\//i.test(u) ||
    /images-na\.ssl-images-amazon\.com\/images\/I\//i.test(u);

  if (isAmazonCdn) {
    // Skip Amazon UI sprites
    if (/\/I\/[A-Za-z0-9]+\._RC/i.test(u) || /sprite|transparent-pixel/i.test(u)) {
      return PLACEHOLDER;
    }
    // Only add a size token when the URL has none — rewriting existing tokens can 404
    if (!/\._[A-Za-z0-9,_-]+_\.(jpe?g|png|webp)/i.test(u) && /\.(jpe?g|png|webp)(\?.*)?$/i.test(u)) {
      u = u.replace(/\.(jpe?g|png|webp)(\?.*)?$/i, "._AC_SL500_.$1$2");
    }
  }
  return u;
}

export function productImagePlaceholder() {
  return PLACEHOLDER;
}
