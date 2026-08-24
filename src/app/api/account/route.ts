import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readLimitedJson } from "@/lib/request-json";
import { parseJson } from "@/lib/utils";

const AccountPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    settings: z
      .object({
        emailAlerts: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.settings !== undefined, {
    message: "No account changes supplied",
  });

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  const session = await readSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);

  const read = await readLimitedJson(req, 8 * 1024);
  if (!read.ok) {
    return json({ error: read.error === "BODY_TOO_LARGE" ? "ACCOUNT_REQUEST_TOO_LARGE" : "INVALID_ACCOUNT_UPDATE" }, read.error === "BODY_TOO_LARGE" ? 413 : 400);
  }
  const parsed = AccountPatchSchema.safeParse(read.value);
  if (!parsed.success) return json({ error: "INVALID_ACCOUNT_UPDATE" }, 400);

  const current = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, settings: true },
  });
  if (!current) return json({ error: "UNAUTHORIZED" }, 401);

  const settings = parseJson<Record<string, unknown>>(current.settings, {});
  if (parsed.data.settings?.emailAlerts !== undefined) {
    settings.emailAlerts = parsed.data.settings.emailAlerts;
  }

  const updated = await prisma.user.update({
    where: { id: current.id },
    data: {
      name: parsed.data.name,
      settings: parsed.data.settings ? JSON.stringify(settings) : undefined,
    },
    select: { id: true, name: true, email: true },
  });

  return json({ ok: true, user: updated });
}
