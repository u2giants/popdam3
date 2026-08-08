#!/usr/bin/env node
/**
 * Prove the Supabase CLI link state is HONEST before anyone trusts it.
 *
 * ============================================================================
 * WHY THIS EXISTS -- a real, measured inconsistency on 2026-08-07
 * ============================================================================
 * `supabase/.temp/` holds THREE files that can each name a project:
 *
 *     supabase/.temp/project-ref          -> a bare ref, e.g. rjyboqwcdzcocqgmsyel
 *     supabase/.temp/pooler-url           -> ref hidden in the USERNAME: postgres.<ref>
 *     supabase/.temp/linked-project.json  -> {"ref": "...", "name": ..., ...}
 *
 * On 2026-08-07 two of them DISAGREED on a working checkout:
 *
 *     project-ref          said  rjyboqwcdzcocqgmsyel   (PREVIEW)
 *     linked-project.json  said  qsllyeztdwjgirsysgai   (PRODUCTION)
 *
 * WHAT WAS MEASURED, AND WHAT THE FIRST WRITE-UP GOT WRONG
 * --------------------------------------------------------
 * The first version of this comment claimed the CLI "would have targeted
 * PRODUCTION". THAT WAS WRONG, and it was corrected by direct measurement rather
 * than argument. Three experiments, all against preview and a non-existent ref,
 * never against production:
 *
 *   A. real project-ref (preview) + BOGUS pooler-url
 *        -> CLI tried db.<project-ref value>.supabase.co. It IGNORED the pooler URL.
 *   B. BOGUS project-ref + real preview pooler-url
 *        -> CLI tried db.<bogus>.supabase.co. The valid pooler URL did NOT redirect it.
 *   C. both consistent (preview)
 *        -> connected, and the migration list came back.
 *
 * So: `project-ref` DECIDES THE PROJECT. `pooler-url` is the connection route used
 * when it agrees. `linked-project.json` is not written by `supabase link` at all --
 * `supabase link --project-ref <ref>` creates `project-ref` and `pooler-url` and
 * never creates or refreshes the JSON file. That last point was ISOLATED by its own
 * before/after experiment: a `linked-project.json` planted with an unrelated ref
 * survived a `supabase link` BYTE-FOR-BYTE. See
 * docs/verification/opa-preview-load-20260807/evidence/11-what-supabase-link-writes.txt.
 *
 * THEREFORE the old `cat supabase/.temp/project-ref` check was RIGHT about where the
 * CLI would go, and the production-named `linked-project.json` was ORPHANED state
 * left by a different tool -- not a CLI wrong-target trap.
 *
 * THE RISK IS REAL ANYWAY, AND IT IS A CROSS-TOOL RISK
 * ----------------------------------------------------
 * The tool that DOES read `linked-project.json` is the Supabase editor extension /
 * MCP tooling -- and on this machine the Supabase MCP `get_project_url` returns the
 * PRODUCTION project and accepts no project parameter. So the two halves of one
 * checkout genuinely pointed at two different databases: the CLI at preview, the MCP
 * at production. An agent that checks one and acts through the other is the hazard,
 * and no single-file check can see it.
 *
 * Neither file is in git (`.gitignore` line 1 excludes `supabase/.temp/`), so
 * the fix CANNOT be a committed file. It has to be a committed CHECK. This is it.
 *
 * ----------------------------------------------------------------------------
 * THE RULE THIS ENFORCES
 * ----------------------------------------------------------------------------
 * Never infer the target from link state. NAME the ref you mean, explicitly, and
 * make the tooling prove link state agrees with it. That is why `expectedRef` is
 * a REQUIRED input with no default: a default would reintroduce exactly the
 * silent-wrong-target failure this file exists to stop.
 *
 * It FAILS CLOSED. A missing `project-ref`, an unparseable file, two files that
 * disagree, or agreement on the WRONG ref are all errors. "I could not tell" is
 * never reported as "fine".
 *
 * ONE DELIBERATE EXCEPTION, measured on 2026-08-07:
 * `supabase link --project-ref <ref>` writes `project-ref` and `pooler-url`. It does
 * not create, refresh or delete `linked-project.json` -- that file comes from a
 * DIFFERENT tool (the Supabase editor extension / MCP tooling). That is the root
 * cause of the incident above: the JSON file was stale leftovers pointing at
 * production, and NO amount of re-linking would ever have corrected it.
 * So `linked-project.json` and `pooler-url` are OPTIONAL here: absent is normal and
 * passes, but if present they MUST agree with `project-ref`. Failing on their absence
 * would make this check cry wolf on every freshly linked checkout, and a check that
 * cries wolf gets skipped.
 *
 * USAGE NOTE: `--root=<path>` selects WHICH checkout to inspect. It defaults to the
 * checkout containing this script, which is wrong when the script is invoked by
 * absolute path from a different worktree -- see resolveRoot below.
 *
 * This file contacts NO database, reads NO credential, and needs NO secret. It is
 * pure text handling so it can run in CI offline (tools-offline-tests.yml).
 *
 * ----------------------------------------------------------------------------
 * USAGE
 * ----------------------------------------------------------------------------
 *   SUPABASE_EXPECTED_PROJECT_REF=rjyboqwcdzcocqgmsyel \
 *     node tools/check-supabase-link-state.mjs
 *
 *   node tools/check-supabase-link-state.mjs --expect-ref=rjyboqwcdzcocqgmsyel
 *
 * `--expect-ref=` overrides the environment variable. Exit 0 means both files
 * exist, agree with each other, and name the ref you asked for. Any other
 * situation exits 1 with an error that names BOTH observed values.
 *
 * NEVER hard-code a project ref in this file. The refs above appear only inside
 * this comment, as the historical record of the incident.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath, join as joinPath, dirname } from "node:path";

/** A Supabase project ref: exactly 20 lowercase letters/digits. */
export const PROJECT_REF = /^[a-z0-9]{20}$/;

export const PROJECT_REF_FILE = "supabase/.temp/project-ref";
export const LINKED_PROJECT_FILE = "supabase/.temp/linked-project.json";
export const POOLER_URL_FILE = "supabase/.temp/pooler-url";

/**
 * The ref hides in the USERNAME of the pooler URL, as `postgres.<ref>` -- the host is
 * a shared regional endpoint (aws-0-us-east-1.pooler.supabase.com) and names no project
 * at all. A reader scanning the host for a ref finds nothing and wrongly concludes the
 * file is project-agnostic.
 */
const POOLER_USERNAME_REF = /^postgres\.([a-z0-9]{20})$/;

/**
 * Extract the project ref from `supabase/.temp/pooler-url`, or null when the file is
 * absent or names no project.
 *
 * ============================================================================
 * THIS FUNCTION MUST NEVER PUT THE URL, OR ANY PART OF IT, IN AN ERROR MESSAGE.
 * ============================================================================
 * The pooler URL is a full libpq connection string and its password field CAN carry the
 * database password. Errors from this file reach terminals, CI logs and agent
 * transcripts, and this repository is PUBLIC. Every throw below reports only the FILE
 * and WHAT IS WRONG -- never a value. (The checkout measured on 2026-08-07 happened to
 * have an empty password field, which is luck, not a guarantee.)
 */
export function parsePoolerUrlRef(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") {
    throw new Error(
      `${POOLER_URL_FILE} exists but is EMPTY. Delete supabase/.temp/ and re-link ` +
        "naming the project explicitly."
    );
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(
      `${POOLER_URL_FILE} is not a valid URL. Its content is deliberately NOT printed: ` +
        "it is a connection string and can carry the database password."
    );
  }
  const username = decodeURIComponent(parsed.username ?? "");
  const match = POOLER_USERNAME_REF.exec(username);
  // A username of plain `postgres` is a direct (non-pooled) connection string that
  // asserts no project. Absence of a claim is not a conflicting claim.
  if (!match) return null;
  return match[1];
}

/**
 * Validate the ref the caller SAYS they mean.
 *
 * Required, with no default, on purpose: a default is indistinguishable from an
 * unset variable at the moment it matters, and it would silently re-enable the
 * failure this file exists to prevent.
 */
export function resolveExpectedRef(raw) {
  const ref = String(raw ?? "").trim();
  if (ref === "") {
    throw new Error(
      "The expected project ref is REQUIRED and has no default. Pass " +
        "--expect-ref=<ref> or set SUPABASE_EXPECTED_PROJECT_REF. Link state is exactly " +
        "what must not be trusted here, so the ref you MEAN has to be stated explicitly."
    );
  }
  if (!PROJECT_REF.test(ref)) {
    throw new Error(
      `The expected project ref must be 20 lowercase letters/digits, got ${JSON.stringify(ref)}.`
    );
  }
  return ref;
}

/**
 * Parse `supabase/.temp/project-ref` (a bare ref, possibly with trailing newline).
 * `null` means the file is absent; that is the caller's decision to interpret.
 */
export function parseProjectRefFile(raw) {
  if (raw === null || raw === undefined) return null;
  const ref = String(raw).trim();
  if (ref === "") {
    throw new Error(
      `${PROJECT_REF_FILE} exists but is EMPTY. A half-written link file is not a link. ` +
        "Re-run `supabase link` naming the project explicitly, or delete supabase/.temp/."
    );
  }
  if (!PROJECT_REF.test(ref)) {
    throw new Error(
      `${PROJECT_REF_FILE} does not contain a valid project ref (20 lowercase ` +
        `letters/digits), got ${JSON.stringify(ref)}.`
    );
  }
  return ref;
}

/**
 * Parse `supabase/.temp/linked-project.json`.
 *
 * A malformed or ref-less JSON file is an ERROR, never a shrug. Treating it as
 * "unknown, carry on" is how the disagreement went unnoticed: the file nobody
 * parsed was the one holding the production ref.
 */
export function parseLinkedProjectFile(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") {
    throw new Error(
      `${LINKED_PROJECT_FILE} exists but is EMPTY. Re-run \`supabase link\` naming the ` +
        "project explicitly, or delete supabase/.temp/."
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${LINKED_PROJECT_FILE} is not valid JSON. Its content is deliberately NOT printed ` +
        "here. Delete supabase/.temp/ and re-link naming the project explicitly."
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${LINKED_PROJECT_FILE} must contain a JSON object.`);
  }
  const ref = typeof parsed.ref === "string" ? parsed.ref.trim() : "";
  if (ref === "") {
    throw new Error(`${LINKED_PROJECT_FILE} has no usable "ref" field.`);
  }
  if (!PROJECT_REF.test(ref)) {
    throw new Error(
      `${LINKED_PROJECT_FILE} "ref" is not a valid project ref (20 lowercase ` +
        `letters/digits), got ${JSON.stringify(ref)}.`
    );
  }
  return ref;
}

/**
 * THE GATE. Both files must exist, agree with each other, and equal `expectedRef`.
 *
 * Order is load-bearing. The two files are compared to EACH OTHER first, so the
 * error a session sees for the 2026-08-07 state is the informative one -- "these
 * two disagree, here is each value" -- rather than a bare mismatch against the
 * expectation that leaves the second file unmentioned and the trap undiscovered.
 */
export function evaluateLinkState({
  projectRefRaw,
  linkedProjectRaw,
  poolerUrlRaw,
  expectedRef,
} = {}) {
  const expected = resolveExpectedRef(expectedRef);
  const fromRefFile = parseProjectRefFile(projectRefRaw);
  const fromJsonFile = parseLinkedProjectFile(linkedProjectRaw);
  const fromPoolerUrl = parsePoolerUrlRef(poolerUrlRaw);

  // `project-ref` is the file the CLI actually maintains, so its ABSENCE means
  // unlinked. `linked-project.json` alone is not a link -- it is leftovers.
  if (fromRefFile === null) {
    throw new Error(
      `${PROJECT_REF_FILE} does not exist: this checkout is NOT linked` +
        (fromJsonFile === null
          ? ". That is not a pass. Link explicitly, or use a path that names the project " +
            "ref in the request itself (the Management API) instead of relying on link state."
          : `, yet ${LINKED_PROJECT_FILE} survives and names ${fromJsonFile}. That file is ` +
            "ORPHANED state from another tool, not a link. Delete supabase/.temp/.")
    );
  }

  // linked-project.json being ABSENT is NORMAL and is NOT an error. Measured on
  // 2026-08-07: `supabase link --project-ref <ref>` writes ONLY project-ref and
  // never creates or refreshes linked-project.json. The JSON file is written by a
  // DIFFERENT tool (the Supabase editor extension / MCP tooling), which is exactly
  // why the 2026-08-07 pair could disagree: no `supabase link` will ever correct
  // it, so it sits there stale and outranks nothing while looking authoritative.
  //
  // Treating its absence as a failure would make this check cry wolf on every
  // freshly linked checkout, and a check that cries wolf is a check people learn
  // to skip. So: OPTIONAL, but MUST AGREE WHEN PRESENT.
  if (fromJsonFile !== null && fromRefFile !== fromJsonFile) {
    throw new Error(
      "SUPABASE LINK STATE IS INCONSISTENT -- THIS IS THE 2026-08-07 TRAP.\n" +
        `  ${PROJECT_REF_FILE} says      ${fromRefFile}   <- the CLI follows THIS one\n` +
        `  ${LINKED_PROJECT_FILE} says  ${fromJsonFile}\n` +
        "The CLI targets the project-ref value (measured 2026-08-07), so the risk here is " +
        "NOT that the CLI goes astray -- it is that a DIFFERENT tool reading " +
        "linked-project.json (the Supabase MCP / editor extension) acts on the other " +
        "project while you believe you are working on this one. Do not pick a winner by " +
        "hand: delete supabase/.temp/ and re-link naming the project explicitly."
    );
  }

  // pooler-url carries the ref in its USERNAME (postgres.<ref>) and is the route the CLI
  // actually connects THROUGH when it agrees. Measured 2026-08-07: a pooler-url naming a
  // different ref did NOT redirect the CLI -- it fell back to the direct host derived
  // from project-ref. So this is defence in depth, not a known live hole. It is checked
  // anyway because a disagreeing pooler-url means the link state is not trustworthy, and
  // because whether a VALID mismatched pooler URL can redirect was NOT tested (doing so
  // would have required pointing a connection at production).
  if (fromPoolerUrl !== null && fromRefFile !== fromPoolerUrl) {
    throw new Error(
      "SUPABASE LINK STATE IS INCONSISTENT.\n" +
        `  ${PROJECT_REF_FILE} says  ${fromRefFile}\n` +
        `  ${POOLER_URL_FILE} names  ${fromPoolerUrl} (in its username, as postgres.<ref>)\n` +
        "The URL itself is deliberately NOT printed: it can carry the database password. " +
        "Delete supabase/.temp/ and re-link naming the project explicitly."
    );
  }

  if (fromRefFile !== expected) {
    const agreeing = [
      fromJsonFile === null ? null : LINKED_PROJECT_FILE,
      fromPoolerUrl === null ? null : POOLER_URL_FILE,
    ].filter(Boolean);
    throw new Error(
      `WRONG PROJECT: link state names ${fromRefFile}, but the expected project is ` +
        `${expected}. ` +
        (agreeing.length === 0
          ? `${PROJECT_REF_FILE} is the only link file naming a project, and it does not agree with YOU, `
          : `${PROJECT_REF_FILE} agrees with ${agreeing.join(" and ")} and they all disagree with YOU, `) +
        "so this is a real target mismatch, not file drift. Re-link, or correct the " +
        "expected ref -- do not bypass this check."
    );
  }

  // linkedProjectFile is null when the JSON file is absent, which is the normal
  // post-`supabase link` state. Callers must not treat null as "unknown target".
  return {
    ref: expected,
    projectRefFile: fromRefFile,
    linkedProjectFile: fromJsonFile,
    poolerUrlFile: fromPoolerUrl,
  };
}

/** Read a file, mapping "not found" to null and letting every other error through. */
export async function readOptional(path, read = readFile) {
  try {
    return await read(path, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

export function repoRootFrom(moduleUrl) {
  // tools/<file> -> repo root
  return resolvePath(dirname(fileURLToPath(moduleUrl)), "..");
}

/**
 * Resolve which CHECKOUT to inspect.
 *
 * WHY `--root` EXISTS. This repository runs an agent-per-git-worktree model, so several
 * checkouts of shared-db exist side by side, each with its OWN `supabase/.temp/`.
 * Defaulting to the directory containing THIS SCRIPT means that invoking it by absolute
 * path from another worktree silently validates the WRONG checkout's link state and
 * prints a confident green. That is the same class of bug this file exists to kill, so
 * the root is selectable and is always reported in the output.
 */
export function resolveRoot({ rootArg, cwd, moduleUrl } = {}) {
  if (rootArg !== undefined && rootArg !== null && String(rootArg).trim() !== "") {
    return resolvePath(String(rootArg).trim());
  }
  // `--root=.` and `--root=$PWD` are the explicit ways to check the current directory.
  // The default stays "the checkout this script lives in", which is right for the common
  // `node tools/check-supabase-link-state.mjs` invocation from a repo root.
  return repoRootFrom(moduleUrl);
}

export async function runCli({ argv = [], env = {}, log = console.log, moduleUrl } = {}) {
  const valueOf = (flag) => {
    const hit = argv.find((a) => a.startsWith(`${flag}=`));
    return hit ? hit.slice(flag.length + 1) : undefined;
  };

  const expectedRef = valueOf("--expect-ref") ?? env.SUPABASE_EXPECTED_PROJECT_REF;
  const root = resolveRoot({
    rootArg: valueOf("--root") ?? env.SHARED_DB_ROOT,
    moduleUrl,
  });

  const result = evaluateLinkState({
    projectRefRaw: await readOptional(joinPath(root, PROJECT_REF_FILE)),
    linkedProjectRaw: await readOptional(joinPath(root, LINKED_PROJECT_FILE)),
    poolerUrlRaw: await readOptional(joinPath(root, POOLER_URL_FILE)),
    expectedRef,
  });

  log(
    `Supabase link state is consistent and matches the expected project: ${result.ref}\n` +
      `  checkout: ${root}\n` +
      `  ${PROJECT_REF_FILE}: ${result.projectRefFile}\n` +
      `  ${LINKED_PROJECT_FILE}: ` +
      (result.linkedProjectFile === null
        ? "absent (normal -- `supabase link` does not write this file)"
        : result.linkedProjectFile) +
      `\n  ${POOLER_URL_FILE}: ` +
      (result.poolerUrlFile === null
        ? "absent or naming no project"
        : `${result.poolerUrlFile} (from its username; URL not printed)`)
  );

  return result;
}

async function main() {
  await runCli({ argv: process.argv.slice(2), env: process.env, moduleUrl: import.meta.url });
}

function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolvePath(fileURLToPath(import.meta.url)) === resolvePath(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
