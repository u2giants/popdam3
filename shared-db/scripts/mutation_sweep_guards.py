#!/usr/bin/env python3
"""Mutation-test refusal guards with resumable, isolated parallel workers.

Each worker gets its own temporary repository copy. Completed mutations are
checkpointed atomically. A report is written only after every requested guard
is accounted for, sources are unchanged, and the clean suite is green.
"""
from __future__ import annotations

import argparse
import ast
import concurrent.futures
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CHECKPOINT_SCHEMA = "shared-db-guard-mutation-checkpoint/v1"
REPORT_SCHEMA = "shared-db-guard-mutation-report/v1"


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def line_offsets(text: str) -> list[int]:
    offsets, total = [0], 0
    for line in text.splitlines(keepends=True):
        total += len(line)
        offsets.append(total)
    return offsets


def character_column(line: str, byte_column: int) -> int:
    """Convert the UTF-8 byte columns reported by ast into string columns."""
    return len(line.encode("utf-8")[:byte_column].decode("utf-8"))


def guards(path: Path) -> tuple[str, list[dict]]:
    with path.open("r", encoding="utf-8", newline="") as source:
        text = source.read()
    offsets = line_offsets(text)
    lines = text.splitlines(keepends=True)
    found = []
    for node in ast.walk(ast.parse(text)):
        if not isinstance(node, ast.If) or not any(isinstance(stmt, ast.Raise) for stmt in node.body):
            continue
        if (isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name)
                and node.test.left.id == "__name__"):
            continue
        start = offsets[node.test.lineno - 1] + character_column(
            lines[node.test.lineno - 1], node.test.col_offset)
        end = offsets[node.test.end_lineno - 1] + character_column(
            lines[node.test.end_lineno - 1], node.test.end_col_offset)
        found.append({"line": node.test.lineno, "test": " ".join(text[start:end].split())[:200],
                      "start": start, "end": end})
    found.sort(key=lambda row: row["start"])
    return text, found


def mutate(text: str, guard: dict) -> str:
    mutated = text[:guard["start"]] + "False" + text[guard["end"]:]
    try:
        ast.parse(mutated)
    except (SyntaxError, IndentationError) as error:
        raise RuntimeError(f"mutation did not produce valid Python for {guard['id']}: {error}") from error
    return mutated


def remaining_seconds(deadline: float) -> float:
    remaining = deadline - time.time()
    if remaining <= 0:
        raise TimeoutError("mutation sweep deadline expired")
    return remaining


def run_suite(command: list[str], repo: Path, timeout: float) -> tuple[bool, str]:
    try:
        process = subprocess.run(command, cwd=repo, capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise TimeoutError(f"test suite exceeded the mutation sweep deadline in {repo}") from error
    return process.returncode == 0, (process.stdout + process.stderr)[-2000:]


def inventory(repo: Path, files: list[str]) -> tuple[list[dict], dict[str, str]]:
    rows, digests = [], {}
    for name in files:
        path = repo / name
        digests[name] = digest(path)
        _text, found = guards(path)
        for position, guard in enumerate(found, start=1):
            rows.append({"id": f"{name}:{position}", "file": name, "position": position, **guard})
    return rows, digests


def command_input_digests(repo: Path, command: list[str]) -> dict[str, str]:
    inputs = {}
    for argument in command:
        candidate = repo / argument
        if candidate.is_file():
            inputs[argument] = digest(candidate)
    return inputs


def checkpoint_metadata(files: list[str], command: list[str], digests: dict[str, str], workers: int,
                        suite_digests: dict[str, str] | None = None) -> dict:
    return {"schema": CHECKPOINT_SCHEMA, "files": files, "command": command,
            "source_digests": digests, "suite_digests": suite_digests or {}, "workers": workers}


def load_checkpoint(path: Path, expected: dict) -> dict[str, dict]:
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    if {key: value.get(key) for key in expected} != expected:
        raise ValueError("checkpoint does not match files, command, source digests, or worker count")
    results = value.get("results")
    if not isinstance(results, list) or any(not isinstance(row, dict) or "id" not in row for row in results):
        raise ValueError("checkpoint results are malformed")
    if len({row["id"] for row in results}) != len(results):
        raise ValueError("checkpoint contains duplicate guard results")
    return {row["id"]: row for row in results}


def save_checkpoint(path: Path, metadata: dict, results: dict[str, dict]) -> None:
    atomic_json(path, {**metadata, "results": sorted(results.values(), key=lambda row: row["ordinal"])})


def copy_repo(source: Path, target: Path) -> None:
    def ignored(_directory: str, names: list[str]) -> set[str]:
        return {name for name in names if name in {".git", "node_modules", ".ai-1223-workers", "__pycache__"}}
    shutil.copytree(source, target, ignore=ignored)
    process = subprocess.run(["git", "init", "--quiet"], cwd=target, capture_output=True, text=True)
    if process.returncode:
        raise RuntimeError(f"could not initialize isolated Git metadata: {process.stderr[-1000:]}")


def worker_run(payload: dict) -> list[dict]:
    repo = Path(payload["repo"])
    checkpoint = Path(payload["checkpoint"])
    metadata = payload["metadata"]
    results = load_checkpoint(checkpoint, metadata)
    with tempfile.TemporaryDirectory(prefix=f"guard-sweep-{payload['worker']}-") as temporary:
        isolated = Path(temporary, "repo")
        copy_repo(repo, isolated)
        green, tail = run_suite(metadata["command"], isolated, remaining_seconds(payload["deadline"]))
        if not green:
            raise RuntimeError(f"isolated clean baseline is red: {tail}")
        for guard in payload["guards"]:
            if guard["id"] in results:
                continue
            if time.time() >= payload["deadline"]:
                break
            path = isolated / guard["file"]
            original = path.read_bytes()
            if hashlib.sha256(original).hexdigest() != metadata["source_digests"][guard["file"]]:
                raise RuntimeError(f"isolated source digest mismatch: {guard['file']}")
            text = original.decode("utf-8")
            started = time.time()
            try:
                path.write_text(mutate(text, guard), encoding="utf-8", newline="")
                still_green, tail = run_suite(metadata["command"], isolated,
                                              remaining_seconds(payload["deadline"]))
            finally:
                path.write_bytes(original)
            if hashlib.sha256(path.read_bytes()).hexdigest() != metadata["source_digests"][guard["file"]]:
                raise RuntimeError(f"worker failed to restore {guard['file']}")
            row = {"id": guard["id"], "ordinal": guard["ordinal"], "file": guard["file"],
                   "line": guard["line"], "test": guard["test"], "survived": still_green,
                   "seconds": round(time.time() - started, 1), "failure_tail": "" if still_green else tail}
            results[row["id"]] = row
            save_checkpoint(checkpoint, metadata, results)
            print(f"worker {payload['worker']}: {len(results)}/{len(payload['guards'])} {row['id']} "
                  f"{'SURVIVED' if still_green else 'caught'}", flush=True)
        return list(results.values())


def verify_restoration(repo: Path, digests: dict[str, str]) -> None:
    changed = [name for name, expected in digests.items() if digest(repo / name) != expected]
    if changed:
        raise RuntimeError(f"source restoration failed: {', '.join(changed)}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, action="append", dest="files")
    parser.add_argument("--command", required=True, help="shell-free test command")
    parser.add_argument("--out", required=True)
    parser.add_argument("--checkpoint", help="checkpoint prefix; defaults beside --out")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--max-seconds", type=int, default=7200)
    parser.add_argument("--limit", type=int, default=0, help="smoke only; incomplete runs never write --out")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.workers < 1 or args.workers > 8 or args.max_seconds < 1:
        print("REFUSED: workers must be 1..8 and max-seconds must be positive.", file=sys.stderr)
        return 2
    repo = Path(__file__).resolve().parent.parent
    command = shlex.split(args.command, posix=os.name != "nt")
    output = repo / args.out
    checkpoint_prefix = repo / (args.checkpoint or f"{args.out}.checkpoint")
    output.unlink(missing_ok=True)
    deadline = time.time() + args.max_seconds
    try:
        green, tail = run_suite(command, repo, remaining_seconds(deadline))
    except TimeoutError as error:
        print(f"INCOMPLETE: no report written: {error}", file=sys.stderr)
        return 3
    if not green:
        print("REFUSED: baseline is red; no mutation result would be trustworthy.", file=sys.stderr)
        print(tail, file=sys.stderr)
        return 2
    rows, digests = inventory(repo, args.files)
    for ordinal, row in enumerate(rows, start=1):
        row["ordinal"] = ordinal
    selected = rows[:args.limit] if args.limit else rows
    suite_digests = command_input_digests(repo, command)
    metadata = checkpoint_metadata(args.files, command, digests, args.workers, suite_digests)
    partitions = [[row for index, row in enumerate(selected) if index % args.workers == worker]
                  for worker in range(args.workers)]
    merged: dict[str, dict] = {}
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = []
            for worker, partition in enumerate(partitions):
                checkpoint = checkpoint_prefix.with_name(f"{checkpoint_prefix.name}.worker-{worker}.json")
                futures.append(executor.submit(worker_run, {"repo": str(repo), "worker": worker,
                    "guards": partition, "checkpoint": str(checkpoint), "metadata": metadata,
                    "deadline": deadline}))
            for future in concurrent.futures.as_completed(futures):
                for row in future.result():
                    if row["id"] in merged:
                        raise RuntimeError(f"duplicate merged result: {row['id']}")
                    merged[row["id"]] = row
    except (KeyboardInterrupt, Exception) as error:
        verify_restoration(repo, digests)
        print(f"INCOMPLETE: checkpoints retained; no report written: {error}", file=sys.stderr)
        return 3
    verify_restoration(repo, digests)
    if len(merged) != len(rows) or set(merged) != {row["id"] for row in rows}:
        print(f"INCOMPLETE: {len(merged)} of {len(rows)} guards checkpointed; no report written.", file=sys.stderr)
        return 3
    try:
        green, tail = run_suite(command, repo, remaining_seconds(deadline))
    except TimeoutError as error:
        print(f"INCOMPLETE: checkpoints retained; no report written: {error}", file=sys.stderr)
        return 3
    if not green:
        print("REFUSED: final clean baseline is red; no report written.", file=sys.stderr)
        print(tail, file=sys.stderr)
        return 2
    ordered = sorted(merged.values(), key=lambda row: row["ordinal"])
    survivors = [row for row in ordered if row["survived"]]
    atomic_json(output, {"schema": REPORT_SCHEMA, "command": command, "files": args.files,
        "source_digests": digests, "suite_digests": suite_digests, "workers": args.workers,
        "total_guards": len(ordered),
        "survivors": len(survivors), "results": ordered, "restoration_verified": True,
        "final_baseline_green": True})
    for worker in range(args.workers):
        checkpoint_prefix.with_name(f"{checkpoint_prefix.name}.worker-{worker}.json").unlink(missing_ok=True)
    print(f"{len(survivors)} of {len(ordered)} guards survived; wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
