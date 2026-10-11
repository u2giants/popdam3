import assert from "node:assert/strict";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createMetaDispatcher } from "./meta-connection.js";

async function listen(server: Server, host: string, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port, ipv6Only: true }, resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("Meta prefers IPv6 while ordinary worker requests keep their DNS order", async () => {
  const originalOrder = getDefaultResultOrder();
  const ipv6 = createServer((_request, response) => response.end("IPv6"));
  const ipv4 = createServer((_request, response) => response.end("IPv4"));
  const dispatcher = createMetaDispatcher();
  try {
    setDefaultResultOrder("ipv4first");
    const port = await listen(ipv6, "::1");
    await listen(ipv4, "127.0.0.1", port);
    const url = `http://localhost:${port}`;
    assert.equal(await (await fetch(url)).text(), "IPv4");
    const options = { dispatcher, signal: AbortSignal.timeout(2000) };
    assert.equal(await (await fetch(url, options)).text(), "IPv6");
    assert.equal(getDefaultResultOrder(), "ipv4first");
    assert.equal(await (await fetch(url)).text(), "IPv4");
  } finally {
    setDefaultResultOrder(originalOrder);
    await dispatcher.close();
    await Promise.all([close(ipv6), close(ipv4)]);
  }
});

test("Meta retains IPv4 connection fallback when IPv6 cannot connect", async () => {
  const ipv4 = createServer((_request, response) => response.end("IPv4 fallback"));
  const dispatcher = createMetaDispatcher();
  try {
    const port = await listen(ipv4, "127.0.0.1");
    const options = { dispatcher, signal: AbortSignal.timeout(2000) };
    assert.equal(await (await fetch(`http://localhost:${port}`, options)).text(), "IPv4 fallback");
  } finally {
    await dispatcher.close();
    await close(ipv4);
  }
});
