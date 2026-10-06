import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const COLDLION_BASE_URL = "http://x5.coldlion.com/EhpApi";
export const COLDLION_API_KEY_REF =
  "op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential";

export function readColdlionApiKey() {
  if (process.env.COLDLION_API_KEY) return process.env.COLDLION_API_KEY;
  const result = spawnSync("op", ["read", COLDLION_API_KEY_REF], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      "COLDLION_API_KEY is not set and `op read` failed for the documented 1Password reference.",
    );
  }
  return result.stdout.trim();
}

/**
 * Output ceiling for EVERY database child process this module spawns — psql and the Supabase
 * CLI alike. Node's spawnSync default is exactly 1 MiB; the cycle-state probe returned
 * 1,305,075 bytes on preview and was killed with ENOBUFS, null `status` and EMPTY `stderr`.
 *
 * This is the SECOND line of defence, not the first: the probe itself is now paged
 * (CYCLE_STATE_PAGE_SIZE in tools/promote-coldlion-source-owned.mjs). It is applied to both
 * spawns from one constant so the two paths can never drift apart again.
 */
export const SPAWN_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/**
 * Wall-clock ceiling for EVERY database child process this module spawns — backlog B12, #550.
 *
 * Without it, a `psql` or `supabase db query` child that never returns hangs the parent
 * FOREVER, and the process outlives the session that started it. Four to six such orphans
 * accumulated across 2026-07-29 and 2026-07-31 before anyone noticed, and the reason they
 * were not noticed is the hard part: a stuck process is indistinguishable at a glance from a
 * legitimate long-running one. A real ClickUp importer run took 52 minutes the same day.
 *
 * 90 minutes is therefore deliberately generous — comfortably above that 52-minute run, so
 * this can only ever fire on something genuinely wedged, never on slow-but-working work.
 * It is a leak stopper, not a performance budget. Do NOT lower it to "make things fail fast".
 *
 * Applied to both spawns from ONE constant, for the same reason SPAWN_MAX_BUFFER_BYTES is:
 * the two paths do the same job, and every asymmetry between them has so far become a defect.
 *
 * On timeout Node returns `error.code === 'ETIMEDOUT'` with `status` null — which
 * clientSpawnFaultError already classifies as a CLIENT-SIDE tooling fault, so a hung child is
 * never recorded as a durable database failure.
 */
export const SPAWN_TIMEOUT_MS = 90 * 60 * 1000;

export function sqlDollarQuote(tag, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.includes(`$${tag}$`)) {
    throw new Error(`value unexpectedly contains dollar quote tag ${tag}`);
  }
  return `$${tag}$${text}$${tag}$`;
}

export function buildFailedSyncRunSql(sourceName, stage, message) {
  const error = String(message ?? "").slice(0, 4000);
  return `with failed as (
  insert into ingest.sync_run
    (source_system, source_name, status, started_at, finished_at, error, metadata)
  values ('coldlion', ${sqlDollarQuote("cl_source", sourceName)}, 'failed', now(), now(),
    ${sqlDollarQuote("cl_error", error)},
    jsonb_build_object('recorded_by','coldlion host wrapper','stage',${sqlDollarQuote("cl_stage", stage)},'promotion','not-promoted'))
  returning id
), consecutive as (
  select 1 + count(*)::integer as failures
  from failed
  cross join lateral (select status from ingest.sync_run where source_system='coldlion' and source_name=${sqlDollarQuote("cl_source2", sourceName)}
        order by started_at desc limit 1) recent
  where recent.status='failed'
)
select pg_notify('coldlion_sync_alert', ${sqlDollarQuote("cl_alert", `${sourceName}: at least two consecutive non-promotions`)})
from consecutive where failures >= 2;
`;
}

/**
 * The `code` carried by an error that represents a CLIENT-SIDE tooling fault — one where Node
 * itself sets `result.error` because the child could not be run or its output could not be
 * collected: ENOENT (not installed), ENOBUFS (output exceeded maxBuffer), EACCES.
 *
 * NOT every abnormal end is one of these. An EXTERNAL signal kill is deliberately excluded:
 * on Linux — which CI and the production lane both run on — a SIGKILL from outside yields
 * `status: null`, `signal: "SIGKILL"` and `error: undefined`, so it takes the ordinary
 * recorded-failure path below, not this one. That is the safe direction (loud and durable
 * rather than silently benign) and it is left as is on purpose: this repo cannot tell an
 * external kill apart from the OOM killer stopping a legitimately failing query.
 *
 * This is deliberately NOT a database failure and must never be recorded as one. A spawn
 * fault says nothing about the data or the database: recording it as a durable failed
 * `ingest.sync_run` row lets two of them in a row auto-trip the coldlion_licensor_property
 * circuit breaker and shut down a HEALTHY production feed, blaming the database for a
 * defect in this repo's own tooling. Callers branch on `isClientSpawnFault(error)`.
 */
export const CLIENT_SPAWN_FAULT_CODE = "CLIENT_SPAWN_FAULT";

/** True when the error came from the spawn boundary rather than from SQL. */
export function isClientSpawnFault(error) {
  return error?.code === CLIENT_SPAWN_FAULT_CODE;
}

/**
 * Build the tagged error for a spawn-level fault. `status` is null and `stderr` is EMPTY for
 * every one of these, so the underlying `error.code` is the only diagnostic that exists.
 */
export function clientSpawnFaultError(what, spawnError) {
  const error = new Error(
    `${what} could not be executed (${spawnError?.code ?? "spawn error"}): ${spawnError?.message ?? spawnError}` +
      " — this is a CLIENT-SIDE tooling fault, not a database failure.",
  );
  error.code = CLIENT_SPAWN_FAULT_CODE;
  error.spawnErrorCode = spawnError?.code ?? null;
  error.cause = spawnError;
  return error;
}

/**
 * Parse a PostgreSQL connection URI into libpq environment variables.
 * The URI is NEVER placed in process argv or spelled into a command line —
 * that is the leak class of the 2026-10-02 incident (a psql error printed a
 * URL-embedded password). Throws on shapes we cannot safely represent rather
 * than silently connecting to the wrong target.
 *
 * ONE copy of this parser serves both tools/coldlion-landing/lib/db.mjs and
 * this module's own runSql: the landing lib imports it from here. Two copies
 * of a target-selection parser is how the production copy drifts untested.
 */
export function parsePgUri(uri) {
  // A URI fragment (#...) is not representable: libpq terminates the dbname at
  // '#', this anchor does not, so the fragment would ride into PGDATABASE or
  // the query (fail-closed at connect, but mis-represented). Refuse outright.
  if (uri.includes("#")) throw new Error("URI fragments are not supported in PostgreSQL URIs here");
  const m = uri.match(/^(?:postgres(?:ql)?:\/\/)(?:([^:@\/]*)?(?::([^@\/]*)?)?@)?([^\/?]*)(?:\/([^?]*))?(?:\?(.*))?$/i);
  if (!m) throw new Error("not a PostgreSQL URI");
  const [, user, pass, authority, dbname, query] = m;
  if (!authority) throw new Error("PostgreSQL URI has no host");
  // Reject query-host socket URIs (?host=/path) — we cannot represent them safely.
  if (query && /(?:^|&)host=/.test(query)) throw new Error("query-host socket URIs are not supported");
  const env = {};
  if (user) env.PGUSER = decodeURIComponent(user);
  if (pass) env.PGPASSWORD = decodeURIComponent(pass);
  // Split hosts on commas; each entry must match ONE anchored shape — host,
  // host:port, [ipv6], or [ipv6]:port — with the port entirely digits. A global
  // scan with a gap check ACCEPTED `host:5432evil` as two hosts (host + evil),
  // silently building a failover list that receives PGPASSWORD; per-entry
  // anchored matching refuses it (2026-10-05 review, M1).
  const entryRe = /^(?:\[([^\]]+)\]|([^:\[\]]+))(?::(\d+))?$/;
  const hostEntries = [];
  for (const rawEntry of authority.split(",")) {
    const entry = entryRe.exec(rawEntry);
    if (!entry) throw new Error("malformed host authority in PostgreSQL URI: " + rawEntry);
    const host = entry[1] ?? entry[2];
    if (/[\s@]/.test(host)) throw new Error("whitespace or @ in host entry: " + rawEntry);
    hostEntries.push({ host, port: entry[3] });
  }
  // A MIXED authority (some entries with ports, some without) is refused
  // rather than defaulted: whether a portless host in a list inherits the
  // previous port or the default is libpq's internal rule, and guessing it
  // could retarget the connection (2026-10-05 review, L1).
  if (hostEntries.some((h) => h.port) && hostEntries.some((h) => !h.port)) {
    throw new Error("mixed port presence in multi-host PostgreSQL URI authority");
  }
  // Decode host names AFTER splitting — encoded commas (%2C) must not create
  // extra failover hosts.
  env.PGHOST = hostEntries.map(h => {
    const decoded = decodeURIComponent(h.host);
    if (decoded.includes(",")) throw new Error("encoded comma in host name");
    return decoded;
  }).join(",");
  // All entries carry ports (mixed authorities are refused above).
  if (hostEntries.some(h => h.port)) env.PGPORT = hostEntries.map(h => h.port).join(",");
  // Omitted database: leave PGDATABASE unset (libpq defaults to the username).
  if (dbname) env.PGDATABASE = decodeURIComponent(dbname);
  // Only parameters with a REAL libpq environment variable. Ten names were
  // verified empirically against the installed libpq 18.6 on 2026-10-05 (an
  // invalid value in each was rejected by libpq itself): PGSSLMODE,
  // PGSSLNEGOTIATION, PGREQUIREAUTH, PGLOADBALANCEHOSTS, PGCHANNELBINDING,
  // PGSSLMIN/MAXPROTOCOLVERSION, PGCONNECT_TIMEOUT, PGTARGETSESSIONATTRS,
  // PGGSSENCMODE, PGSSLCERTMODE. PGTCP_USER_TIMEOUT, PGKEEPALIVES*, PGSSLSNI
  // and PGFALLBACK_APPLICATION_NAME were NOT read and are therefore refused.
  // The remaining accepted names (path-valued TLS files, encoding, app name,
  // options-free transport ones) are DOCUMENTED-not-probed: an invalid-value
  // probe cannot classify parameters consumed only at handshake time. A
  // parameter we cannot represent is refused, never silently dropped.
  const PG_PARAM_ENV = {
    sslmode: "PGSSLMODE", sslcertmode: "PGSSLCERTMODE",
    ssl_min_protocol_version: "PGSSLMINPROTOCOLVERSION",
    ssl_max_protocol_version: "PGSSLMAXPROTOCOLVERSION",
    connect_timeout: "PGCONNECT_TIMEOUT", application_name: "PGAPPNAME",
    target_session_attrs: "PGTARGETSESSIONATTRS",
    channel_binding: "PGCHANNELBINDING", passfile: "PGPASSFILE",
    load_balance_hosts: "PGLOADBALANCEHOSTS", gssencmode: "PGGSSENCMODE",
    sslnegotiation: "PGSSLNEGOTIATION", require_auth: "PGREQUIREAUTH",
    client_encoding: "PGCLIENTENCODING", krbsrvname: "PGKRBSRVNAME", port: "PGPORT",
  };
  // Parameters with NO env-var representation — accepting them would silently
  // drop a connection property (fail-open), so they are refused.
  const PG_PARAMS_WITHOUT_ENV = new Set([
    "keepalives", "keepalives_idle", "keepalives_interval", "keepalives_count",
    "tcp_user_timeout", "sslsni", "fallback_application_name",
  ]);
  // Server-side GUC overrides (options -> PGOPTIONS) change execution
  // semantics beyond transport — the same doctrine that refuses hostaddr.
  const PG_PARAMS_REFUSED_ON_PRINCIPLE = new Set(["options"]);
  // Handshake-time TLS material (sslpassword, sslcert, sslkey, sslrootcert,
  // sslcrl, sslcrldir): the pre-connection invalid-value probe is INCONCLUSIVE
  // for these (they are consumed only during the TLS handshake, so the probe
  // cannot distinguish read from not-read), and a silently dropped passphrase
  // or CRL is a security-relevant downgrade. No production URL carries them;
  // fail closed (2026-10-05 review round 5, M2). Measured: every one of these
  // probes went straight to connection-refused on libpq 18.6.
  const PG_PARAMS_REFUSED_UNPROBEABLE = new Set([
    "sslpassword", "sslcert", "sslkey", "sslrootcert", "sslcrl", "sslcrldir",
  ]);
  if (query) {
    for (const kv of query.split("&")) {
      if (!kv) continue;
      const eq = kv.indexOf("=");
      // A query entry without '=' is malformed — reject rather than silently drop
      // (a dropped sslmode or similar would weaken the connection).
      if (eq <= 0) throw new Error("malformed PostgreSQL URI query parameter: " + kv);
      const k = decodeURIComponent(kv.slice(0, eq));
      const v = decodeURIComponent(kv.slice(eq + 1));
      // `ssl` is a legacy alias for sslmode=require — never map it literally.
      // `false`/`0` are REJECTED — they would disable encryption and expose credentials.
      if (k === "ssl") {
        const vLower = v.toLowerCase();
        if (vLower === "true" || vLower === "1") { env.PGSSLMODE = "require"; continue; }
        throw new Error("ssl=false/0 is rejected (would disable encryption)");
      }
      // `hostaddr` redirects the TCP connection independently of the validated
      // host — it is exactly the "connect to the wrong target" shape this
      // parser exists to refuse.
      if (k === "hostaddr") throw new Error("hostaddr is not supported (it bypasses host validation)");
      if (PG_PARAMS_REFUSED_ON_PRINCIPLE.has(k)) {
        throw new Error(`PostgreSQL URI parameter ${k} changes server-side semantics; refusing it in connection URLs`);
      }
      if (PG_PARAMS_REFUSED_UNPROBEABLE.has(k)) {
        throw new Error(`PostgreSQL URI parameter ${k} is TLS handshake material that the pre-connection probe cannot verify; refusing rather than risk a silent drop`);
      }
      if (PG_PARAMS_WITHOUT_ENV.has(k)) {
        throw new Error(`PostgreSQL URI parameter ${k} has no libpq environment variable; refusing rather than silently dropping it`);
      }
      const envKey = PG_PARAM_ENV[k];
      if (!envKey) throw new Error(`unrecognized PostgreSQL URI parameter: ${k}`);
      // A query `port` that disagrees with authority ports is ambiguous —
      // refuse rather than let two spellings fight over PGPORT.
      if (k === "port") {
        if (env.PGPORT !== undefined) {
          throw new Error("query port conflicts with authority port(s) in PostgreSQL URI");
        }
        // The same digit/cardinality discipline the authority is held to: a
        // comma list must be all-digits and match the host count (or be a
        // single port). 1 host + N ports is exactly the mismatched-cardinality
        // shape the parser refuses elsewhere (round 5, M3).
        if (!/^\d+(,\d+)*$/.test(v)) {
          throw new Error("query port must be digits (comma list allowed only with matching host count)");
        }
        const portCount = v.split(",").length;
        const hostCount = String(env.PGHOST ?? "").split(",").length;
        if (portCount !== 1 && portCount !== hostCount) {
          throw new Error("query port list cardinality does not match the host list");
        }
      }
      env[envKey] = v;
    }
  }
  // TLS floor (2026-10-05 review, M6): `disable` and `allow` can end in a
  // cleartext connection carrying the password, and an absent sslmode means
  // libpq's `prefer` — silent plaintext fallback. Both are refused; when the
  // URI says nothing about sslmode the floor is `require`.
  const sslmode = String(env.PGSSLMODE ?? "").toLowerCase();
  if (sslmode === "disable" || sslmode === "allow" || sslmode === "prefer") {
    throw new Error(`sslmode=${sslmode} is rejected (it can send the password in cleartext)`);
  }
  if (!sslmode) env.PGSSLMODE = "require";
  return env;
}

// libpq sslmode strictness order, weakest to strongest. Used ONLY to keep a
// stricter operator-exported PGSSLMODE when the URL itself says nothing about
// sslmode: the sweep must never DOWNGRADE verification (ambient verify-full
// silently becoming require was a fail-open direction, 2026-10-05 review M3).
const PGSSLMODE_RANK = { disable: 0, allow: 1, prefer: 2, require: 3, "verify-ca": 4, "verify-full": 5 };

function ambientPgSslmode(baseEnv) {
  for (const k of Object.keys(baseEnv)) {
    if (k.toUpperCase() === "PGSSLMODE") return String(baseEnv[k]).toLowerCase();
  }
  return null;
}

function urlDeclaresSslmode(url) {
  // Decoded exactly as parsePgUri reads the query: the sslmode keyword OR the
  // legacy ssl alias both count as the URL declaring its sslmode, and a '?' or
  // a percent-encoded key inside the password cannot fool this (it never sees
  // the password — the anchor regex below is the same one parsePgUri uses).
  const anchor = /^(?:postgres(?:ql)?:\/\/)(?:([^:@\/]*)?(?::([^@\/]*)?)?@)?([^\/?]*)(?:\/([^?]*))?(?:\?(.*))?$/i;
  const m = url.match(anchor);
  const q = m?.[5] ?? "";
  for (const kv of q.split("&")) {
    if (!kv) continue;
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    const k = decodeURIComponent(kv.slice(0, eq)).toLowerCase();
    if (k === "sslmode" || k === "ssl") return true;
  }
  return false;
}

/**
 * Build the child environment for a connection URL: every ambient PG* value is
 * cleared first — they must never override the declared target — and case
 * sensitivity is handled for Windows, where env names are case-insensitive.
 * One exception to the sweep: when the URL does not declare sslmode and the
 * operator exported a STRICTER one than the require floor, the stricter value
 * survives (never the other way around — a URL-declared sslmode always wins
 * verbatim, and weaker ambient values are swept).
 */
export function urlToPgEnv(url, baseEnv = process.env) {
  const clean = { ...baseEnv };
  const ambientSslmode = ambientPgSslmode(clean);
  for (const k of Object.keys(clean)) {
    if (k.toUpperCase().startsWith("PG")) delete clean[k];
  }
  const env = { ...clean, ...parsePgUri(url) };
  if (!urlDeclaresSslmode(url) && ambientSslmode !== null) {
    // env.PGSSLMODE is guaranteed set by parsePgUri's floor; if a future edit
    // ever breaks that guarantee, treat the floor as the STRONGEST possible
    // value so no ambient value can slip under it (fail-closed, not fail-open).
    const ambientRank = PGSSLMODE_RANK[ambientSslmode] ?? -1;
    const floorRank = env.PGSSLMODE !== undefined ? (PGSSLMODE_RANK[env.PGSSLMODE] ?? Infinity) : Infinity;
    if (ambientRank > floorRank) env.PGSSLMODE = ambientSslmode;
  }
  return env;
}

/** True when the error is a client-side configuration fault (a URI that
 * failed validation), as opposed to a database failure. These must take the
 * exit-4 channel — "fix the runner host" — never the durable-failure path. */
export const CLIENT_URI_FAULT_CODE = "CLIENT_URI_FAULT";

export function isClientUriFault(error) {
  return error?.code === CLIENT_URI_FAULT_CODE;
}

export function clientUriFaultError(cause) {
  const error = new Error(
    "DATABASE_URL failed validation (client-side configuration, no connection was attempted): " +
    (cause?.message ?? String(cause)) +
    " — this is a CLIENT-SIDE configuration fault, not a database failure.",
  );
  error.code = CLIENT_URI_FAULT_CODE;
  error.cause = cause;
  return error;
}

/** Keep psql's real database error, redacted: the first ERROR/FATAL/PANIC line
 * only, connection URLs and quoted values stripped. Shared by both transports
 * so the psql branches cannot drift (every asymmetry so far has become a
 * defect). Moved here from coldlion-landing/lib/db.mjs, which re-exports it. */
export function redactPsqlError(stderr) {
  const first = String(stderr ?? "").split(/\r?\n/).find((line) => /ERROR:|FATAL:|PANIC:/.test(line)) ?? "Database command failed";
  return first.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]")
    .replace(/'[^'\r\n]*'/g, "[redacted-value]")
    .replace(/"[^"\r\n]*"/g, (match, offset, line) => /(relation|column|constraint|table|schema|function|type)\s*$/i.test(line.slice(0, offset)) ? match : "[redacted-value]")
    .slice(0, 1000);
}

export function runSql(sql, { linked = false, spawn = spawnSync } = {}) {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!databaseUrl && !linked) {
    const error = new Error(
      "No database target: set DATABASE_URL/SUPABASE_DB_URL or pass --linked.",
    );
    error.code = "NO_DB_TARGET";
    throw error;
  }

  if (databaseUrl && !linked) {
    // Connection via PG* env — NEVER as a process argument (2026-10-02 leak class).
    // Strict PostgreSQL URI parsing: reject unsafe edge cases rather than misconnect.
    // A URI that fails validation is a CLIENT configuration fault, not a database
    // failure — tagged so callers route it to the tooling-fault channel (L2).
    let pgEnv;
    try {
      pgEnv = urlToPgEnv(databaseUrl);
    } catch (cause) {
      throw clientUriFaultError(cause);
    }
    const psql = spawn(
      "psql",
      ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--single-transaction"],
      {
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        env: pgEnv,
        // This branch had NO ceiling of its own for years, so wherever DATABASE_URL
        // was set the original 1 MiB ENOBUFS cliff was completely untouched by the
        // PR #362 fix (issue #550 / B12 taught the same lesson for wall clock).
        maxBuffer: SPAWN_MAX_BUFFER_BYTES,
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
    );
    if (psql.error) throw clientSpawnFaultError("psql", psql.error);
    if (psql.status !== 0) {
      const error = new Error(redactPsqlError(psql.stderr));
      error.code = "DATABASE_COMMAND_FAILED";
      throw error;
    }
    return psql.stdout;
  }

  const dir = mkdtempSync(join(tmpdir(), "coldlion-sync-"));
  const file = join(dir, "query.sql");
  try {
    writeFileSync(file, sql, { encoding: "utf8", mode: 0o600 });
    // `--output json` is NOT the default. The default box-table renderer wraps a 1.3 MB JSON
    // cell across box-drawn lines, interleaving `|` borders into the payload, which is not
    // recoverable. Ask for json and let parsePhase6FunctionResult unwrap the column name.
    //
    // Target selection: `--linked` (never `--db-url` in argv — 2026-10-02 leak class).
    // The CLI child gets the caller's environment with every ambient PG* value swept
    // (the same target-hygiene rule as the psql branch — an ambient PGHOST must not
    // redirect a child of this branch either) and nothing else added: DATABASE_URL
    // reaches it only when the caller themselves exported it, and SUPABASE_DB_URL is
    // never minted here (handing the CLI a URL under the name it uses to override its
    // link state, while argv says --linked, is a target-selection ambiguity, not a
    // feature).
    const args = ["db", "query", "--linked", "--output", "json", "--file", file];
    const cliEnv = { ...process.env };
    // One case-insensitive sweep (Windows env names are case-insensitive; a
    // bare `delete cliEnv.SUPABASE_DB_URL` would miss Supabase_Db_Url): drop
    // every PG* and every spelling of SUPABASE_DB_URL — an inherited URL under
    // the name the CLI uses to override its link state, while argv says
    // --linked, is the same target-selection ambiguity the minting removal
    // closed (round 5, L2).
    for (const k of Object.keys(cliEnv)) {
      const upper = k.toUpperCase();
      if (upper.startsWith("PG") || upper === "SUPABASE_DB_URL") delete cliEnv[k];
    }
    const result = spawn("supabase", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: cliEnv,
      // Identical ceiling to the psql branch above — see SPAWN_MAX_BUFFER_BYTES.
      maxBuffer: SPAWN_MAX_BUFFER_BYTES,
      // Identical wall clock to the psql branch above — see SPAWN_TIMEOUT_MS (#550 / B12).
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (result.error) {
      // Never let a spawn-level fault (ENOBUFS, ENOENT, EACCES) masquerade as a SQL failure.
      // Tagged CLIENT_SPAWN_FAULT so a caller cannot record it as a durable sync failure.
      throw clientSpawnFaultError("supabase db query", result.error);
    }
    if (result.status !== 0) {
      const error = new Error(redactPsqlError(result.stderr));
      error.code = "DATABASE_COMMAND_FAILED";
      throw error;
    }
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function fetchPaged(url, apiKey, fetchImpl = fetch) {
  const rows = [];
  let page = 0;
  let terminalReached = false;
  for (;;) {
    const pagedUrl = new URL(url);
    pagedUrl.searchParams.set("page", String(page));
    if (!pagedUrl.searchParams.has("size")) pagedUrl.searchParams.set("size", "200");
    const response = await fetchImpl(pagedUrl, { headers: { "X-API-Key": apiKey } });
    if (!response.ok) throw new Error(`${pagedUrl} returned HTTP ${response.status}`);
    const payload = await response.json();
    if (Array.isArray(payload)) {
      rows.push(...payload);
      terminalReached = true;
      break;
    }
    if (!Array.isArray(payload?.content)) {
      throw new Error(`${pagedUrl} did not return an array or paged content envelope`);
    }
    rows.push(...payload.content);
    if (payload.content.length === 0 || payload.last === true) {
      terminalReached = true;
      break;
    }
    page += 1;
  }
  return { rows, terminalReached, pagesFetched: page + 1 };
}
