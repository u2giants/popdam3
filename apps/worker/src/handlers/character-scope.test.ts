import test from "node:test";
import assert from "node:assert/strict";
import { resolveCharacterScope, skuLicensorCode, buildImageTaggingPrompt, LICENSOR_CHARACTER_LIST_LIMIT } from "./ai-tagging-shared.js";

const passthrough = <T>(query: PromiseLike<T>) => Promise.resolve(query);
const noop = () => {};

function fakeClient(group: Record<string, unknown> | null, licensors: { id: string; code: string }[]) {
  const table = (name: string) => {
    let code: unknown;
    const chain = {
      select: () => chain,
      eq: (_column: string, value: unknown) => { code = value; return chain; },
      maybeSingle: async () => ({ data: name === "style_groups" ? group : null, error: null }),
      limit: async () => ({ data: licensors.filter(l => l.code === code), error: null }),
    };
    return chain;
  };
  return { from: table, schema: () => ({ from: table }) } as never;
}

test("skuLicensorCode reads the licensor code from characters 6-7", () => {
  assert.equal(skuLicensorCode("HXPS2MVDP01"), "MV");
  assert.equal(skuLicensorCode("VS162PNUT01"), "PN");
  assert.equal(skuLicensorCode("abc"), null);
  assert.equal(skuLicensorCode(null), null);
});

test("grouped assets scope characters by their Style Group licensing", async () => {
  const scope = await resolveCharacterScope(fakeClient({ sku: "X", licensor_id: "gl", property_id: "gp", is_licensed: true }, []),
    { style_group_id: "g", licensor_id: "al", property_id: "ap", sku: null }, passthrough, noop);
  assert.deepEqual(scope, { licensor_id: "gl", property_id: "gp", unlicensed: false });
});

test("unlicensed Style Groups get no character catalog", async () => {
  const scope = await resolveCharacterScope(fakeClient({ sku: "VDE83HDFAN01", licensor_id: null, property_id: null, is_licensed: false }, []),
    { style_group_id: "g", licensor_id: null, property_id: null, sku: null }, passthrough, noop);
  assert.equal(scope.unlicensed, true);
});

test("without licensing ids the SKU licensor code scopes characters, never the global list", async () => {
  const scope = await resolveCharacterScope(fakeClient({ sku: "VS162PNUT01", licensor_id: null, property_id: null, is_licensed: true }, [{ id: "peanuts", code: "PN" }]),
    { style_group_id: "g", licensor_id: null, property_id: null, sku: null }, passthrough, noop);
  assert.deepEqual(scope, { licensor_id: "peanuts", property_id: null, unlicensed: false });
});

function catalogClient(links: { id: string; name: string }[], licensorChars: { id: string; name: string }[], compatible = [...links, ...licensorChars]) {
  const table = (name: string) => {
    const answer = () => {
      if (name === "property_character_associations") return links.map(character => ({ character }));
      if (name === "character") return licensorChars;
      if (name === "dam_character_catalog") return compatible;
      if (name === "property") return [{ id: "p", licensor_id: "lic" }];
      return null;
    };
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
      limit: (n: number) => name === "character"
        ? Promise.resolve({ data: licensorChars.slice(0, n), error: null })
        : chain,
      maybeSingle: async () => ({ data: name === "property" ? { licensor_id: "lic" } : null, error: null }),
      then: (resolve: (v: unknown) => void) => Promise.resolve({ data: answer(), error: null }).then(resolve),
    };
    return chain;
  };
  return { from: table, schema: () => ({ from: table }) } as never;
}

const promptAsset = (property_id: string | null, licensor_id: string | null) => ({
  id: "a", filename: "f.png", relative_path: null, file_type: "png", tags: null, licensor_id, property_id,
  thumbnail_url: "t", status: "pending", ai_tagged_at: null, sku: null, division_code: null, style_group_id: null,
});

async function offered(client: never, asset: ReturnType<typeof promptAsset>) {
  let ids: string[] = [];
  await buildImageTaggingPrompt(asset, { client, onCharacterCatalog: v => { ids = v; } });
  return ids;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("a property's linked licensor characters are offered", async () => {
  assert.deepEqual(await offered(catalogClient([{ id: uuid(1), name: "Stitch" }], []), promptAsset("p", "lic")), [uuid(1)]);
});

test("an unlinked property falls back to a small licensor list", async () => {
  const chars = [{ id: uuid(2), name: "Kermit" }, { id: uuid(3), name: "Elmo" }];
  assert.deepEqual((await offered(catalogClient([], chars), promptAsset("p", null))).sort(), [uuid(2), uuid(3)]);
});

test("a licensor list too large to show offers no characters", async () => {
  const chars = Array.from({ length: LICENSOR_CHARACTER_LIST_LIMIT + 1 }, (_, i) => ({ id: uuid(i + 10), name: `C${i}` }));
  assert.deepEqual(await offered(catalogClient([], chars), promptAsset("p", "lic")), []);
});


test("property lists above the cap offer no characters", async () => {
  const chars = Array.from({ length: LICENSOR_CHARACTER_LIST_LIMIT + 1 }, (_, i) => ({ id: uuid(i + 10), name: `C${i}` }));
  assert.deepEqual(await offered(catalogClient(chars, []), promptAsset("p", "lic")), []);
});

test("scraped names use writable catalog IDs, excluding absent or ambiguous names", async () => {
  const scraped = [{ id: uuid(1), name: "Stitch" }, { id: uuid(2), name: "Missing" }, { id: uuid(3), name: "Ambiguous" }];
  const compatible = [{ id: uuid(10), name: "Stitch" }, { id: uuid(11), name: "Ambiguous" }, { id: uuid(12), name: "Ambiguous" }];
  assert.deepEqual(await offered(catalogClient(scraped, [], compatible), promptAsset("p", "lic")), [uuid(10)]);
});
