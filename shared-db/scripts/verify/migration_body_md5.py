#!/usr/bin/env python3
"""Print the md5 of every dollar-quoted body in a migration file.

READ-ONLY. Touches no database. It exists so that a claim of the form
"production's function X came from migration Y, not migration Z" can be
re-derived by anyone, bit-exactly, instead of being asserted.

Compare the output against, on the target database:

    select n.nspname||'.'||p.proname, md5(p.prosrc), length(p.prosrc)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = '<name>';

WHY THE CRLF NORMALIZATION MATTERS
----------------------------------
The shared Supabase database stores pg_proc.prosrc with CRLF line endings,
while the migration files in this repo are LF. A naive md5 of the file body
therefore mismatches EVERY function, including ones that are correctly applied,
and reads as "not applied" -- a false negative in exactly the direction that is
dangerous. This script normalizes to CRLF before hashing. If you re-derive a
result by hand and get a mismatch, check your line endings before concluding
anything.

Usage:
    python scripts/verify/migration_body_md5.py supabase/migrations/<file>.sql [more...]

Output, one line per dollar-quoted body, in file order:
    <14-digit version>  <md5>  <length>  <first 60 chars of the body, repr()>
"""

import hashlib
import os
import re
import sys

# Non-greedy match of a dollar-quoted string with a matching open/close tag.
DOLLAR_QUOTED = re.compile(r"(\$[a-zA-Z_]*\$)(.*?)\1", re.S)


def bodies(path):
    # newline='' so Python does no translation of its own; we normalize explicitly.
    with open(path, encoding="utf-8", newline="") as fh:
        text = fh.read().replace("\r\n", "\n")
    for match in DOLLAR_QUOTED.finditer(text):
        yield match.group(2)


def main(argv):
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    for path in argv:
        version = os.path.basename(path)[:14]
        found = False
        for body in bodies(path):
            found = True
            crlf = body.replace("\n", "\r\n").encode("utf-8")
            print(version, hashlib.md5(crlf).hexdigest(), len(crlf), repr(body[:60]))
        if not found:
            # Loud, never silent: a file with no dollar-quoted body is a real answer,
            # not an error, but the caller must be told rather than shown nothing.
            print(version, "-", 0, "<no dollar-quoted body in this file>")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
