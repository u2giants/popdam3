"""Fail-closed idempotent apply-attempt recovery (issue #3397).

Prepares a recovery helper for lost-response / lost-upload apply attempts.
No workflow activation and no database write. The workflow owner supplies
trusted adapters and integration under the existing exclusive lock.

Guarantees:
  * A recovery claim binds source, ordered migration hashes, target, baseline,
    expected catalog digest and producer to a trusted qualification record.
  * Stable verification claims exclude observation metadata (timestamps, run
    ids) so a retry cannot mint a new "verified" claim from the same apply.
  * An ambiguous prepared-write response never authorizes another apply.
  * Ledger CONTENT plus catalog verification are required before recovery.
    The workflow adapter must hold one exclusive lock throughout the reads;
    this helper checks its owner before and after but cannot make the reads atomic.
  * Every unknown state is a refusal, never a guessed recovery.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence


class ApplyRecoveryError(Exception):
    """Raised for every refused recovery path."""


# Observation metadata is never part of a stable verification claim.
OBSERVATION_KEYS = frozenset(
    {
        "observed_at",
        "observation_timestamp",
        "run_id",
        "run_attempt",
        "workflow_run",
        "started_at",
        "completed_at",
        "duration_ms",
        "runner_name",
        "request_id",
        "retry_after",
        "wall_clock",
    }
)


def _require_sha40(value: Any, what: str) -> str:
    text = str(value or "")
    if not re.fullmatch(r"[0-9a-f]{40}", text):
        raise ApplyRecoveryError(f"{what} must be an exact 40-character sha, not {value!r}")
    return text


def _require_sha256(value: Any, what: str) -> str:
    text = str(value or "")
    if not re.fullmatch(r"[0-9a-f]{64}", text):
        raise ApplyRecoveryError(f"{what} must be an exact sha256 digest")
    return text


def _require_version(value: Any, what: str) -> str:
    text = str(value or "")
    if not re.fullmatch(r"[0-9]{14}", text):
        raise ApplyRecoveryError(f"{what} must be an exact migration version")
    return text


def _require_nonempty(value: Any, what: str) -> str:
    text = str(value or "")
    if not text.strip():
        raise ApplyRecoveryError(f"{what} must be a non-empty value")
    return text


def strip_observation_metadata(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Return only stable claim fields, dropping observation metadata."""
    if not isinstance(payload, Mapping):
        raise ApplyRecoveryError("claim payload must be a mapping")
    return {k: v for k, v in payload.items() if k not in OBSERVATION_KEYS}


def stable_claim_digest(payload: Mapping[str, Any]) -> str:
    """sha256 over the stable claim, key-sorted and observation-free."""
    stable = strip_observation_metadata(payload)
    canonical = json.dumps(stable, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RecoveryClaim:
    source: str
    migration_hashes: tuple[tuple[str, str], ...]
    target: str
    baseline_sha: str
    producer: str
    expected_catalog_sha256: str
    claim_digest: str = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", _require_sha40(self.source, "source"))
        object.__setattr__(self, "target", _require_nonempty(self.target, "target"))
        object.__setattr__(self, "baseline_sha", _require_sha256(self.baseline_sha, "baseline_sha"))
        object.__setattr__(self, "producer", _require_nonempty(self.producer, "producer"))
        object.__setattr__(self, "expected_catalog_sha256", _require_sha256(self.expected_catalog_sha256, "expected_catalog_sha256"))
        hashes = []
        for i, pair in enumerate(self.migration_hashes):
            if not isinstance(pair, (tuple, list)) or len(pair) != 2:
                raise ApplyRecoveryError(f"migration_hashes[{i}] must be a version and sha256 pair")
            hashes.append((_require_version(pair[0], f"migration_hashes[{i}] version"),
                           _require_sha256(pair[1], f"migration_hashes[{i}] sha256")))
        if not hashes:
            raise ApplyRecoveryError("migration_hashes must name at least one migration")
        if len({version for version, _ in hashes}) != len(hashes):
            raise ApplyRecoveryError("migration_hashes has a duplicate version")
        if [version for version, _ in hashes] != sorted(version for version, _ in hashes):
            raise ApplyRecoveryError("migration_hashes must follow ascending version order")
        object.__setattr__(self, "migration_hashes", tuple(hashes))
        digest = stable_claim_digest(
            {
                "source": self.source,
                "migration_hashes": [list(pair) for pair in self.migration_hashes],
                "target": self.target,
                "baseline_sha": self.baseline_sha,
                "producer": self.producer,
                "expected_catalog_sha256": self.expected_catalog_sha256,
            }
        )
        object.__setattr__(self, "claim_digest", digest)

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "migration_hashes": [list(pair) for pair in self.migration_hashes],
            "target": self.target,
            "baseline_sha": self.baseline_sha,
            "producer": self.producer,
            "expected_catalog_sha256": self.expected_catalog_sha256,
            "claim_digest": self.claim_digest,
        }


@dataclass(frozen=True)
class ApplyAttemptEvidence:
    """Trusted adapter outputs for one apply attempt. Never caller assertions."""

    ledger_rows: tuple[Mapping[str, Any], ...]
    catalog_result: Mapping[str, Any] | None
    prepared_write_status: str  # 'landed' | 'absent' | 'ambiguous'
    exclusive_lock_held: bool
    qualification: Mapping[str, Any] = field(default_factory=dict)
    observation: Mapping[str, Any] = field(default_factory=dict)


def _normalized_ledger_content(rows: Sequence[Mapping[str, Any]]) -> tuple[tuple[str, str], ...]:
    out: list[tuple[str, str]] = []
    for row in rows:
        if not isinstance(row, Mapping):
            raise ApplyRecoveryError("ledger rows must be mappings")
        version = _require_version(row.get("version"), "ledger row version")
        content = _require_sha256(row.get("sha256"), f"ledger row {version} content")
        out.append((version, content))
    if len({version for version, _ in out}) != len(out):
        raise ApplyRecoveryError("ledger has duplicate migration versions")
    return tuple(out)


def evaluate_recovery(claim: RecoveryClaim, evidence: ApplyAttemptEvidence) -> dict[str, Any]:
    """Decide whether an apply attempt may be marked recovered.

    Fail closed on every unknown. An ambiguous prepared-write response never
    authorizes another apply. Verification requires exclusive lock + ledger
    content match + catalog confirmation.
    """
    if not isinstance(evidence, ApplyAttemptEvidence):
        raise ApplyRecoveryError("evidence must be an ApplyAttemptEvidence from trusted adapters")
    if not evidence.exclusive_lock_held:
        raise ApplyRecoveryError("recovery verification requires the existing exclusive lock; refusing without it")
    expected_qualification = {k: claim.as_dict()[k] for k in
                              ("source", "migration_hashes", "target", "baseline_sha", "producer", "expected_catalog_sha256")}
    if not isinstance(evidence.qualification, Mapping) or dict(evidence.qualification) != expected_qualification:
        raise ApplyRecoveryError("trusted qualification differs from recovery claim")

    if evidence.prepared_write_status == "ambiguous":
        raise ApplyRecoveryError(
            "prepared-write response is ambiguous; never authorizes another apply or a recovery claim"
        )
    if evidence.prepared_write_status not in ("landed", "absent"):
        raise ApplyRecoveryError(
            f"unknown prepared_write_status {evidence.prepared_write_status!r}; only 'landed' or 'absent' are decided states"
        )

    ledger = _normalized_ledger_content(evidence.ledger_rows)
    if evidence.prepared_write_status == "absent":
        if ledger or (isinstance(evidence.catalog_result, Mapping) and evidence.catalog_result.get("passed") is True):
            raise ApplyRecoveryError("prepared write is absent but ledger or catalog shows applied content")
        # Nothing landed. Recovery is a clean 'not applied', not a re-apply grant.
        return {
            "disposition": "not-applied",
            "claim_digest": claim.claim_digest,
            "authorizes_reapply": False,
            "reason": "prepared write is absent; no apply to recover",
        }

    # Landed: require ledger CONTENT for every claimed migration, plus catalog.
    ledger_by_version = dict(ledger)
    extra = sorted(set(ledger_by_version) - {version for version, _ in claim.migration_hashes})
    if extra:
        raise ApplyRecoveryError(f"ledger has extra migration(s) outside the claimed attempt {extra}")
    missing = [version for version, _ in claim.migration_hashes if version not in ledger_by_version]
    if missing:
        raise ApplyRecoveryError(
            f"ledger content is missing claimed migration(s) {missing}; refusing to mark recovered"
        )
    mismatched = [version for version, digest in claim.migration_hashes
                  if ledger_by_version[version] != digest]
    if mismatched:
        raise ApplyRecoveryError(f"ledger content hash differs for claimed migration(s) {mismatched}")

    if evidence.catalog_result is None:
        raise ApplyRecoveryError("catalog verification did not run; refusing to mark recovered")
    if evidence.catalog_result.get("passed") is not True:
        raise ApplyRecoveryError("catalog verification did not pass; refusing to mark recovered")
    if evidence.catalog_result.get("target") != claim.target:
        raise ApplyRecoveryError("catalog verification target differs from claim")
    if evidence.catalog_result.get("baseline_sha256") != claim.baseline_sha:
        raise ApplyRecoveryError("catalog verification baseline differs from claim")
    catalog_sha256 = _require_sha256(evidence.catalog_result.get("catalog_sha256"), "catalog verification digest")
    if catalog_sha256 != claim.expected_catalog_sha256:
        raise ApplyRecoveryError("catalog verification digest differs from trusted qualification")

    stable = {
        "source": claim.source,
        "migration_hashes": [list(pair) for pair in claim.migration_hashes],
        "target": claim.target,
        "baseline_sha": claim.baseline_sha,
        "producer": claim.producer,
        "expected_catalog_sha256": claim.expected_catalog_sha256,
        "ledger_content": [list(pair) for pair in ledger],
        "catalog_sha256": catalog_sha256,
        "catalog_passed": True,
    }
    # Observation metadata is excluded from the stable verification claim.
    return {
        "disposition": "recovered",
        "claim_digest": claim.claim_digest,
        "verification_digest": stable_claim_digest(stable),
        "authorizes_reapply": False,
        "reason": "ledger content and catalog verification agree under the exclusive lock",
    }


def recover_apply_attempt(
    *,
    source: str,
    migration_hashes: Sequence[tuple[str, str]],
    target: str,
    baseline_sha: str,
    producer: str,
    expected_catalog_sha256: str,
    read_qualification: Callable[[], Mapping[str, Any]],
    read_ledger: Callable[[], Sequence[Mapping[str, Any]]],
    read_catalog: Callable[[], Mapping[str, Any] | None],
    read_prepared_write: Callable[[], str],
    lock_is_held: Callable[[], bool],
    read_lock_owner: Callable[[], str],
) -> dict[str, Any]:
    """Trusted-adapter entry point. Callers supply adapters, not assertions."""
    if not all(callable(fn) for fn in (read_qualification, read_ledger, read_catalog,
                                      read_prepared_write, lock_is_held, read_lock_owner)):
        raise ApplyRecoveryError("recovery requires trusted callables for qualification, ledger, catalog, prepared-write, and lock")
    claim = RecoveryClaim(
        source=source,
        migration_hashes=tuple(migration_hashes),
        target=target,
        baseline_sha=baseline_sha,
        producer=producer,
        expected_catalog_sha256=expected_catalog_sha256,
    )
    initial_lock = lock_is_held()
    if initial_lock is not True:
        raise ApplyRecoveryError("recovery verification requires the existing exclusive lock before reads")
    initial_owner = _require_sha40(read_lock_owner(), "exclusive lock owner")
    qualification = read_qualification()
    ledger_rows = tuple(read_ledger() or ())
    catalog_result = read_catalog()
    prepared_write_status = read_prepared_write()
    final_lock = lock_is_held()
    if final_lock is not True:
        raise ApplyRecoveryError("recovery lost the existing exclusive lock during reads")
    if _require_sha40(read_lock_owner(), "exclusive lock owner") != initial_owner:
        raise ApplyRecoveryError("exclusive lock owner changed during recovery reads")
    evidence = ApplyAttemptEvidence(
        ledger_rows=ledger_rows,
        catalog_result=catalog_result,
        prepared_write_status=str(prepared_write_status or "").strip().lower(),
        exclusive_lock_held=True,
        qualification=qualification,
        observation={},
    )
    return evaluate_recovery(claim, evidence)
