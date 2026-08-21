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
  | { status: "ok"; value: T; previous: T; changed: boolean }
  | { status: "not-found" }
  | { status: "conflict" };

const MAX_RETRIES = 4;

/**
 * Optimistically mutate one JSON-backed User field without silently clobbering
 * another request that updated the same field after our read.
 *
 * The existing schema intentionally keeps these small preference collections as
 * JSON strings. The compare-and-swap predicate matches the exact stored field
 * value, which is stronger than relying on timestamp precision and also lets
 * unrelated user fields update concurrently without causing false conflicts.
 *
 * On success, `previous` is the exact state used by the successful compare-and-
 * swap attempt. Callers can safely derive transition-only side effects after
 * the write without duplicating them across retry attempts. No-op mutations do
 * not update the row or its updatedAt timestamp.
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
      },
    });

    if (!user) return { status: "not-found" };

    const stored = user[field];
    const current = parseJson<T>(stored, fallback);
    const next = transform(current);
    let serialized: string;
    let currentSerialized: string;
    try {
      serialized = JSON.stringify(next);
      currentSerialized = JSON.stringify(current);
    } catch {
      return { status: "conflict" };
    }

    if (serialized === currentSerialized && stored === currentSerialized) {
      return { status: "ok", value: next, previous: current, changed: false };
    }

    const data = { [field]: serialized } as Prisma.UserUpdateManyMutationInput;
    const fieldPredicate = { [field]: stored } as Prisma.UserWhereInput;
    const updated = await prisma.user.updateMany({
      where: { id: userId, AND: [fieldPredicate] },
      data,
    });

    if (updated.count === 1) {
      return {
        status: "ok",
        value: next,
        previous: current,
        changed: serialized !== stored,
      };
    }
  }

  return { status: "conflict" };
}
