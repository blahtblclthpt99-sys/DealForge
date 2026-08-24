import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLimitedJson } from "@/lib/request-json";
import { parseJson } from "@/lib/utils";

type SavedSearch = {
  id: string;
  query: string;
  filters: Record<string, string>;
  createdAt: string;
};

const MAX_SAVED_SEARCHES = 30;
const MAX_FILTERS = 12;
const PostSchema = z
  .object({
    query: z.string().trim().max(256).default(""),
    filters: z.unknown().optional(),
  })
  .strict();
const DeleteSchema = z.object({ id: z.string().trim().min(3).max(80) }).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function normalizeFilters(value: unknown): Record<string, string> | null {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_FILTERS) return null;

  const filters: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) return null;
    if (rawValue == null) continue;
    if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") return null;
    if (typeof rawValue === "number" && !Number.isFinite(rawValue)) return null;
    const text = String(rawValue).trim();
    if (!text) continue;
    if (text.length > 256) return null;
    filters[key] = text;
  }
  return filters;
}

function loadSavedSearches(raw: string) {
  const parsed = parseJson<unknown[]>(raw, []);
  const safe: SavedSearch[] = [];
  for (const item of parsed.slice(0, MAX_SAVED_SEARCHES)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const filters = normalizeFilters(row.filters);
    if (
      typeof row.id !== "string" || row.id.length > 80 ||
      typeof row.query !== "string" || row.query.length > 256 ||
      typeof row.createdAt !== "string" || row.createdAt.length > 64 ||
      !filters
    ) continue;
    safe.push({ id: row.id, query: row.query, filters, createdAt: row.createdAt });
  }
  return safe;
}

export async function GET() {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { savedSearches: true } });
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);
  return json({ savedSearches: loadSavedSearches(user.savedSearches) });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);

  const read = await readLimitedJson(req, 8 * 1024);
  if (!read.ok) return json({ error: read.error === "BODY_TOO_LARGE" ? "SAVED_SEARCH_REQUEST_TOO_LARGE" : "INVALID_SAVED_SEARCH" }, read.error === "BODY_TOO_LARGE" ? 413 : 400);
  const parsed = PostSchema.safeParse(read.value);
  if (!parsed.success) return json({ error: "INVALID_SAVED_SEARCH" }, 400);
  const filters = normalizeFilters(parsed.data.filters);
  if (!filters) return json({ error: "INVALID_SAVED_SEARCH_FILTERS" }, 400);

  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, savedSearches: true } });
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  const saved = loadSavedSearches(user.savedSearches);
  const entry: SavedSearch = {
    id: `s_${Date.now()}`,
    query: parsed.data.query,
    filters,
    createdAt: new Date().toISOString(),
  };
  const deduped = saved.filter(
    (item) => !(item.query === entry.query && JSON.stringify(item.filters) === JSON.stringify(entry.filters)),
  );
  deduped.unshift(entry);
  const next = deduped.slice(0, MAX_SAVED_SEARCHES);
  await prisma.user.update({ where: { id: user.id }, data: { savedSearches: JSON.stringify(next) } });
  return json({ ok: true, savedSearches: next });
}

export async function DELETE(req: Request) {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);

  const read = await readLimitedJson(req, 2 * 1024);
  if (!read.ok) return json({ error: read.error === "BODY_TOO_LARGE" ? "SAVED_SEARCH_REQUEST_TOO_LARGE" : "INVALID_SAVED_SEARCH_DELETE" }, read.error === "BODY_TOO_LARGE" ? 413 : 400);
  const parsed = DeleteSchema.safeParse(read.value);
  if (!parsed.success) return json({ error: "INVALID_SAVED_SEARCH_DELETE" }, 400);

  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, savedSearches: true } });
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);
  const saved = loadSavedSearches(user.savedSearches).filter((item) => item.id !== parsed.data.id);
  await prisma.user.update({ where: { id: user.id }, data: { savedSearches: JSON.stringify(saved) } });
  return json({ ok: true });
}
