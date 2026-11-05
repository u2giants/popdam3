import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
const serving = vi.hoisted(() => ({ handler: null as null | ((request: Request) => Promise<Response>) }));
vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (handler: typeof serving.handler) => { serving.handler = handler; } }));
import { corsServe, err, json } from "./http";
import { hasCatalogCodeFormat } from "./catalog-code-format";
import { withSearchRequestBudget } from "./search-request-budget";

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Local transport witness missing")), 2000); })]); }
  finally { clearTimeout(timer); }
}

it("the existing CORS Request signal cancels actual pending HTTP work for the format hint", async () => {
  let started!: () => void, closed!: () => void;
  const witnessed = new Promise<void>(resolve => { started = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_request, response) => { response.once("close", closed); started(); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local listener missing");
  const read = vi.fn(async (_format: string, signal: AbortSignal) => {
    await fetch(`http://127.0.0.1:${address.port}/pending`, { signal });
    return { data: true, error: null };
  });
  corsServe(request => withSearchRequestBudget(request, async signal => {
    try { return json({ format: await hasCatalogCodeFormat("ZZZ83MVSP99", read, signal) }); }
    catch { return err("Search unavailable", 503); }
  }));
  const controller = new AbortController();
  const result = serving.handler!(new Request("https://example.invalid/search", { signal: controller.signal, headers: { Origin: "https://dam.designflow.app" } }));
  try {
    await bounded(witnessed); controller.abort();
    expect((await result).status).toBe(503);
    await bounded(disconnected);
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0][1].aborted).toBe(true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  // Local Request/CORS/native HTTP proof only. Hosted gateway propagation and
  // cancellation of already-started server SQL are not claimed here.
});
