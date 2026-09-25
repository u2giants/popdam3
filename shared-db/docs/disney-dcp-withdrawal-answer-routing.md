# Disney DCP Vault withdrawal: answer routing across chats

This note is a durable intake instruction, not an answer or a vendor ruling.
Albert may obtain an answer himself from Laura or Ilona and relay it in any
future shared-db chat. No agent is authorized to contact Disney, Laura, Ilona,
or anyone else to obtain one.

## Status: this question is answered — start from the business rule

The question below was answered and published on 2026-09-25. The authoritative
statement now lives in
[the licensing master-data rule](business-rules/licensing-master-data.md)
under "Disney DCP Vault artwork withdrawal signals", with its full provenance
recorded on issue
[#3347](https://github.com/popcre/shared-db/issues/3347). Read that rule first.

Do not treat this note as the answer, do not re-litigate the settled question,
and do not report the question as unanswered.

What remains routed here is **later input**: a correction, a refinement, or a
new relayed statement about Disney/DCP Vault artwork withdrawal, removal
status or missing artwork. A later answer is applied only to the behavior it
actually settles; everything the settled rule already answers stays as it is
until a later answer clearly changes it.

## Recognize a later answer

The settled question is:

> When artwork disappears from DCP Vault, what notice or status do you use to confirm that Disney withdrew it?

Treat a relayed explanation about Disney/DCP Vault missing artwork, withdrawal
notices, removal status, Laura, or Ilona as potentially settling or correcting
that question. Read the actual answer before deciding its meaning. A name alone
does not prove authority, and an ambiguous answer remains unresolved rather
than a new rule.

## Capture and act in the receiving chat

1. Read [issue #3347](https://github.com/popcre/shared-db/issues/3347)
   (orchestrator work: DCP capture qualification), including current comments
   and state. This is the durable answer anchor, a bounded successor to
   [issue #1275](https://github.com/popcre/shared-db/issues/1275)
   (orchestrator work). Do not send the answer to a remembered chat identifier.
2. Record a sanitized comment on #3347 with the date received, the reported
   speaker, the person relaying it, the answer's exact business meaning, and
   whether it is a direct statement, quotation, paraphrase, or interpretation.
   For example, an answer Albert relays must say "Albert reports that Laura
   said...", never claim the agent spoke to Laura. Preserve uncertainty and any
   limits on the answer's scope. Sign the GitHub comment
   `Posted by MiMo chat <id> on <machine>` (the standing GitHub signature
   rule: `<id>` is `$MIMO_SESSION_ID`, or `unknown` when empty).
3. Keep private messages, licensed artwork, screenshots, identifiers and examples
   in the approved private `u2giants/licensor-source-data` repository. Public
   comments and rules contain only the sanitized decision and provenance; never
   copy private examples into this public repository. If exact wording itself is
   private, retain it privately and publish a faithful sanitized meaning.
4. Once authoritative and unambiguous, amend the settled topic in
   [the companywide business rules](business-rules/licensing-master-data.md)
   following the collection process in
   [docs/business-rules/README.md](business-rules/README.md) ("How rules are
   collected"), through the normal reviewed branch-and-PR process, with
   provenance and the issue reference. In that amendment: record the meaning
   under a clearly separated "What this changes" heading in the same topic
   document (README step 3); mark conflicting older text Historical or add a
   correction at the point a reader would encounter it (README step 5 and
   Maintenance rule item 2); and update
   [application-map.md](business-rules/application-map.md) if relevance
   changed (README step 6 and Maintenance rule item 3). Do not create a
   competing business rule in this note. If authority or meaning is
   unresolved, record precisely what is unresolved and retain the settled
   rule until it is clarified.
5. Classify each concrete follow-up from its own actual work. A database SHAPE
   change must resolve the CURRENT orchestrator using
   `node scripts/check-orchestrator-marker.mjs --resolve` and follow that live
   route. If that command returns UNKNOWN (exit 2 — could not determine),
   treat it as if a marker exists and never collapse it into "none open"; do
   not dispatch. If that command exits NONE (exit 3 — no open marker, no
   active orchestrator), queue the work and do not dispatch. If it reports
   UNSAFE (the marker guard failed), stop and resolve the collision before
   routing.
   A resolved address is DECLARED, not proven reachable (#2350): a
   well-formed address is not authority to write. Never reuse a stale chat
   UUID, marker, or predecessor's object claims.
   Ordinary source capture, producer qualification and loader changes belong
   to the private `u2giants/licensor-source-data` session; repository notes and
   business-rule documentation stay with a non-orchestrator repository session.
   Record the owning issue/repository and the specific next action at #3347.
6. If #3347 is already closed, still record the answer there as the historical
   anchor, then open or link a fresh scoped follow-up only where actual work is
   needed. Do not reopen completed work automatically or inherit its route,
   objects, approvals, or completion claim. A no-change answer is recorded as
   such with its reason; recording an answer alone is not implementation proof.

## Boundaries that remain in force

The separation of facts, the definitions of the withdrawal signals, and the
limits on what this settles are stated once, in
[the settled rule](business-rules/licensing-master-data.md) under "Disney DCP
Vault artwork withdrawal signals". Read and cite that section; this note
deliberately does not restate it, so the two can never drift.

A vendor attestation requirement was an agent proposal, not an owner decision.
Do not make one a prerequisite for technical capture qualification. The #3347
engineering contract is stated in
[the settled rule](business-rules/licensing-master-data.md) under "Disney DCP
Vault artwork withdrawal signals"; confirm the current contract at #3347 before
implementation. This note neither weakens it nor authorizes database or
production writes.

The independent technical producer repair and capture qualification proceed
under their own approvals. The human answer is no longer outstanding: do not
block Disney work waiting for it, and do not present the question as unanswered.
