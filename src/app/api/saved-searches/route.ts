import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";

type SavedSearch = {
  id: string;
  query: string;
  filters: Record<string, unknown>;
  createdAt: string;
};

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  return NextResponse.json({ savedSearches: parseJson<SavedSearch[]>(user?.savedSearches || "[]", []) });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const saved = parseJson<SavedSearch[]>(user.savedSearches, []);
  const filtersIn = (body.filters || {}) as Record<string, unknown>;
  const filters: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filtersIn)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) filters[k] = s;
  }
  const entry: SavedSearch = {
    id: `s_${Date.now()}`,
    query: typeof body.query === "string" ? body.query.trim() : "",
    filters,
    createdAt: new Date().toISOString(),
  };
  // Avoid exact duplicate at top of list
  const deduped = saved.filter(
    (s) => !(s.query === entry.query && JSON.stringify(s.filters) === JSON.stringify(entry.filters)),
  );
  deduped.unshift(entry);
  await prisma.user.update({
    where: { id: user.id },
    data: { savedSearches: JSON.stringify(deduped.slice(0, 30)) },
  });
  return NextResponse.json({ ok: true, savedSearches: deduped.slice(0, 30) });
}

export async function DELETE(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json();
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const saved = parseJson<SavedSearch[]>(user.savedSearches, []).filter((s) => s.id !== id);
  await prisma.user.update({
    where: { id: user.id },
    data: { savedSearches: JSON.stringify(saved) },
  });
  return NextResponse.json({ ok: true });
}
