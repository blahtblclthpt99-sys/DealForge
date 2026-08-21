import type { Prisma } from "@prisma/client";

const BLOCK_MARKERS = [
  '"storefrontBlocked":true',
  '"storefrontBlocked": true',
];

const ENRICHMENT_MARKERS = [
  '"needsEnrichment":true',
  '"needsEnrichment": true',
];

export function publicProductVisibilityClauses(): Prisma.ProductWhereInput[] {
  return [
    ...ENRICHMENT_MARKERS.map((marker) => ({
      NOT: { specifications: { contains: marker } },
    })),
    ...BLOCK_MARKERS.map((marker) => ({
      NOT: { specifications: { contains: marker } },
    })),
    { NOT: { title: { startsWith: "Coach product " } } },
    { NOT: { title: { startsWith: "Amazon listing " } } },
  ];
}

export function publicProductWhere(
  extra?: Prisma.ProductWhereInput,
): Prisma.ProductWhereInput {
  return {
    AND: [
      ...publicProductVisibilityClauses(),
      ...(extra ? [extra] : []),
    ],
  };
}

export function isStorefrontBlockedSpecifications(specifications: string) {
  if (!specifications) return false;
  try {
    const parsed = JSON.parse(specifications) as Record<string, unknown>;
    return parsed.storefrontBlocked === true;
  } catch {
    return BLOCK_MARKERS.some((marker) => specifications.includes(marker));
  }
}
