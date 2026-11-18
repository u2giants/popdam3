#!/usr/bin/env python3
"""Compare four read-only #5610 captures using the verified delivery timestamp.

Run search-performance-capture.sql before delivery (pre start/end) and after it
(post start/end), saving the snapshot JSON object at each point. The post
interval must be at least 24 hours. Freeze the input collection and scope
before delivery. This report never accepts a migration or declares performance
healthy. Compare new/changed query identities, workload variation and weighted
execution time with app request/error evidence and representative plan checks.
Zero genuine calls cannot verify a feature. Global eviction, any unreadable
statement, or an invalid interval leaves the comparison unusable. Preserve
other independent telemetry, as statement stats omit per-request failures and
cannot distinguish every request routed through a shared wrapper.
"""

import argparse
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, localcontext
import json
from pathlib import Path


FEATURES = (
    "dam_search", "dam_image_similarity", "style_guide_browse",
    "style_guide_search", "ai_tag_candidates", "hts_ruling_search",
)
CONTINUITY_KEYS = (
    "database_oid", "postmaster_started_at", "database_stats_reset",
    "statement_stats_reset", "statement_track", "dealloc",
)
STATEMENT_KEYS = ("userid", "dbid", "toplevel", "queryid")


def timestamp(value):
    result = datetime.fromisoformat(value)
    if result.utcoffset() is None:
        raise ValueError("capture and delivery timestamps must include a timezone")
    return result


def nonnegative_decimal(value):
    if not isinstance(value, str):
        raise ValueError("metrics must be exact decimal strings")
    result = Decimal(value)
    if not result.is_finite() or result < 0:
        raise ValueError("invalid statement metric")
    return result


def load_snapshot(snapshot):
    if snapshot["format"] != "5610-search-performance-v1":
        raise ValueError("unrecognized snapshot format")
    if snapshot["capture_stable"] is not True or snapshot["unreadable_rows"] != 0:
        raise ValueError("unstable capture or unreadable statement rows")
    started = timestamp(snapshot["started_at"])
    finished = timestamp(snapshot["finished_at"])
    if started > finished:
        raise ValueError("capture timestamps are out of order")
    timestamp(snapshot["postmaster_started_at"])
    timestamp(snapshot["statement_stats_reset"])
    if snapshot["database_stats_reset"] is not None:
        timestamp(snapshot["database_stats_reset"])
    if not snapshot["database_oid"].isdecimal() or not snapshot["dealloc"].isdecimal():
        raise ValueError("invalid database identity or deallocation counter")
    if snapshot["statement_track"] not in {"top", "all"}:
        raise ValueError("statement tracking disabled or unrecognized")
    identities = {}
    for row in snapshot["statements"]:
        identity = tuple(row[key] for key in STATEMENT_KEYS)
        if row["dbid"] != snapshot["database_oid"]:
            raise ValueError("statement belongs to another database")
        if identity in identities:
            raise ValueError("duplicate statement identity")
        if not row["calls"].isdecimal() or row["query_md5"] is None:
            raise ValueError("missing statement hash or invalid calls")
        features = row["features"]
        if not features or features != sorted(set(features)) or not set(features) <= set(FEATURES):
            raise ValueError("invalid statement feature attribution")
        if timestamp(row["stats_since"]) > finished:
            raise ValueError("statement identity appeared after snapshot timestamp")
        identities[identity] = row
        nonnegative_decimal(row["total_exec_ms"])
    return started, finished, identities


def interval(start, end, start_at):
    groups = {feature: {"calls": 0, "total_exec_ms": Decimal(0), "statements": []} for feature in FEATURES}
    if start.keys() - end.keys():
        raise ValueError("previously observed statement missing at close")
    for identity, last in end.items():
        first = start.get(identity)
        if first is None and timestamp(last["stats_since"]) < start_at:
            raise ValueError("newly visible statement predates interval opening")
        if first and any(
            first[key] != last[key] for key in ("stats_since", "query_md5", "features")
        ):
            raise ValueError("statement identity or feature attribution changed")
        delta_calls = int(last["calls"]) - (int(first["calls"]) if first else 0)
        delta_time = nonnegative_decimal(last["total_exec_ms"]) - (
            nonnegative_decimal(first["total_exec_ms"]) if first else 0
        )
        if delta_calls < 0 or delta_time < 0 or (delta_calls == 0 and delta_time != 0):
            raise ValueError("statement counters are inconsistent")
        for feature in last["features"]:
            group = groups[feature]
            group["calls"] += delta_calls
            group["total_exec_ms"] += delta_time
            if delta_calls:
                group["statements"].append({
                    **dict(zip(STATEMENT_KEYS, identity)),
                    "query_md5": last["query_md5"],
                    "calls": delta_calls,
                    "total_exec_ms": str(delta_time),
                    "mean_exec_ms": str(delta_time / delta_calls),
                    "new_identity": first is None,
                })
    for group in groups.values():
        group["mean_exec_ms"] = str(group["total_exec_ms"] / group["calls"]) if group["calls"] else None
        group["total_exec_ms"] = str(group["total_exec_ms"])
    return groups


def compare(snapshots, delivered_at):
    (pre_start, pre_close, post_start, post_close) = snapshots
    ((pre_open_started, pre_open_finished, pre_open_rows),
     (pre_close_started, pre_close_finished, pre_close_rows),
     (post_open_started, post_open_finished, post_open_rows),
     (post_close_started, _, post_close_rows)) = map(load_snapshot, snapshots)
    delivered_at = timestamp(delivered_at)
    if not (pre_open_finished < pre_close_started <= pre_close_finished <= delivered_at
            <= post_open_started <= post_open_finished < post_close_started):
        raise ValueError("capture windows do not bracket delivery")
    if post_close_started - post_open_finished < timedelta(hours=24):
        raise ValueError("post-delivery observation shorter than 24 hours")
    for key in CONTINUITY_KEYS:
        if any(snapshot[key] != pre_start[key] for snapshot in (pre_close, post_start, post_close)):
            raise ValueError(f"capture continuity failed for {key}")
    with localcontext() as context:
        context.prec = 50
        # Also check for per-statement counter/identity resets between windows.
        interval(pre_close_rows, post_open_rows, pre_close_started)
        return {
            "evidence_only": True,
            "delivered_at": delivered_at.isoformat(),
            "pre_elapsed_seconds": (pre_close_started - pre_open_finished).total_seconds(),
            "post_elapsed_seconds": (post_close_started - post_open_finished).total_seconds(),
            "pre": interval(pre_open_rows, pre_close_rows, pre_open_started),
            "post": interval(post_open_rows, post_close_rows, post_open_started),
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delivered-at", required=True)
    parser.add_argument("captures", type=Path, nargs=4, metavar="SNAPSHOT")
    args = parser.parse_args()
    try:
        snapshots = [json.loads(path.read_text(encoding="utf-8")) for path in args.captures]
        print(json.dumps(compare(snapshots, args.delivered_at), indent=2))
    except (OSError, ValueError, TypeError, AttributeError, KeyError, InvalidOperation) as error:
        parser.exit(2, f"Comparison unavailable: {error}\n")


if __name__ == "__main__":
    main()
