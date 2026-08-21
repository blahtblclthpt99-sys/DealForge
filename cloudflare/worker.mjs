import nextWorker from "../.open-next/worker.js";

// Preserve named exports emitted by OpenNext (for example Durable Object
// classes) while wrapping only its default handler.
export * from "../.open-next/worker.js";

const encoder = new TextEncoder();

async function maintenanceSignature(secret, timestamp) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`dealforge-maintenance:${timestamp}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const worker = {
  fetch(request, env, ctx) {
    return nextWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const startedAt = Date.now();
    const secret = typeof env.AUTH_SECRET === "string" ? env.AUTH_SECRET.trim() : "";
    if (secret.length < 32) {
      throw new Error("AUTH_SECRET is unavailable for DealForge scheduled maintenance");
    }

    const timestamp = String(Date.now());
    const signature = await maintenanceSignature(secret, timestamp);
    const request = new Request("https://dealforge.internal/api/internal/maintenance", {
      method: "POST",
      headers: {
        "x-dealforge-maintenance-timestamp": timestamp,
        "x-dealforge-maintenance-signature": signature,
      },
    });

    try {
      // Dispatch through the already-generated Next worker so maintenance code
      // shares the app bundle instead of pulling a second Prisma/runtime copy
      // into this thin Cloudflare entrypoint.
      const response = await nextWorker.fetch(request, env, ctx);
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Maintenance route failed (${response.status}): ${body.slice(0, 500)}`);
      }

      console.log(
        JSON.stringify({
          event: "dealforge-maintenance",
          cron: controller.cron,
          durationMs: Date.now() - startedAt,
          result: body,
        }),
      );
    } catch (error) {
      console.error("DealForge scheduled maintenance failed", error);
      throw error;
    }
  },
};

export default worker;
