import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mutateUserJsonState } from "@/lib/user-json-state";
import { parseJson } from "@/lib/utils";

type SavedSearch = {
  id: string;
  query: string;
  filters: Record<string, string>;
  createdAt: string;
};

const saveSearchSchema = z.object({
  query: z.string().trim().max(200).optional().default(""),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
});
const deleteSearchSchema = z.object({ id: z.string().trim().min(1).max(100) });
const storedSearchSchema = z.object({
  id: z.string().trim().min(1).max(100),
  query: z.string().max(200),
  filters: z.record(z.string(), z.string()),
  createdAt: z.string().max(64),
});
const MAX_SAVED_SEARCHES = 30;
const MAX_FILTERS = 20;
const MAX_FILTER_KEY_LENGTH = 80;
const MAX_FILTER_VALUE_LENGTH = 200;

function normalizeFilters(input: Record<string, unknown>) {
  const filters: Record<string, string> = {};
  const entries = Object.entries(input)
    .map(([key, value]) => [key.trim().slice(0, MAX_FILTER_KEY_LENGTH), value] as const)
    .filter(([key, value]) => Boolean(key) && value != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_FILTERS);

  for (const [key, value] of entries) {
    const normalizedValue = String(value).trim().slice(0, MAX_FILTER_VALUE_LENGTH);
    if (normalizedValue) filters[key] = normalizedValue;
  }
  return filters;
}

function cleanSavedSearches(value: unknown): SavedSearch[] {
  if (!Array.isArray(value)) return [];
  const cleaned: SavedSearch[] = [];
  for (const item of value) {
    const parsed = storedSearchSchema.safeParse(item);
    if (!parsed.success) continue;
    cleaned.push({
      id: parsed.data.id,
      query: parsed.data.query.trim().slice(0, 200),
      filters: normalizeFilters(parsed.data.filters),
      createdAt: parsed.data.createdAt,
    });
    if (cleaned.length >= MAX_SAVED_SEARCHES) break;
  }
  return cleaned;
}

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { savedSearches: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    savedSearches: cleanSavedSearches(parseJson<unknown>(user.savedSearches || "[]", [])),
  });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = saveSearchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const filters = normalizeFilters(parsed.data.filters);
  if (!parsed.data.query && Object.keys(filters).length === 0) {
    return NextResponse.json({ error: "Search cannot be empty" }, { status: 400 });
  }

  const entry: SavedSearch = {
    id: `s_${crypto.randomUUID()}`,
    query: parsed.data.query,
    filters,
    createdAt: new Date().toISOString(),
  };
  const fingerprint = `${entry.query}\n${JSON.stringify(entry.filters)}`;

  const result = await mutateUserJsonState<unknown>(
    session.id,
    "savedSearches",
    [],
    (current) => {
      const saved = cleanSavedSearches(current);
      const deduped = saved.filter(
        (search) => `${search.query}\n${JSON.stringify(search.filters)}` !== fingerprint,
      );
      return [entry, ...deduped].slice(0, MAX_SAVED_SEARCHES);
    },
  );

  if (result.status === "not-found") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: "Saved searches changed concurrently; retry" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, savedSearches: cleanSavedSearches(result.value) });
}

export async function DELETE(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = deleteSearchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const result = await mutateUserJsonState<unknown>(
    session.id,
    "savedSearches",
    [],
    (current) => cleanSavedSearches(current).filter((search) => search.id !== parsed.data.id),
  );

  if (result.status === "not-found") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.status === "conflict") {
    return NextResponse.json({ error: "Saved searches changed concurrently; retry" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
