/**
 * Clothing department filters (Amazon-style: gender / age / type).
 */
export const CLOTHING_SUBCATEGORIES = [
  { slug: "mens", label: "Mens" },
  { slug: "womens", label: "Womens" },
  { slug: "children", label: "Children" },
  { slug: "infant", label: "Infant" },
  { slug: "unisex", label: "Unisex" },
  { slug: "shoes", label: "Shoes" },
  { slug: "accessories", label: "Accessories" },
] as const;

export type ClothingSubcategory = (typeof CLOTHING_SUBCATEGORIES)[number]["slug"];

const SHOE =
  /\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|slipper|slippers|loafer|heel|heels|cleat|cleats|footwear)\b/i;

const ACCESSORY =
  /\b(hat|hats|cap\b|beanie|scarf|scarves|glove|gloves|belt|belts|wallet|purse|handbag|backpack|tote|jewelry|necklace|bracelet|earring|sunglass|sunglasses|tie|ties|bowtie|headband|hairband|umbrella)\b/i;

const INFANT =
  /\b(infant|infants|baby|babies|newborn|newborns|toddler|toddlers|onesie|onesies|crib shoe|0-3 month|3-6 month|6-12 month)\b/i;

const CHILDREN =
  /\b(kid|kids|child|children|boy'?s?\b|girl'?s?\b|youth|junior|juniors|little boy|little girl|school uniform)\b/i;

const WOMENS =
  /\b(women'?s?|woman|ladies|lady|female|maternity|bra\b|bras\b|blouse|skirt|dress\b|dresses|leggings|camisole|panties|lingerie|heel)\b/i;

const MENS =
  /\b(men'?s?|man\b|male|gentleman|guys?\b|menswear|necktie)\b/i;

/**
 * Infer a clothing subcategory from product title (and optional brand).
 */
export function inferClothingSubcategory(
  title: string,
  brand = "",
): ClothingSubcategory {
  // Strip Amazon category suffixes like ": Clothing, Shoes & Jewelry"
  const cleaned = title.replace(/\s*:\s*[^:]{0,60}$/, "").trim();
  const text = `${cleaned} ${brand}`.trim();

  if (INFANT.test(text)) return "infant";
  if (CHILDREN.test(text) && !WOMENS.test(text) && !MENS.test(text)) return "children";
  if (CHILDREN.test(text) && /girl/i.test(text)) return "children";
  if (CHILDREN.test(text) && /boy/i.test(text)) return "children";

  // Footwear often tagged separately even when gendered
  if (SHOE.test(text)) {
    if (WOMENS.test(text) && !MENS.test(text)) return "womens";
    if (MENS.test(text) && !WOMENS.test(text)) return "mens";
    if (CHILDREN.test(text) || INFANT.test(text)) return CHILDREN.test(text) ? "children" : "infant";
    return "shoes";
  }

  if (ACCESSORY.test(text) && !WOMENS.test(text) && !MENS.test(text) && !CHILDREN.test(text)) {
    return "accessories";
  }

  if (WOMENS.test(text) && !MENS.test(text)) return "womens";
  if (MENS.test(text) && !WOMENS.test(text)) return "mens";
  if (WOMENS.test(text) && MENS.test(text)) return "unisex";

  if (ACCESSORY.test(text)) return "accessories";
  if (/\bunisex\b/i.test(text)) return "unisex";

  return "unisex";
}

export function clothingSubcategoryLabel(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return CLOTHING_SUBCATEGORIES.find((c) => c.slug === slug)?.label ?? null;
}
