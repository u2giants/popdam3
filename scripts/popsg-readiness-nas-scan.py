#!/usr/bin/env python3
"""Read-only PopSG inventory. Output contains licensed paths; keep it private."""
import json
import os
import stat
import sys
from datetime import datetime, timezone

root, contract_path, output_path, summary_path = sys.argv[1:5]
with open(contract_path, encoding="utf-8") as handle:
    contract = json.load(handle)

extensions = set(contract["extensions"])
skip_names = set(contract["skipNames"])
skip_prefixes = tuple(contract["skipPrefixes"])
skip_dirs = set(contract["skipDirectoryNames"])
skip_extensions = set(contract["skipExtensions"])
counts = {"eligible": 0, "excluded": 0, "inaccessible": 0, "symlinks": 0}
by_extension = {}

def skip(name):
    lower = name.lower()
    suffix = lower.rsplit(".", 1)[-1] if "." in lower else ""
    return (not name or lower in skip_names or name.startswith(skip_prefixes)
            or lower in skip_dirs or suffix in skip_extensions)

def onerror(error):
    counts["inaccessible"] += 1
    print(f"INACCESSIBLE\t{error.filename}\t{error}", file=sys.stderr)

with open(output_path, "w", encoding="utf-8") as output:
    for directory, dirs, files in os.walk(root, topdown=True, followlinks=False, onerror=onerror):
        kept = []
        for name in dirs:
            path = os.path.join(directory, name)
            try:
                if skip(name):
                    counts["excluded"] += 1
                elif stat.S_ISLNK(os.lstat(path).st_mode):
                    counts["symlinks"] += 1
                else:
                    kept.append(name)
            except OSError as error:
                onerror(error)
        dirs[:] = kept
        for name in files:
            path = os.path.join(directory, name)
            try:
                if skip(name):
                    counts["excluded"] += 1
                    continue
                mode = os.lstat(path).st_mode
                if stat.S_ISLNK(mode):
                    counts["symlinks"] += 1
                    continue
                if not stat.S_ISREG(mode):
                    counts["excluded"] += 1
                    continue
                suffix = name.rsplit(".", 1)[-1].lower() if "." in name and not name.startswith(".") else ""
                if suffix not in extensions:
                    counts["excluded"] += 1
                    continue
                relative = os.path.relpath(path, root).replace(os.sep, "/")
                output.write(json.dumps({"root_label": os.path.basename(root), "relative_path": relative, "extension": suffix}, separators=(",", ":")) + "\n")
                counts["eligible"] += 1
                by_extension[suffix] = by_extension.get(suffix, 0) + 1
            except OSError as error:
                onerror(error)

summary = {"root": root, "finished_at": datetime.now(timezone.utc).isoformat(), **counts, "by_extension": dict(sorted(by_extension.items()))}
with open(summary_path, "w", encoding="utf-8") as handle:
    json.dump(summary, handle, indent=2, sort_keys=True)
if counts["inaccessible"]:
    sys.exit(2)
