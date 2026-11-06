#!/usr/bin/env node
// Builds text vectors of PopSG licensor and property names for admin_config
// POPSG_NAME_VECTORS. dam-search-ai uses them to recognise the name a misspelled
// query means ("harry poter" -> Harry Potter) and adds it as a keyword (#706).
// Rerun after new licensors or properties land; a stale list only misses new names.
// Usage (PGPASSWORD, TEXT_EMBED_URL, TEXT_EMBED_KEY set):
//   psql "$CONN" -At -f scripts/popsg-name-vectors-names.sql > names.txt
//   node scripts/popsg-name-vectors.mjs names.txt | psql "$CONN" -v ON_ERROR_STOP=1
import { readFileSync } from "node:fs";

// Folder names that describe a format or year, not a licensor or property.
const GENERIC = /^[_\d]|style ?guides?|packag|logos?$|posters?$|^vintage$|^core|^characters$|copyright|multi-property|trend|^graphics|design assets|key artwork|^office$/i;

async function embed(text) {
  const res = await fetch(new URL("/embed-text", process.env.TEXT_EMBED_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Embed-Key": process.env.TEXT_EMBED_KEY ?? "" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`text-embed HTTP ${res.status}`);
  const { vector } = await res.json();
  if (!Array.isArray(vector) || vector.length !== 768) throw new Error("text-embed returned no 768-d vector");
  return vector.map((n) => Math.round(n * 1e4) / 1e4);
}

const names = [...new Set(readFileSync(process.argv[2], "utf8").split("\n").map((n) => n.trim()).filter((n) => n && !GENERIC.test(n)))];
const vectors = [];
for (let i = 0; i < names.length; i += 8) vectors.push(...await Promise.all(names.slice(i, i + 8).map(embed)));
const value = JSON.stringify({ model: "google/siglip2-base-patch16-naflex", built_at: new Date().toISOString(), names, vectors });
if (value.includes("$nv$")) throw new Error("unexpected quote marker in names");
process.stdout.write(`insert into public.admin_config (key, value, updated_at) values ('POPSG_NAME_VECTORS', $nv$${value}$nv$::jsonb, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();\n`);
console.error(`built ${names.length} name vectors`);
