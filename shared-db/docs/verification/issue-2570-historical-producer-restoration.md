# Issue 2570: exact historical-restoration producer provenance

Production apply run 34216634560 correctly stopped before writes when original
preview run 34157812748 carried older preview-producer code than the merge that
landed PR 2513. Version `20260907131728` was already registered as an exact
historical restoration, but the production gate did not consult that registry.

The repair keeps producer mismatch as the default refusal. It accepts the
mismatch only when the registry validates all of these together:

- version `20260907131728` and its one exact migration filename;
- original apply run `34157812748`, dispatch commit
  `4f093e3d4c97e4272d147d38e7243ec57d3c08f1`, and applied commit
  `bcc2603977678db73b4ca12d3ed1312a1bff64e2`;
- source PR 2513 and merge commit
  `c5f85ad3a98b7a5598e8c81a56735473d5bb5487`;
- the artifact manifest digest and the current file and statement bytes.

The source PR merge and its ancestry to the promoted main commit remain proved
by the existing gate. An unregistered version, a changed run, commit, source,
merge, digest, filename, or byte fails the registry check and returns to the
ordinary producer-mismatch refusal. This repair does not dispatch preview or
production and makes no database change.
