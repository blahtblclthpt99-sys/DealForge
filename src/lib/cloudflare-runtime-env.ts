type ProcessEnvTarget = Record<string, string | undefined>;

/**
 * OpenNext executes application modules behind the custom Worker entrypoint.
 * Cloudflare exposes text vars and secrets on the request `env` binding, while
 * DealForge's server modules use Node-compatible `process.env`. Mirror only
 * string bindings at the boundary so those modules see the exact bindings of
 * the Worker version handling the request.
 *
 * Binding values are never logged or serialized here.
 */
export function hydrateCloudflareProcessEnv(
  bindings: Record<string, unknown>,
  target: ProcessEnvTarget = process.env,
) {
  for (const [name, value] of Object.entries(bindings)) {
    if (typeof value !== "string") continue;
    target[name] = value;
  }
}
