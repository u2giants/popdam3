import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { atomicAssetRelink } from "../atomic-ai-character-relink.mjs";
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-fixture-non-secret";
const url = process.env.T2_TEST_DATABASE_URL;
if (
  !url ||
  !/^postgres(?:ql)?:\/\/postgres@127\.0\.0\.1:\d+\/postgres$/.test(url)
)
  throw Error("Dedicated localhost PostgreSQL17 fixture required");
const client = () => {
  const value = new pg.Client({ connectionString: url });
  value.on("error", () => {});
  return value;
};
let c;
const id = {
  asset: "00000000-0000-4000-8000-000000000001",
  group: "00000000-0000-4000-8000-000000000002",
  lic: "00000000-0000-4000-8000-000000000003",
  prop: "00000000-0000-4000-8000-000000000004",
  char: "00000000-0000-4000-8000-000000000005",
  tag: "00000000-0000-4000-8000-000000000006",
  other: "00000000-0000-4000-8000-000000000007",
};
before(async () => {
  c = client();
  await c.connect();
  const version = await c.query("show server_version_num");
  assert.ok(
    +version.rows[0].server_version_num >= 170000 &&
      +version.rows[0].server_version_num < 180000,
  );
  await c.query(`create schema core;
 create table core.licensor(id uuid primary key,code text);create table core.property(id uuid primary key,licensor_id uuid references core.licensor);
 create table core.character(id uuid primary key,licensor_id uuid references core.licensor,name text,status text,metadata jsonb);
 create table core.character_alias(licensor_id uuid references core.licensor,character_id uuid references core.character,alias text);
 create table style_groups(id uuid primary key,sku text,licensor_id uuid,property_id uuid,is_licensed boolean);
 create table assets(id uuid primary key,style_group_id uuid references style_groups,licensor_id uuid,property_id uuid,sku text,is_deleted boolean default false);
 create table asset_tags(id uuid primary key,asset_id uuid references assets,tag text,source text,status text,model text,created_by uuid,created_at timestamptz,updated_at timestamptz);
 create table asset_licensor_characters(asset_id uuid references assets,character_id uuid references core.character,source text,model text,tagged_at timestamptz,primary key(asset_id,character_id));
 create table asset_characters(asset_id uuid references assets,character_id uuid,source text);
 create table admin_config(key text primary key,value jsonb);`);
});
after(async () => {
  await c.end();
});
beforeEach(async () => {
  await c.query(
    "truncate asset_tags,asset_licensor_characters,asset_characters,assets,style_groups,core.character_alias,core.character,core.property,core.licensor,admin_config cascade",
  );
  await c.query("insert into core.licensor values($1,$2)", [id.lic, "XX"]);
  await c.query("insert into core.property values($1,$2)", [id.prop, id.lic]);
  await c.query(
    "insert into core.character values($1,$2,'Sample Hero','active','{}')",
    [id.char, id.lic],
  );
  await c.query("insert into style_groups values($1,'ABCDEXX01',$2,$3,true)", [
    id.group,
    id.lic,
    id.prop,
  ]);
  await c.query("insert into assets values($1,$2,$3,$4,'ABCDEXX01',false)", [
    id.asset,
    id.group,
    id.lic,
    id.prop,
  ]);
  await c.query(
    "insert into asset_tags values($1,$2,'sample hero','ai','active',null,null,'2020-01-01','2020-01-01')",
    [id.tag, id.asset],
  );
  await c.query("insert into admin_config values('BULK_OPERATIONS','{}')");
});
async function entry() {
  const asset = (await c.query("select to_jsonb(a) row from assets a")).rows[0]
    .row;
  const group = (await c.query("select to_jsonb(g) row from style_groups g"))
    .rows[0].row;
  const tags = (
    await c.query("select to_jsonb(t) row from asset_tags t")
  ).rows.map((r) => r.row);
  const character = (
    await c.query("select to_jsonb(c) row from core.character c")
  ).rows[0].row;
  return {
    assetId: id.asset,
    characterId: id.char,
    licensorId: id.lic,
    propertyId: id.prop,
    sourceTagId: id.tag,
    model: null,
    sourceTag: tags[0],
    character,
    groupPreimage: group,
    preimage: { asset, tags, links: [], legacy: [] },
  };
}
async function run(extra = {}) {
  const records = [];
  const e = extra.entries ?? [await entry()];
  const result = await atomicAssetRelink({
    connection: extra.connection ?? c,
    entries: e,
    resolve: extra.resolve ?? (async () => ({ proof: "fixture resolver" })),
    persist: (record) => records.push(JSON.parse(JSON.stringify(record))),
    openFreshReader: () => foreign(),
    apply: true,
    ...extra,
  });
  return { result, records };
}
async function count() {
  return +(await c.query("select count(*) n from asset_licensor_characters"))
    .rows[0].n;
}
async function foreign() {
  const other = client();
  await other.connect();
  return other;
}

test("append preserves NULL model, original timestamp and every source preimage", async () => {
  const e = await entry();
  const { result } = await run({ entries: [e] });
  assert.equal(result.phase, "commit_confirmed");
  assert.equal(await count(), 1);
  const row = (await c.query("select * from asset_licensor_characters"))
    .rows[0];
  assert.equal(row.model, null);
  assert.equal(row.tagged_at.toISOString(), "2020-01-01T00:00:00.000Z");
  assert.deepEqual((await entry()).preimage.tags, e.preimage.tags);
});
test("a new existing receipt in any status excludes the asset without replay", async () => {
  for (const status of ["accepted", "completed", "failed"]) {
    await c.query("update admin_config set value=$1", [
      { task: { status, external_job: { asset_ids: [id.asset] } } },
    ]);
    await assert.rejects(run(), /Protected external receipt/);
    assert.equal(await count(), 0);
  }
});
test("changed tag, group or asset preimage rolls back before append", async () => {
  for (const kind of ["tag", "group", "asset"]) {
    const e = await entry();
    if (kind === "tag")
      await c.query("update asset_tags set tag=tag||' changed'");
    if (kind === "group")
      await c.query("update style_groups set sku=sku||'changed'");
    if (kind === "asset") await c.query("update assets set sku=sku||'changed'");
    await assert.rejects(run({ entries: [e] }), /preimage/);
    assert.equal(await count(), 0);
  }
});
test("concurrent new receipt cannot pass the existing shared advisory lock", async () => {
  const other = await foreign();
  let pending,
    finished = false;
  try {
    await run({
      hooks: {
        afterLocks: async () => {
          pending = other
            .query(
              "begin;select pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'))",
            )
            .then(() => {
              finished = true;
            });
          await new Promise((r) => setTimeout(r, 30));
          assert.equal(finished, false);
        },
      },
    });
    await pending;
    await other.query("rollback");
    assert.equal(finished, true);
  } finally {
    await other.end();
  }
});
test("immediate asset FK blocks concurrent new tags and character links while locked", async () => {
  for (const table of [
    "asset_tags",
    "asset_licensor_characters",
    "asset_characters",
  ]) {
    await c.query("delete from asset_licensor_characters");
    const other = await foreign();
    let pending,
      finished = false;
    try {
      await run({
        hooks: {
          afterLocks: async () => {
            const sql =
              table === "asset_tags"
                ? "insert into asset_tags(id,asset_id,tag) values($1,$2,'new')"
                : table === "asset_characters"
                  ? "insert into asset_characters(asset_id,character_id) values($2,$1)"
                  : "insert into asset_licensor_characters(asset_id,character_id,source,tagged_at) values($2,$1,'manual',now())";
            if (table === "asset_licensor_characters")
              await c.query(
                "insert into core.character values($1,$2,'Other','active','{}')",
                [id.other, id.lic],
              );
            pending = other.query(sql, [id.other, id.asset]).then(() => {
              finished = true;
            });
            await new Promise((r) => setTimeout(r, 30));
            assert.equal(finished, false);
          },
        },
      });
      await pending;
      assert.equal(finished, true);
      await other.query(
        "delete from " +
          table +
          " where " +
          (table === "asset_tags" ? "id" : "character_id") +
          "=$1",
        [id.other],
      );
    } finally {
      await other.end();
    }
  }
});
test("concurrent group changes wait; held group lock reaches bounded timeout with no append", async () => {
  const other = await foreign();
  try {
    await other.query("begin");
    await other.query("update style_groups set sku='new'");
    await assert.rejects(run(), (error) => error.code === "55P03");
    assert.equal(await count(), 0);
    await other.query("rollback");
  } finally {
    await other.end();
  }
});
test("taxonomy SHARE locks prevent conflicting aliases during resolver checks", async () => {
  const other = await foreign();
  let pending,
    finished = false;
  try {
    await run({
      hooks: {
        afterLocks: async () => {
          pending = other
            .query(
              "insert into core.character_alias values($1,$2,'sample hero')",
              [id.lic, id.char],
            )
            .then(() => {
              finished = true;
            });
          await new Promise((r) => setTimeout(r, 30));
          assert.equal(finished, false);
        },
      },
    });
    await pending;
    assert.equal(finished, true);
  } finally {
    await other.end();
  }
});
test("post-read failure saves inserted record and raw results before confirmed rollback", async () => {
  const records = [];
  await assert.rejects(
    run({
      persist: (r) => records.push(JSON.parse(JSON.stringify(r))),
      hooks: {
        beforePostRead: async (key) => {
          if (key === "tags") await c.query("select 1/0");
        },
      },
    }),
  );
  assert.equal(await count(), 0);
  const inserted = records.find((r) => r.phase === "inserted_uncommitted");
  assert.equal(inserted.inserted.length, 1);
  assert.ok(
    records.some((r) => r.rawPostReads?.some((x) => x.status === "rejected")),
  );
  assert.equal(records.at(-1).phase, "rollback_confirmed");
  assert.ok(inserted.preimage.tags.length);
});
test("disk failure before commit rolls back and intent failure performs no transaction", async () => {
  let began = false;
  const records = [];
  await assert.rejects(
    run({
      persist: (r) => {
        records.push(JSON.parse(JSON.stringify(r)));
        if (r.phase === "preservation_verified_uncommitted")
          throw Object.assign(Error("disk full"), { code: "ENOSPC" });
      },
    }),
  );
  assert.equal(await count(), 0);
  const fake = {
    query: async () => {
      began = true;
    },
  };
  await assert.rejects(
    run({
      connection: fake,
      persist: () => {
        throw Error("disk full");
      },
    }),
  );
  assert.equal(began, false);
});
test("statement budget aborts and rolls back without raising the limit", async () => {
  await assert.rejects(
    run({ hooks: { beforeInsert: () => c.query("select pg_sleep(2.6)") } }),
    (error) => error.code === "57014",
  );
  assert.equal(await count(), 0);
});
test("lost COMMIT response is unknown and point-read reconciliation proves actual state", async () => {
  let commits = 0;
  const records = [];
  const wrapped = {
    query: async (...args) => {
      if (args[0] === "commit") {
        commits++;
        await c.query(...args);
        throw Object.assign(Error("lost commit response"), {
          code: "ECONNRESET",
        });
      }
      return c.query(...args);
    },
  };
  await assert.rejects(
    run({
      connection: wrapped,
      persist: (r) => records.push(JSON.parse(JSON.stringify(r))),
    }),
    (error) =>
      error.relinkCommitState === "unconfirmed" && error.requiresPointRead,
  );
  assert.equal(commits, 1);
  assert.equal(records.at(-1).phase, "commit_unconfirmed");
  assert.equal(await count(), 1);
});

test("actual application resolver and alias path execute entirely through the native adapter", async () => {
  const { resolveNativeEntries } = await import(
    "../resolve-native-ai-characters.mts"
  );
  await c.query("update asset_tags set tag='nickname'");
  await c.query("insert into core.character_alias values($1,$2,'nickname')", [
    id.lic,
    id.char,
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("Network forbidden in transaction fixture");
  };
  let result;
  try {
    ({ result } = await run({ resolve: resolveNativeEntries }));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(result.resolverProof.proof[0].characterId, id.char);
  assert.ok(
    result.resolverProof.readInputs.some((r) => r.table === "character_alias"),
  );
});
test("a conflicting active alias introduced before the transaction aborts actual resolver admission", async () => {
  const { resolveNativeEntries } = await import(
    "../resolve-native-ai-characters.mts"
  );
  const e = await entry();
  await c.query(
    "insert into core.character values($1,$2,'Other','active','{}')",
    [id.other, id.lic],
  );
  await c.query(
    "insert into core.character_alias values($1,$2,'sample hero')",
    [id.lic, id.other],
  );
  await assert.rejects(
    run({ entries: [e], resolve: resolveNativeEntries }),
    /unique identity changed/,
  );
  assert.equal(await count(), 0);
});

test("existing tag writer makes the bounded transaction abstain without changing its rows", async () => {
  const other = await foreign();
  try {
    await other.query("begin");
    await other.query("update asset_tags set status='candidate'");
    await assert.rejects(run(), (error) => error.code === "55P03");
    assert.equal(await count(), 0);
    await other.query("rollback");
  } finally {
    await other.end();
  }
});
test("COMMIT transport failure before the server commit is reconciled without a blind replay", async () => {
  const writer = await foreign();
  const records = [];
  const wrapped = {
    query: async (...args) => {
      if (args[0] === "commit")
        throw Object.assign(Error("lost connection before commit"), {
          code: "ECONNRESET",
        });
      return writer.query(...args);
    },
  };
  try {
    await assert.rejects(
      run({
        connection: wrapped,
        persist: (r) => records.push(JSON.parse(JSON.stringify(r))),
      }),
      (error) => error.requiresPointRead,
    );
    assert.equal(records.at(-1).phase, "commit_unconfirmed");
  } finally {
    await writer.end();
  }
  assert.equal(await count(), 0);
});
test("a journal failure after confirmed commit keeps its custody and never claims rollback", async () => {
  const records = [];
  await assert.rejects(
    run({
      persist: (r) => {
        records.push(JSON.parse(JSON.stringify(r)));
        if (r.phase === "commit_confirmed")
          throw Object.assign(Error("disk full after commit"), {
            code: "ENOSPC",
          });
      },
    }),
    (error) => error.relinkCommitState === "committed_journal_failure",
  );
  assert.equal(await count(), 1);
  assert.ok(records.some((r) => r.phase === "commit_intent"));
  assert.equal(
    records.some((r) => r.phase === "rollback_confirmed"),
    false,
  );
});
test("PostgreSQL17 total transaction budget closes the writer and requires point-read proof", async () => {
  const writer = await foreign();
  const records = [];
  try {
    await assert.rejects(
      run({
        connection: writer,
        persist: (r) => records.push(JSON.parse(JSON.stringify(r))),
        hooks: {
          beforeInsert: async () => {
            await writer.query("select pg_sleep(1.6)");
            await writer.query("select pg_sleep(1.6)");
          },
        },
      }),
      (error) => error.requiresPointRead,
    );
  } finally {
    await writer.end().catch(() => {});
  }
  assert.equal(await count(), 0);
  assert.equal(
    records.some((r) => r.phase === "commit_intent"),
    false,
  );
});

test("new tag committed after SERIALIZABLE snapshot but before asset lock must not escape comparison", async () => {
  const other = await foreign();
  const e = await entry();
  try {
    await assert.rejects(
      run({
        entries: [e],
        hooks: {
          beforeAssetLocks: () =>
            other.query(
              "insert into asset_tags(id,asset_id,tag) values($1,$2,'new')",
              [id.other, id.asset],
            ),
        },
      }),
    );
    assert.equal(await count(), 0);
  } finally {
    await other.end();
  }
});

test("fresh READ COMMITTED reader detects pre-lock canonical and legacy child phantoms", async () => {
  await c.query(
    "insert into core.character values($1,$2,'Other','active','{}')",
    [id.other, id.lic],
  );
  for (const table of ["asset_licensor_characters", "asset_characters"]) {
    const other = await foreign();
    const e = await entry();
    try {
      await assert.rejects(
        run({
          entries: [e],
          hooks: {
            beforeAssetLocks: () =>
              other.query(
                `insert into ${table}(asset_id,character_id,source${table === "asset_licensor_characters" ? ",tagged_at" : ""}) values($1,$2,'manual'${table === "asset_licensor_characters" ? ",now()" : ""})`,
                [id.asset, id.other],
              ),
          },
        }),
      );
      assert.equal(
        +(
          await c.query(
            "select count(*) n from asset_licensor_characters where character_id=$1",
            [id.char],
          )
        ).rows[0].n,
        0,
      );
      await c.query(`delete from ${table} where character_id=$1`, [id.other]);
    } finally {
      await other.end();
    }
  }
});
test("fresh native resolver catches a taxonomy phantom committed between snapshot and taxonomy locks", async () => {
  const { resolveNativeEntries } = await import(
    "../resolve-native-ai-characters.mts"
  );
  const other = await foreign();
  try {
    await assert.rejects(
      run({
        resolve: resolveNativeEntries,
        hooks: {
          beforeTaxonomyLocks: () =>
            other.query(
              "insert into core.character_alias values($1,$2,'sample hero')",
              [id.lic, id.char],
            ),
        },
      }),
      /diverges/,
    );
    assert.equal(await count(), 0);
  } finally {
    await other.end();
  }
});
test("receipt and group changes committed before their row locks cannot escape SERIALIZABLE guards", async () => {
  for (const kind of ["receipt", "group"]) {
    const other = await foreign();
    try {
      const hooks =
        kind === "receipt"
          ? {
              beforeLocks: async () => {
                await c.query("select 1");
                await other.query(
                  "begin;select pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));update admin_config set value='{}';commit",
                );
              },
            }
          : {
              beforeAssetLocks: () =>
                other.query("update style_groups set sku='changed'"),
            };
      await assert.rejects(run({ hooks }), (error) => error.code === "40001");
      assert.equal(await count(), 0);
    } finally {
      await other.end();
    }
  }
});
test("six-digit timestamps survive a reviewed New York snapshot and two UTC transaction views", async () => {
  await c.query("set time zone 'America/New_York'");
  await c.query(
    "update asset_tags set created_at='2020-01-01 00:00:00.123456+00',updated_at='2020-01-01 00:00:00.123456+00'",
  );
  try {
    const { result } = await run({
      timestampColumns: {
        tags: ["created_at", "updated_at"],
        links: ["tagged_at"],
      },
    });
    assert.equal(result.phase, "commit_confirmed");
    const value = await c.query(
      "select to_char(tagged_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') value from asset_licensor_characters",
    );
    assert.equal(value.rows[0].value, "2020-01-01 00:00:00.123456");
  } finally {
    await c.query("set time zone 'UTC'");
  }
});
test("independent read-only connection closes on success, changed input, post-read failure and disk failure", async () => {
  for (const kind of ["success", "changed", "postread", "disk", "reader"]) {
    await c.query("delete from asset_licensor_characters");
    await c.query("update asset_tags set tag='sample hero'");
    const e = await entry();
    let closed = 0;
    let readerPid;
    const openFreshReader = async () => {
      const reader = await foreign();
      readerPid = reader.processID;
      const end = reader.end.bind(reader);
      reader.end = async () => {
        closed++;
        return end();
      };
      if (kind === "reader") {
        const query = reader.query.bind(reader);
        reader.query = async (...args) => {
          if (String(args[0]).includes("select to_jsonb"))
            throw Error("reader failure");
          return query(...args);
        };
      }
      return reader;
    };
    const options = { entries: [e], openFreshReader };
    if (kind === "changed")
      await c.query("update asset_tags set tag='changed'");
    if (kind === "postread")
      options.hooks = {
        beforePostRead: () => {
          throw Error("post-read failure");
        },
      };
    if (kind === "disk")
      options.persist = (r) => {
        if (r.phase === "preservation_verified_uncommitted")
          throw Error("disk failure");
      };
    if (kind === "success") await run(options);
    else await assert.rejects(run(options));
    assert.equal(closed, 1, kind);
    const live = await c.query(
      "select count(*) n from pg_stat_activity where pid=$1",
      [readerPid],
    );
    assert.equal(+live.rows[0].n, 0, kind + " reader remains");
    const blocked = await foreign();
    try {
      await blocked.query(
        "begin;set local lock_timeout='100ms';select pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));lock table core.character_alias in row exclusive mode",
      );
      await blocked.query("select 1 from assets for update");
      await blocked.query("rollback");
    } finally {
      await blocked.end();
    }
  }
});
