# Fixed local Chrome qualification before #4427 production access

Owner: the #4427 coordinator. This change preserves app Playwright 1.56.1 and
uses only its documented explicit `channel: 'chrome'` Linux route. It does not
install, download, upgrade, override the operating-system distro, select another
executable or attach to the personal desktop browser. The normal launcher creates
a temporary profile; the runner creates a fresh nonpersistent context.

One private browser-custody manifest pins both official package trees (170
Playwright files and 340 playwright-core files), package version 1.56.1, source
integrity metadata and the installed Chrome assessment. Runtime validation is
mandatory before importing Playwright: reject missing/extra/changed files,
symlinks, foreign ownership and group/world write permissions, including owned
runtime parent directories. Root hardened only its two verified package trees
and node_modules permissions, preserving all file bytes and executable/read bits.
The author's initial strict check refused group-writable npm permissions; it
was retained and passed after this concrete owner-performed hardening.

The exact root-owned executable is `/opt/google/chrome/chrome`, version
156.0.8078.47, SHA256
`95dc9473b4f904cb3ab0800fc7206081fcae12abc094a088bd741a13f1747b72`.
Root-owned ancestors must be regular nonsymlink directories with no group/world
write; the binary must be executable and match its exact hash. Runtime browser
version is checked again after launch. Distro, browser path and Playwright
environment overrides are refused; Chromium receives only fixed PATH, private
HOME and TMPDIR, never QA/DB/OP credentials or ambient proxy/Node options.

Playwright's bundled Chromium is 141; installed branded Chrome is 156. Protocol
compatibility is UNKNOWN until the separately approved local smoke succeeds.
No browser was launched by the author. dpkg verification ties current bytes to
the local package database, not a newly fetched upstream signature. Same-UID
runtime custody remains a disclosed limit even with hashes/permissions checked.

First obtain independent exact source/local-action approval and native gates
for `scripts/rls-browser-smoke.mjs` only. Its fixed private output is
`/tmp/4427-chrome-smoke-private-01a17a03/receipt.json`, created exclusively 0600
inside a real owner-only directory. Start with a cleared environment containing
only fixed PATH `/usr/bin:/bin`, HOME
`/tmp/popdam-4427-runtime-01a17a03/home`, TMPDIR `/tmp` (optional locale only).
Any QA/DB/OP or other variable is refused before browser action. No credential
injection, production URL or account is part of that action.

The shared browser helper launches once, verifies version, creates context/page,
aborts every page-network request, navigates only about:blank, and interacts
with/reads a tiny local input. Unexpected page requests fail. Cleanup closes
context/browser and requires actual exit 0 plus the paired synced private receipt
and hash. This proves no intended page-network activity, not universal OS-level
zero egress. Normal upstream disable-background-networking defaults remain;
there is no proxy/firewall change or claim about every Chrome internal request.

Only after that actual smoke proof may a separate stronger exact fixture-action
review authorize production. The same helper repeats its local capability check
inside that bounded attempt. Its context guard is replaced only after the full
existing production request guard is installed. SDK password authentication, PG
counts and fixture preparation begin only AFTER the local browser/context/DOM
check succeeds. On local failure, SDK authentication/signout and fixture writes
are not attempted. Existing normal browser login, guards, ownership, restoration
and cleanup boundaries remain intact. Old read-only or fixture approvals do not
authorize this new source/action/resource combination.
