/** Uses the current application resolver without network calls inside its transaction. */
import {
  addNamedCharacters,
  resolveCharacterScope,
} from "../apps/worker/src/handlers/ai-tagging-shared.js";
import { displayCharacterName } from "../apps/worker/src/handlers/tag-finish.js";
import { nativeCharacterResolverClient } from "./native-character-resolver-client.mjs";
import {
  stable,
  timestampRow,
} from "./relink-existing-ai-characters-safety.mjs";
const normalized = (value: string) =>
  displayCharacterName(value)
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export async function resolveNativeEntries(
  connection: any,
  asset: any,
  entries: any[],
  timestampColumns: any = {},
) {
  const trace: any[] = [];
  const client = nativeCharacterResolverClient(connection, trace);
  const proof = [];
  for (const entry of entries) {
    const character = await connection.query(
      "select to_jsonb(c) row from core.character c where id=$1",
      [entry.characterId],
    );
    if (
      character.rows.length !== 1 ||
      JSON.stringify(
        stable(timestampRow(character.rows[0].row, timestampColumns.character)),
      ) !==
        JSON.stringify(
          stable(timestampRow(entry.character, timestampColumns.character)),
        )
    )
      throw Error("Changed source-backed character preimage");
    const scope = await resolveCharacterScope(
      client as any,
      asset,
      async (q: any) => q,
      (error: any) => {
        if (error) throw Error("Native scope dependency failed");
      },
    );
    const ids = await addNamedCharacters(
      client as any,
      asset,
      [],
      [entry.sourceTag.tag],
    );
    const name = normalized(entry.sourceTag.tag),
      pattern = name.replaceAll(" ", "%") + "%";
    const [canonical, aliases] = await Promise.all([
      client
        .schema("core")
        .from("character")
        .select("id,name,status")
        .eq("licensor_id", entry.licensorId)
        .ilike("name", pattern)
        .limit(201),
      client
        .schema("core")
        .from("character_alias")
        .select("alias,character:character_id(id,status)")
        .eq("licensor_id", entry.licensorId)
        .ilike("alias", pattern)
        .limit(51),
    ]);
    const canonicalRows = canonical.data,
      aliasRows = aliases.data;
    const identities = new Set([
      ...canonicalRows
        .filter(
          (r: any) => r.status === "active" && normalized(r.name) === name,
        )
        .map((r: any) => r.id),
      ...aliasRows
        .filter(
          (r: any) =>
            r.character?.status === "active" && normalized(r.alias) === name,
        )
        .map((r: any) => r.character.id),
    ]);
    if (
      scope.unlicensed ||
      scope.licensor_id !== entry.licensorId ||
      scope.property_id !== entry.propertyId ||
      ids.length !== 1 ||
      ids[0] !== entry.characterId ||
      identities.size !== 1 ||
      !identities.has(entry.characterId) ||
      canonicalRows.length >= 200 ||
      aliasRows.length >= 50
    )
      throw Error("Native current resolver scope or unique identity changed");
    proof.push({
      sourceTagId: entry.sourceTagId,
      characterId: entry.characterId,
      scope,
    });
  }
  return { proof, readInputs: trace };
}
