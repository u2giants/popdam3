"""Refuse to promote a re-derived migration to a database that lacks its base.

WHY THIS EXISTS (issue #1608). Every loader-style migration in this repository is
authored as a FULL RE-DERIVATION of the then-current object body on `main` --
`20260814193351` states that rule in its own header, and `20260824135515` and
`20260825094455` each name the exact base they re-derived from. A re-derived body
is therefore silently dependent on that base being present IN THE TARGET
DATABASE, because the file replaces the whole object rather than editing it.

Nothing checked that. On 2026-08-24 `20260824135515` -- whose header says it is
"a full re-derivation of the CURRENT function body on main (20260814223552, the
third rewrite)" -- was promoted ALONE to production while none of the three
2026-08-14 rewrites were applied there. Every individual gate passed. The
combination was incoherent: production was left with a
`plm.load_pmt_capture_chunk` that inserted into an absent table (42P01) and
stopped writing two still-NOT NULL columns (23502). It cost three retirements.

Post-apply catalog verification cannot catch this shape. The object still EXISTS
after the apply -- only its body regressed to one written against a different
world. `parse_allowlist` checks syntax, holds and bundle composition; none of
those ask the only question that matters here: IS THE BASE IN THE TARGET LEDGER?

WHAT THIS MODULE ADDS.
  1. A PARSEABLE declaration. `-- derived-from: <version>[, <version>...]` (or
     `-- derived-from: none`) in a migration header. Before this, the dependency
     existed only as English prose, which is exactly why no tool could read it.
  2. A promotion gate. `assert_derivation_bases` refuses an allowlist whose
     member declares a base that is neither already in the target ledger nor
     earlier in the same allowlist. An override exists, must name the resulting
     state, and is recorded in the run log.
  3. A mandate. `assert_declarations_present` refuses a NEW migration that
     replaces an object an earlier migration also replaces unless it declares
     what it was derived from. That is the exact population at risk.

DELIBERATELY NOT DONE: back-filling declarations into already-merged migration
files. Editing a merged file changes its bytes, and an unpromotable byte binding
is itself one of the three failure modes this episode produced
(`20260814223552`). Merged files that need a declaration get one in
`LEGACY_DECLARATIONS` below, transcribed from their own header prose, with the
source quoted so the transcription is auditable without opening the file.
"""

from __future__ import annotations

import re
from pathlib import Path

VERSION_RE = re.compile(r"^\d{14}$")

# The declaration. One line, in a comment, anywhere in the file -- header by
# convention. Repeatable; every occurrence contributes bases.
DECLARATION_RE = re.compile(r"^[ \t]*--[ \t]*derived-from:[ \t]*(.+?)[ \t]*$", re.MULTILINE)

# The population at risk: a whole-object replacement. `create or replace` keeps
# the object present, so the object still exists after a wrong apply and the
# post-apply catalog check stays green while the BODY has regressed.
REPLACE_RE = re.compile(
    r"\bcreate\s+or\s+replace\s+(?:recursive\s+)?"
    r"(function|procedure|view|materialized\s+view)\s+"
    r"([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)

# Migrations stamped at or after this version MUST declare a base when they
# re-replace an object an earlier migration also replaces.
#
# WHY A CUTOFF AT ALL. 136 merged migrations re-replace an object an earlier one
# also replaces, and 131 of them declare nothing. Editing them would change 131
# sets of bytes, and an unpromotable byte binding is one of the three failure
# modes this very episode produced (`20260814223552`). So merged history is
# exempt and the mandate starts at the first instant of the day after this gate
# landed, 2026-08-27. LOWERING this would demand those edits; RAISING it would
# silently un-gate real new work. Both are refused by a test. Merged files that
# still need a machine-readable declaration get one in LEGACY_DECLARATIONS.
DECLARATION_MANDATE_FROM = "20260827000000"

# Declarations for merged files that must not be edited. Each entry records the
# header prose it was transcribed from. A version here is treated exactly as if
# its file carried the line.
LEGACY_DECLARATIONS: dict[str, tuple[frozenset[str], str]] = {
    "20260824135515": (
        frozenset({"20260814223552"}),
        "Its own header: 'This is a full re-derivation of the CURRENT function "
        "body on main (20260814223552, the third rewrite), not a merge of an "
        "older one.' Promoted alone to production on 2026-08-24 with that base "
        "unapplied; this is the episode issue #1608 exists for.",
    ),
    "20260825094455": (
        frozenset({"20260814223552"}),
        "Forward re-derivation of the same Paramount loader body as "
        "20260824135515, retired for an adjacent reason ('only preview apply ran "
        "on a squash-orphaned commit').",
    ),
    "20260814223552": (
        frozenset({"20260814213043"}),
        "The third rewrite of plm.load_pmt_capture_chunk: its body already "
        "assumes 20260814193351's omissions and 20260814213043's new table. "
        "Retired for an unpromotable byte binding; declared here so anything "
        "naming it as a base is itself measured against a base.",
    ),
    "20260814213043": (
        frozenset({"20260814193351"}),
        "The second rewrite of the same loader, derived from the first "
        "(20260814193351). Applied to production 2026-08-25 in the "
        "owner-authorized four-version window, issue #679.",
    ),
    "20260826001518": (
        frozenset({"20260825041105"}),
        "Whole-view `create or replace view api.source_capture_inventory` that "
        "registers the Coca-Cola landing. Verified by content, not by prose: its "
        "body still carries the Sesame and Sega branches added by the earlier "
        "rebuilds, so it was re-derived from the then-current body, whose last "
        "replacement is 20260825041105. This is the same shape as the "
        "20260814233342 trap -- promoted onto a database missing the base it "
        "would replace the view cleanly and downgrade those licensors' coverage "
        "reporting, with the view still present for the catalog check to find.",
    ),
    "20260826002422": (
        frozenset({"20260818024441"}),
        "Whole-view `create or replace view dflow.sample_inventory`, re-derived "
        "from the body last replaced by 20260818024441 (same select list and "
        "terminal-location CASE, rewritten to be index-backed). Verified by "
        "comparing the two view bodies.",
    ),
    "20260825130500": (
        frozenset({"20260825124200"}),
        "The promotable forward repair of the Paramount loader, authored on top "
        "of the vocabulary DDL replacement 20260825124200 and applied directly "
        "after it in the same window.",
    ),
}


class DerivationError(ValueError):
    """A derivation declaration is malformed or missing (an authoring fault)."""


class DerivationRefusal(DerivationError):
    """A promotion is refused because a declared base is absent from the target.

    A distinct type so the production guard can translate exactly this into its
    own ``GuardError`` without also swallowing malformed-declaration errors,
    which are a different problem with a different fix.
    """


def parse_declaration(raw: str, version: str = "<unknown>") -> frozenset[str] | None:
    """The bases a migration's own text declares, or ``None`` if it declares nothing.

    ``-- derived-from: none`` is a POSITIVE declaration of independence and
    returns an empty set, which is different from ``None`` ("said nothing").
    That distinction is what lets the mandate tell a considered "this writes the
    object from scratch" apart from an author who never thought about it.
    """
    matches = DECLARATION_RE.findall(raw)
    if not matches:
        return None
    bases: set[str] = set()
    saw_none = False
    for value in matches:
        for token in (part.strip() for part in value.split(",")):
            if not token:
                raise DerivationError(
                    f"{version}: `-- derived-from:` has an empty entry. Write one or more "
                    "14-digit versions, or the single word `none`."
                )
            if token.lower() == "none":
                saw_none = True
                continue
            if not VERSION_RE.fullmatch(token):
                raise DerivationError(
                    f"{version}: `-- derived-from: {token}` is not a 14-digit migration "
                    "version. The declaration must name the exact version whose body this "
                    "file re-derives, so a machine can look for it in the target ledger. "
                    "Prose in a header comment is what failed on 2026-08-24."
                )
            bases.add(token)
    if saw_none and bases:
        raise DerivationError(
            f"{version}: `-- derived-from: none` cannot be combined with a named base. "
            "Either this file re-derives a body from something, or it does not."
        )
    if version in bases:
        raise DerivationError(f"{version}: a migration cannot be derived from itself.")
    return frozenset(bases)


def declared_bases(
    version: str, path: Path | None = None, raw: str | None = None
) -> frozenset[str] | None:
    """Declared bases for ``version``: the file's own line, else the legacy overlay."""
    if raw is None and path is not None:
        raw = path.read_text(encoding="utf-8")
    if raw is not None:
        parsed = parse_declaration(raw, version)
        if parsed is not None:
            return parsed
    legacy = LEGACY_DECLARATIONS.get(version)
    return legacy[0] if legacy else None


def replaced_objects(raw: str) -> set[str]:
    """``schema.object`` names this file replaces wholesale."""
    return {f"{schema.lower()}.{name.lower()}" for _kind, schema, name in REPLACE_RE.findall(raw)}


def declaration_required(migrations: dict[str, Path]) -> dict[str, set[str]]:
    """Versions that MUST declare a base, mapped to the objects that make it so.

    A version qualifies when it replaces an object that a STRICTLY EARLIER
    migration also replaces. That earlier rewrite may or may not be applied to
    any given database -- precisely the ambiguity a declaration removes.
    """
    replaced_by = {
        version: replaced_objects(path.read_text(encoding="utf-8"))
        for version, path in migrations.items()
    }
    required: dict[str, set[str]] = {}
    for version in sorted(migrations):
        if version < DECLARATION_MANDATE_FROM:
            continue
        overlap = {
            obj
            for other in migrations
            if other < version
            for obj in replaced_by[other] & replaced_by[version]
        }
        if overlap:
            required[version] = overlap
    return required


def assert_declarations_present(migrations: dict[str, Path]) -> None:
    """Refuse a repository whose at-risk migrations say nothing about their base.

    Runs over the whole tree on every pull request rather than at promotion time:
    the moment to demand the declaration is while the file can still be edited
    without breaking a byte binding.
    """
    missing: list[str] = []
    for version, objects in sorted(declaration_required(migrations).items()):
        raw = migrations[version].read_text(encoding="utf-8")
        if declared_bases(version, raw=raw) is not None:
            continue
        missing.append(
            f"  {version} replaces {', '.join(sorted(objects))} -- also replaced by an "
            "earlier migration"
        )
    if missing:
        raise DerivationError(
            "these migrations replace an object an earlier migration also replaces, and do "
            "not say what body they were derived from:\n"
            + "\n".join(missing)
            + "\n\nAdd one line to the header:\n"
            "    -- derived-from: 20260814223552\n"
            "naming the exact version whose body you re-derived, or\n"
            "    -- derived-from: none\n"
            "if this file writes the object from scratch and depends on no earlier rewrite.\n"
            "The promotion lane reads that line and refuses to apply the file to a database "
            "that does not hold the base (issue #1608). Without it the dependency exists only "
            "as English prose, which is what let an incoherent promotion through on "
            "2026-08-24."
        )


def parse_overrides(values: list[str] | None) -> dict[tuple[str, str], str]:
    """Parse ``VERSION:BASE=<recorded note>`` override arguments.

    The note is mandatory and must describe the resulting state, because the
    failure mode is precisely a promotion whose paperwork never described what
    the database would actually hold afterwards.
    """
    overrides: dict[tuple[str, str], str] = {}
    for value in values or []:
        head, sep, note = value.partition("=")
        version, colon, base = head.partition(":")
        if not sep or not colon:
            raise DerivationError(
                f"malformed --derivation-override {value!r}; expected "
                "VERSION:BASE=<note naming the resulting state>"
            )
        version, base, note = version.strip(), base.strip(), note.strip()
        if not VERSION_RE.fullmatch(version) or not VERSION_RE.fullmatch(base):
            raise DerivationError(
                f"--derivation-override {value!r}: both VERSION and BASE must be exact "
                "14-digit versions"
            )
        if len(note) < 40:
            raise DerivationError(
                f"--derivation-override {version}:{base}: the note must state what the target "
                "database will actually hold after this promotion, in at least 40 characters. "
                "A bare 'approved' is the paperwork that failed on 2026-08-24."
            )
        overrides[(version, base)] = note
    return overrides


def assert_derivation_bases(
    allowlist: list[str],
    migrations: dict[str, Path],
    remote: set[str] | frozenset[str],
    overrides: dict[tuple[str, str], str] | None = None,
) -> list[str]:
    """Refuse an allowlist whose member re-derives a body the target does not have.

    LEDGER-AWARE, like ``assert_atomic_batches``: a base already in ``remote`` is
    satisfied, and so is a base earlier in this same allowlist -- both mean the
    base's body is in the database before the derived file runs. Anything else is
    a promotion whose proof does not match what the target holds.

    Returns the override notes it accepted so the caller can print them into the
    run log; an override that is never recorded is not an override, it is a hole.
    """
    overrides = overrides or {}
    remote = set(remote)
    chosen = set(allowlist)
    recorded: list[str] = []
    failures: list[str] = []
    for version in allowlist:
        path = migrations.get(version)
        bases = declared_bases(version, path=path)
        if not bases:
            continue
        for base in sorted(bases):
            if base in remote or base in chosen:
                continue
            note = overrides.get((version, base))
            if note:
                recorded.append(
                    f"DERIVATION OVERRIDE RECORDED: {version} declares base {base}, which is "
                    "absent from the target ledger and from this allowlist. Resulting state "
                    f"as stated by the operator: {note}"
                )
                continue
            unknown = (
                "" if base in migrations else " (no file with that version exists in this repository)"
            )
            failures.append(
                f"  {version} declares `-- derived-from: {base}`, and {base} is NOT in the "
                f"target ledger and NOT in this allowlist{unknown}."
            )
    if failures:
        raise DerivationRefusal(
            "re-derived migration promoted to a database that lacks its base:\n"
            + "\n".join(failures)
            + "\n\nA file that re-derives a whole object body replaces it outright. Applied to "
            "a database missing the base it does not fail -- it succeeds, and silently installs "
            "a body written for a different world. That is what left production incoherent on "
            "2026-08-24 (issue #1608) and cost three retirements. Post-apply catalog "
            "verification cannot see it: the object still exists, only its body regressed.\n"
            "Add the missing base version(s) to this allowlist, or, if the resulting state is "
            "genuinely intended, pass\n"
            "    --derivation-override VERSION:BASE=<what the database will actually hold>\n"
            "which is recorded verbatim in the run log."
        )
    return recorded


def unsatisfied_bases(
    version: str,
    applied: set[str] | frozenset[str],
    path: Path | None = None,
    raw: str | None = None,
) -> list[str]:
    """Declared bases of ``version`` that are absent from ``applied``.

    Used by the drift report so a version whose declared base is unapplied reads
    differently from an ordinary pending version -- today they are
    indistinguishable, which is the third ask on issue #1608.
    """
    bases = declared_bases(version, path=path, raw=raw) or frozenset()
    return sorted(base for base in bases if base not in set(applied))
