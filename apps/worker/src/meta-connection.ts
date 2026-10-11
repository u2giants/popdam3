import { lookup } from "node:dns";
import { Agent } from "undici";

// Meta's catalog is available from this worker over IPv6. Keep the DNS
// addresses dynamic and retain IPv4 connection fallback, scoped to Meta.
export function createMetaDispatcher(): Agent {
  return new Agent({
    autoSelectFamily: true,
    connect: {
      lookup(hostname, options, callback) {
        lookup(hostname, { ...options, order: "ipv6first" }, callback);
      },
    },
  });
}

export const metaDispatcher = createMetaDispatcher();
