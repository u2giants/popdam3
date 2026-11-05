/** Append-only application-data repair support. Never contains production credentials or licensed rows. */
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === "object"
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, stable(value[k])]),
      )
    : value;
}
export function hasReceipt(operations, assetId) {
  return Object.values(operations).some(
    (op) =>
      op?.external_job &&
      JSON.stringify(op.external_job)
        .toLowerCase()
        .includes(assetId.toLowerCase()),
  );
}
export function pgTimestamp(value) {
  if (typeof value !== "string") return value;
  const match =
    /^(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(
      value,
    );
  if (!match) throw Error("Exact timestamptz value required");
  const zone = /^[+-]\d\d$/.test(match[3]) ? match[3] + ":00" : match[3];
  const seconds = Date.parse(match[1] + zone) / 1000;
  if (!Number.isFinite(seconds)) throw Error("Invalid timestamp");
  return String(seconds) + "." + (match[2] ?? "").padEnd(6, "0");
}
export function timestampRow(row, columns = []) {
  if (row === null || row === undefined) return row;
  const result = { ...row };
  for (const column of columns)
    if (result[column] !== null && result[column] !== undefined)
      result[column] = pgTimestamp(result[column]);
  return result;
}
export function timestampInputs(value, columns = {}) {
  return Object.fromEntries(
    Object.entries(value).map(([key, rows]) => [
      key,
      Array.isArray(rows)
        ? rows
            .map((row) => timestampRow(row, columns[key]))
            .map(stable)
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : timestampRow(rows, columns[key]),
    ]),
  );
}
export function verifyPreimage(
  expected,
  current,
  operations,
  timestampColumns = {},
) {
  if (hasReceipt(operations, expected.asset.id))
    throw Error("Protected external receipt");
  const before = timestampInputs(expected, timestampColumns),
    after = timestampInputs(current, timestampColumns);
  for (const key of ["asset", "tags", "links", "legacy"])
    if (
      JSON.stringify(stable(before[key])) !== JSON.stringify(stable(after[key]))
    )
      throw Error("Changed " + key + " preimage");
}
export function appendPayload(entry) {
  const source = entry.preimage.tags.find((t) => t.id === entry.sourceTagId);
  if (
    !source ||
    source.source !== "ai" ||
    source.status !== "active" ||
    source.created_by ||
    source.model !== entry.model
  )
    throw Error("Existing AI provenance required");
  if (
    entry.preimage.links.some((row) => row.character_id === entry.characterId)
  )
    throw Error("Already linked");
  if (
    entry.character.status !== "active" ||
    entry.character.licensor_id !== entry.licensorId
  )
    throw Error("Active scoped character required");
  return {
    asset_id: entry.assetId,
    character_id: entry.characterId,
    source: "ai",
    model: source.model,
    tagged_at: source.updated_at ?? source.created_at,
  };
}
export function assetOutcome(manifest, assetId) {
  const appends = manifest.filter((row) => row.assetId === assetId).length;
  return {
    assetId,
    outcome: appends
      ? "append_missing_links"
      : "no_missing_unambiguous_new_character",
    appends,
  };
}
/** Write-ahead custody. A transport failure may have committed; never retry it blindly. */
export async function appendWithCustody({
  record,
  persist,
  append,
  readPostimages,
  verify,
}) {
  record.phase = "intent_saved";
  persist();
  let response;
  try {
    response = await append();
  } catch (error) {
    record.phase = "unconfirmed_commit";
    record.appendTransportError = {
      code: error?.code ?? error?.name ?? "unknown",
    };
    persist();
    throw error;
  }
  record.insertResponse = response;
  record.phase = response.error ? "append_rejected" : "insert_response_saved";
  persist();
  if (response.error) throw Error("Append rejected; inspect saved response");
  const raw = await Promise.allSettled(readPostimages.map((read) => read()));
  record.rawPostReads = raw.map((result) =>
    result.status === "fulfilled"
      ? { status: "fulfilled", value: result.value }
      : {
          status: "rejected",
          error: {
            code: result.reason?.code ?? result.reason?.name ?? "unknown",
          },
        },
  );
  record.phase = "raw_postimages_saved";
  persist();
  verify(record.rawPostReads, response);
  record.phase = "preservation_verified";
  persist();
  return response;
}
