#!/usr/bin/env node
/**
 * `router-proxy` — an OpenAI-compatible router in front of a host.
 *
 *   node apps/router-proxy/dist/index.js [--config router-proxy.json]
 *
 * The host points a provider's `baseURL` here and names one of the configured
 * virtual models. The proxy decides which backend serves each request, so the
 * host's model choice becomes a *policy* rather than a fixed pin.
 */
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

function configPath(argv: string[]): string {
  const at = argv.indexOf("--config");
  if (at >= 0 && argv[at + 1]) return argv[at + 1]!;
  return process.env.ADAPTIVE_ROUTER_CONFIG ?? "router-proxy.json";
}

const path = configPath(process.argv.slice(2));
const config = loadConfig(path);
const server = createApp(config);

server.listen(config.listen.port, config.listen.host, () => {
  const { host, port } = config.listen;
  console.error(
    `[router-proxy] listening on http://${host}:${port} — models: ${Object.keys(config.models).join(", ")}`,
  );
  console.error(
    `[router-proxy] backends: ${Object.entries(config.backends)
      .map(([name, backend]) => `${name}=${backend.model} (${backend.baseURL})`)
      .join(", ")}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
