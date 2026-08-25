import { NextResponse } from "next/server";
import { authenticateInventoryAdapterRequest } from "@/lib/inventory-adapter-auth";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024;

async function readRawBody(req: Request) {
  const declared = req.headers.get("content-length");
  if (declared) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      throw new Error("ADAPTER_BODY_TOO_LARGE");
    }
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error("ADAPTER_BODY_TOO_LARGE");
  return new TextDecoder().decode(bytes);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "ADAPTER_CERTIFICATION_FAILED";

  if (message === "ADAPTER_AUTH_NOT_CONFIGURED") {
    return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (
    message === "ADAPTER_SIGNATURE_INVALID" ||
    message === "ADAPTER_TIMESTAMP_INVALID" ||
    message === "ADAPTER_ID_INVALID" ||
    message === "ADAPTER_SOURCE_KEY_INVALID" ||
    message === "ADAPTER_NONCE_INVALID" ||
    message === "ADAPTER_SIGNATURE_INVALID"
  ) {
    return NextResponse.json({ error: "ADAPTER_AUTH_FAILED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (message === "ADAPTER_SCOPE_FORBIDDEN") {
    return NextResponse.json({ error: message }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (message === "ADAPTER_REPLAY_DETECTED") {
    return NextResponse.json({ error: message }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (message === "ADAPTER_BODY_TOO_LARGE") {
    return NextResponse.json({ error: message }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { error: "ADAPTER_CERTIFICATION_FAILED" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * No-op production certification endpoint for the signed inventory adapter boundary.
 *
 * The exact raw bytes are authenticated by the same HMAC/timestamp/source-scope/
 * durable-nonce verifier used by the operational adapter route. A successful call
 * proves that the provisioned runtime binding is visible and usable without claiming
 * work, changing inventory, enabling commerce, touching payments, or procuring goods.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await readRawBody(req);
    const identity = await authenticateInventoryAdapterRequest({ headers: req.headers, body: rawBody });

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "ADAPTER_CERTIFICATION_REQUEST_INVALID" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      (parsed as { action?: unknown }).action !== "certify"
    ) {
      return NextResponse.json(
        { error: "ADAPTER_CERTIFICATION_REQUEST_INVALID" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        certified: true,
        protocol: "inventory-adapter-hmac-v1",
        adapterId: identity.adapterId,
        sourceKey: identity.sourceKey,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
