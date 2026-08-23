import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROBE_MARKER = "phase25_delivery_probe_20260823_1840";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  const event = body as Record<string, unknown>;
  const data = event.data;
  const object =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).object
      : null;
  const metadata =
    object && typeof object === "object" && !Array.isArray(object)
      ? (object as Record<string, unknown>).metadata
      : null;

  const marker =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).dealforge_probe
      : null;

  if (event.type !== "payment_link.created" || marker !== PROBE_MARKER) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const eventId = typeof event.id === "string" ? event.id : "unknown";
  await prisma.systemLog.create({
    data: {
      level: "info",
      source: "stripe-delivery-probe",
      message: "Stripe delivery probe arrived",
      meta: JSON.stringify({ eventId, type: event.type, marker: PROBE_MARKER }),
    },
  });

  return NextResponse.json({ received: true });
}
