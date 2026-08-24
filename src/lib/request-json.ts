export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "INVALID_JSON" | "BODY_TOO_LARGE" };

/** Read a JSON request body while enforcing the cap on bytes actually consumed. */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<LimitedJsonResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("INVALID_JSON_BODY_LIMIT");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) return { ok: false, error: "INVALID_JSON" };
    if (declared > maxBytes) return { ok: false, error: "BODY_TOO_LARGE" };
  }

  if (!request.body) return { ok: false, error: "INVALID_JSON" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: "BODY_TOO_LARGE" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
}
