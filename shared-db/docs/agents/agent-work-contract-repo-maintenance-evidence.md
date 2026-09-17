# The repo-maintenance evidence path for the Agent work contract

**Status:** settled, 2026-09-17. Resolves [#2830](https://github.com/u2giants/shared-db/issues/2830).

## The claim that prompted this document

[#2830](https://github.com/u2giants/shared-db/issues/2830) reported that the `Agent work
contract` check is *unsatisfiable by any honest route* for `repo-maintenance` work — a defect
fixed directly in the repository, with no migration and no author claim — because
`refs/db-contracts/<work_issue>/<generation>` is only created when work is dispatched as a
structural migration-author lane.

**That premise is wrong.** Publishing a contract ref is a plain CLI mode available to any
session with repository write access. It is not lane-restricted, not orchestrator-restricted,
and not route-conditional. `repo-maintenance` is an explicitly supported contract `work_type`
with a worked zero-database example already checked in.

The five pull requests cited as evidence in #2830 (#2818, #2821, #2823, #2825, #2826) have all
since merged.

## What the gate actually requires

`scripts/agent-work-contract-git-evidence.mjs` has no `work_type` or `route` branch. Every
pull request carrying a contract pair is held to the same rule: the checked-in contract must
hash-match a contract published to an immutable ref **before** the work began.

The exemptions in `.github/workflows/agent-work-contract.yml` — report-only mode, the
grandfathered pull-request list, and the documents-only exemption (#2591) — are reached only
when the evidence pair is absent or inherited. Mode is `enforced`
(`config/agent-work-contract-activation.json`), grandfathering is a closed list pinned to exact
heads, and documents-only fails by construction for a change touching scripts or workflows.

So a `repo-maintenance` change to a script or workflow must publish a contract. It can.

## The path, in order

Publication is create-if-absent and therefore immutable: a mistake is corrected by publishing a
new generation, never by replacing one.

1. **Write `.agent/contract.json`.** Set `work_type: repo-maintenance` and
   `route: repo-maintenance`. Set `base_sha` to the exact 40-character commit the branch was cut
   from. Leave `db_reads` and `db_writes` empty. List every path the change may touch in
   `allowed_paths`. See `docs/examples/agent-work-contract-zero-database.json` for the shape.
2. **Publish it, before writing any implementation code:**

```bash
node scripts/agent-work-contract.mjs --publish-contract --contract-file .agent/contract.json
```

3. **Do the work and commit it.** This is the implementation commit; note its SHA.
4. **Commit the evidence pair on top, alone.** Only `.agent/contract.json` and
   `.agent/completion.json` may follow the implementation commit. In the completion report set
   `head_sha` to the implementation commit, `contract_ref` to
   `refs/db-contracts/<work_issue>/<generation>`, and `files_changed` to exactly the output of
   `git diff --name-only <pr_base_sha> <implementation_head>`.

Step 2 is the one that cannot be moved. Publishing after the work is finished and back-dating
the claim is fabricating pre-work evidence, and #2830 was right to refuse it. Publishing first
costs one command.

## Why no exemption was added

The gate is doing real work, and the ordering guarantee it provides is exactly as meaningful for
a repo-maintenance defect fix as for a structural lane: it proves the scope was declared before
the change existed. Nothing about `repo-maintenance` makes that guarantee cheap to give up, and
the cost of honouring it is a single command run at the right moment. Widening the documents-only
exemption to cover code, as #2830 explicitly warned against, would have removed the guarantee for
every script and workflow change in the repository.

## Known limit

`scripts/agent-work-contract.mjs` states it in its own header: under one shared GitHub identity,
create-if-absent gives ordering and non-overwrite, but it does not prove *who* published. A
worker can create its own generation. The rule that only a dispatcher does so is a convention
this code cannot enforce. That limit is unchanged by this document and applies equally to lane
work; it is recorded here so nobody reads the repo-maintenance path above as a new weakness.
