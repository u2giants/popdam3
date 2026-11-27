import test from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../supabase.js";
import { demoteLicensedNameTags, refreshSearchSlice } from "./popsg-tag-maintenance.js";

test("marks all 1,800 links across slices and stops querying after the final file", async () => {
  const files = Array.from({ length: 100 }, (_, i) => String(i).padStart(3, "0"));
  const marked = new Set<string>();
  let queries = 0;
  const client = { from(table: string) {
    queries++;
    if (table === "style_guide_tags") return { select: () => ({ in: () => ({ data: [{ id: "tag", normalized_tag: "hero" }] }) }) };
    let limit = 1000;
    let after = "";
    let ids: string[] = [];
    const query = {
      select() { return this; }, eq() { return this; }, order() { return this; },
      limit(n: number) { limit = n; return this; },
      gt(_: string, id: string) { after = id; return this; },
      in(_: string, values: string[]) { ids = values; return this; },
      update() { return { in: (_: string, links: string[]) => { links.forEach(id => marked.add(id)); return {}; } }; },
      then(resolve: (value: unknown) => void) {
        const data = table === "style_guide_tagging_state"
          ? files.filter(id => id > after).slice(0, limit).map(style_guide_file_id => ({ style_guide_file_id }))
          : ids.flatMap(id => Array.from({ length: 18 }, (_, i) => ({ id: id + "/" + i, tag_id: "tag" }))).slice(0, 1000);
        resolve({ data });
      },
    };
    return query;
  } } as unknown as DB;
  const names = new Set(["hero"]);
  assert.equal(await demoteLicensedNameTags(client, names, 50), 900);
  assert.equal(await demoteLicensedNameTags(client, names), 900);
  assert.equal(marked.size, 1800);
  const before = queries;
  assert.equal(await demoteLicensedNameTags(client, names), 0);
  assert.equal(queries, before);
});

test("refresh retries smaller calls, delays growth across slices, and stops on a partial batch or error", async () => {
  const sizes: number[] = [];
  let partial = false;
  let fail = false;
  const client = { rpc(_: string, { p_search_batch_size: size }: { p_search_batch_size: number }) {
    sizes.push(size);
    if (fail) return { error: { message: "permission denied" } };
    if (sizes.length === 1) return { error: { message: "statement timeout" } };
    return { data: [{ search_documents_synced: partial ? 3 : size }] };
  } } as unknown as DB;
  assert.equal(await refreshSearchSlice(client, 1), 500);
  assert.deepEqual(sizes, [1000, 500]);
  assert.equal(await refreshSearchSlice(client, 14), 7000);
  assert.deepEqual(sizes.slice(2), Array(14).fill(500));
  partial = true;
  assert.equal(await refreshSearchSlice(client, 5), 3);
  assert.deepEqual(sizes.slice(16), [1000]);
  fail = true;
  await assert.rejects(refreshSearchSlice(client), /permission denied/);
});
