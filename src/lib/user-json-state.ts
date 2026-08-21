import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { parseJson } from "./utils";

export type MutableUserJsonField =
  | "wishlist"
  | "savedSearches"
  | "recentlyViewed"
  | "priceAlerts"
  | "settings";

export type UserJsonMutationResult<T> =
  | { status: "ok"; value: T }
  | { status: "not-found" }
  | { status: "conflict" };

const MAX_RETRIES = 4;

/**
 * Optimistically mutate one JSON-backed User field without silently clobbering
 * another request that updated the same user row after our read.
 *
 * The existing schema intentionally keeps these small preference collections as
 * JSON strings. Using updatedAt as a compare-and-swap token gives us safe
 * concurrent behavior on both SQLite CI and production PostgreSQL without a
 * schema migration.
 */
export async function mutateUserJsonState<T>(
  userId: string,
  field: MutableUserJsonField,
  fallback: T,
  transform: (current: T) => T,
): Promise<UserJsonMutationResult<T>> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        wishlist: true,
        savedSearches: true,
        recentlyViewed: true,
        priceAlerts: true,
        settings: true,
        updatedAt: true,
      },
    });

    if (!user) return { status: "not-found" };

    const current = parseJson<T>(user[field], fallback);
    const next = transform(current);
    let serialized: string;
    try {
      serialized = JSON.stringify(next);
    } catch {
      return { status: "conflict" };
    }

    const data = { [field]: serialized } as Prisma.UserUpdateManyMutationInput;
    const updated = await prisma.user.updateMany({
      where: { id: userId, updatedAt: user.updatedAt },
      data,
    });

    if (updated.count === 1) {
      return { status: "ok", value: next };
    }
  }

  return { status: "conflict" };
}
