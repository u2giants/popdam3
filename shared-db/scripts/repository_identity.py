"""Repository identity: the ONE place Python decides which GitHub repository
"this repository" is (issue #2530, plan_shared_db_popcre_transfer_merge_queue.md
Step 2). Mirrors scripts/lib/repository-identity.mjs.

Resolution order, and nothing else: an explicit value, then the GitHub Actions
GITHUB_REPOSITORY variable, then the verified GitHub origin remote of the
checkout containing this file. Fails closed on a malformed slug, a non-GitHub
remote, no source at all, or any disagreement between available sources.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

# Not a default: kept only so evidence recorded under the pre-transfer URL
# stays verifiable after a transfer.
HISTORICAL_REPOSITORY_SLUG = "u2giants/shared-db"

_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
_REMOTE_PATTERNS = (
    re.compile(r"^https://(?:[^@/\s]+@)?github\.com/([^/\s]+/[^/\s]+?)(?:\.git)?/?$", re.I),
    re.compile(r"^ssh://git@github\.com(?::22)?/([^/\s]+/[^/\s]+?)(?:\.git)?/?$", re.I),
    re.compile(r"^git@github\.com:([^/\s]+/[^/\s]+?)(?:\.git)?/?$", re.I),
)
_CHECKOUT_ROOT = Path(__file__).resolve().parent.parent


class RepositoryIdentityError(ValueError):
    pass


def parse_repository_slug(value, label="repository"):
    text = str(value if value is not None else "").strip()
    parts = text.split("/")
    if len(parts) != 2 or not all(
        _SEGMENT.match(part) and part not in (".", "..") and not part.endswith(".git") for part in parts
    ):
        raise RepositoryIdentityError(f"{label} {text!r} is not a GitHub owner/name slug")
    return f"{parts[0]}/{parts[1]}"


def parse_github_remote_url(url):
    text = str(url if url is not None else "").strip()
    for pattern in _REMOTE_PATTERNS:
        match = pattern.match(text)
        if match:
            return parse_repository_slug(match.group(1), "origin remote repository")
    raise RepositoryIdentityError(f"origin remote {text!r} is not a GitHub repository URL")


def same_repository(a, b):
    return str(a).lower() == str(b).lower()


def read_origin_url(cwd=_CHECKOUT_ROOT, run=subprocess.run):
    try:
        result = run(["git", "-C", str(cwd), "remote", "get-url", "origin"], capture_output=True, text=True)
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return (result.stdout or "").strip() or None


def resolve_repository_identity(explicit=None, env=None, read_origin=read_origin_url):
    env = os.environ if env is None else env
    sources = []
    if explicit is not None and str(explicit).strip():
        sources.append(("explicit repository", parse_repository_slug(explicit, "explicit repository")))
    if env.get("GITHUB_REPOSITORY"):
        sources.append(("GITHUB_REPOSITORY", parse_repository_slug(env["GITHUB_REPOSITORY"], "GITHUB_REPOSITORY")))
    origin = read_origin()
    if origin is not None:
        sources.append(("origin remote", parse_github_remote_url(origin)))
    if not sources:
        raise RepositoryIdentityError(
            "cannot determine the GitHub repository: pass it explicitly, set GITHUB_REPOSITORY, "
            "or run from a checkout whose origin is a GitHub URL"
        )
    first_label, chosen = sources[0]
    for label, slug in sources[1:]:
        if not same_repository(slug, chosen):
            raise RepositoryIdentityError(
                f"repository identity disagreement: {first_label} is {chosen} but {label} is {slug}; refusing to guess"
            )
    return chosen


_cached = None


def current_repository(explicit=None):
    global _cached
    if explicit is not None and str(explicit).strip():
        return resolve_repository_identity(explicit)
    if _cached is None:
        _cached = resolve_repository_identity()
    return _cached


def is_this_repository_or_historical(slug, current=None):
    current = current_repository() if current is None else current
    return same_repository(slug, current) or same_repository(slug, HISTORICAL_REPOSITORY_SLUG)
