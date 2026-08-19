import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
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
const deleteSearchSchema = z.object({ id: z.string().min(1).max(100) });
const MAX_SAVED_SEARCHES = 30;
const MAX_FILTERS = 20;
const MAX_FILTER_VALUE_LENGTH = 200;

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ savedSearches: parseJson<SavedSearch[]>(user.savedSearches || "[]", []) });
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

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data.filters).slice(0, MAX_FILTERS)) {
    const normalizedKey = key.trim().slice(0, 80);
    if (!normalizedKey || value == null) continue;
    const normalizedValue = String(value).trim().slice(0, MAX_FILTER_VALUE_LENGTH);
    if (normalizedValue) filters[normalizedKey] = normalizedValue;
  }

  if (!parsed.data.query && Object.keys(filters).length === 0) {
    return NextResponse.json({ error: "Search cannot be empty" }, { status: 400 });
  }

  const saved = parseJson<SavedSearch[]>(user.savedSearches, []);
  const entry: SavedSearch = {
    id: `s_${Date.now()}`,
    query: parsed.data.query,
    filters,
    createdAt: new Date().toISOString(),
  };
  const deduped = saved.filter(
    (search) =>
      !(search.query === entry.query && JSON.stringify(search.filters) === JSON.stringify(entry.filters)),
  );
  const nextSaved = [entry, ...deduped].slice(0, MAX_SAVED_SEARCHES);

  await prisma.user.update({
    where: { id: user.id },
    data: { savedSearches: JSON.stringify(nextSaved) },
  });
  return NextResponse.json({ ok: true, savedSearches: nextSaved });
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

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const saved = parseJson<SavedSearch[]>(user.savedSearches, []).filter(
    (search) => search.id !== parsed.data.id,
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { savedSearches: JSON.stringify(saved) },
  });
  return NextResponse.json({ ok: true });
}
