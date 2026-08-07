# Design analysis — moved out of this repository, 2026-08-07

> ## ⛔ The design document is NOT in this repository. This file is a pointer.

A ~937-line design document used to sit at this path. **It has been removed**,
for the same reason the source data beside it was removed one day earlier.

| | |
| --- | --- |
| **Now lives in** | `u2giants/licensor-source-data` — **PRIVATE** |
| **Path** | `disney-opa/DESIGN.md` |
| **Removed from here** | 2026-08-07 |

## Why

Unlike `README.md` in this folder — which is analysis only and holds no data —
that document quoted **real licensor property names, real character names, and
real licensor-internal ID values** from the source extract as worked examples,
throughout its schema and reconciliation sections.

This repository was **public from 2026-06-20 until 2026-08-07 ~15:10 UTC**, so
that content was publicly readable. The owner's ruling on 2026-08-07 was to
**move** the file, not to redact it — exactly as the source data was moved.

The move was verified byte-for-byte: the git blob SHA-1 is identical on both
sides.

## What is still here

`README.md` in this folder stays. It carries the method, the caveats, the
schema reasoning and the open questions, with no licensor-identifying values.
Read it first. The design document in the private repo builds on it.

## Rules

**Do not copy the design document, or its worked examples, back into this
repository** — not the file, not an extract, not a sample, not "just a couple of
illustrative rows", not a commit message, not a PR description. This repository
is intended to become public again. It may hold only this pointer.

**The blob is still in this repository's git history.** Removing it from the
working tree stops the ongoing exposure; scrubbing history is a separate,
deliberate operation that has **not** been performed.
