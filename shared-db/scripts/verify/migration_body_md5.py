#!/usr/bin/env python3
"""Print the md5 of every dollar-quoted body in a migration file.

READ-ONLY. Touches no database. It exists so that a claim of the form
"production's function X came from migration Y, not migration Z" can be
re-derived by anyone, bit-exactly, instead of being asserted.

Compare the output against, on the target database:

    select n.nspname||'.'||p.proname, md5(p.prosrc), length(p.prosrc)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = '<name>';

LINE ENDINGS ARE PART OF THE STORED BODY
----------------------------------------
Stored pg_proc.prosrc may use LF or CRLF, depending on the applied source and
executor. Neither convention is universal. Compare the appropriate explicitly
selected hash with the actual catalog body before drawing an apply conclusion.
The default remains CRLF for historical callers; --line-endings both labels both
possibilities. This does not normalize the database or establish deployment.

For #5608/#5899, the actual production 20261105061627 resolver bodies matched
LF, not CRLF; the forward v4 verifier contracts also bind LF. A CRLF-only local
comparison must not be reported as contradictory deployed-function evidence.

Usage:
    python scripts/verify/migration_body_md5.py [--line-endings lf|crlf|both] supabase/migrations/<file>.sql [more...]

Output, one line per dollar-quoted body, in file order:
    <14-digit version>  <md5>  <byte length>  <first 60 chars of the body, repr()>
With both, LF or CRLF follows the version on each line.
"""

import argparse
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--line-endings', choices=('lf', 'crlf', 'both'), default='crlf')
    parser.add_argument('paths', nargs='+')
    args = parser.parse_args(argv)
    endings = ('lf', 'crlf') if args.line_endings == 'both' else (args.line_endings,)
    for path in args.paths:
        version = os.path.basename(path)[:14]
        found = False
        for body in bodies(path):
            found = True
            for ending in endings:
                encoded = (body if ending == 'lf' else body.replace("\n", "\r\n")).encode("utf-8")
                fields = (hashlib.md5(encoded).hexdigest(), len(encoded), repr(body[:60]))
                if args.line_endings == 'both':
                    print(version, ending.upper(), *fields)
                else:
                    print(version, *fields)
        if not found:
            # Loud, never silent: a file with no dollar-quoted body is a real answer,
            # not an error, but the caller must be told rather than shown nothing.
            for ending in endings:
                fields = ("-", 0, "<no dollar-quoted body in this file>")
                if args.line_endings == 'both':
                    print(version, ending.upper(), *fields)
                else:
                    print(version, *fields)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
