"""Normalize an evidence-only production migration allowlist.

This module deliberately performs syntax checks only.  Atomic-batch and
co-presence policy needs the current remote ledger, which is available in the
production preflight/apply lane but not in the immutable review recorder.
"""

from __future__ import annotations

import re


VERSION_RE = re.compile(r"[0-9]{14}")


class ReviewAllowlistError(ValueError):
    """The evidence allowlist is empty or syntactically invalid."""


def normalize_review_allowlist(raw: str) -> list[str]:
    """Return unique 14-digit versions in the exact order supplied."""
    versions = [part.strip() for part in raw.split(",")]
    if not versions or any(not version for version in versions):
        raise ReviewAllowlistError("production allowlist is empty or contains an empty entry")
    malformed = [version for version in versions if not VERSION_RE.fullmatch(version)]
    if malformed:
        raise ReviewAllowlistError(
            "production allowlist entries must be exactly 14 decimal digits"
        )
    if len(versions) != len(set(versions)):
        raise ReviewAllowlistError("production allowlist contains a duplicate")
    return versions
