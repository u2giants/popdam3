# The Supabase CLI pin — why `supabase --version` does not establish it (#688)

**Status:** live. This is the durable record issue #688 asked for.
**Verified:** 2026-08-11 on `al8960ofc` (Windows 11, scoop install), first found 2026-08-10 on
`hetz` (Ubuntu) during orchestrator session `511f124e`, marker #684.

---

## The one-sentence version

The official Supabase CLI `v2.105.0` release ships **two different programs** — `supabase` and
`supabase-go` — **both of which print `2.105.0`**, so "`supabase --version` says 2.105.0" proves
you are on the right *version* and proves **nothing at all** about being on the right *binary*.

Verify the pin by **SHA-256 checksum**. Never by the version string alone.

---

## The pinned binary

| Which | File | SHA-256 |
|---|---|---|
| ✅ **This is the pin** | `supabase` (`supabase.exe` on Windows) | `da4948c14a7cbc051b622b082bc32633dc3692e41ab942aa4fa7ce80436cc6e1` |
| ❌ Not the pin — different program | `supabase-go` (`supabase-go.exe`) | `9aedef9848bb3b5d706f9f33df0ceae0d88c687d1896d8fa183a4e20a0bd1a53` |

Both report `2.105.0`. Both are shipped inside the same official release. Neither is a corrupt
copy of the other — they are **different builds with different behaviour**.

### Check your machine in one command

```bash
# Linux / macOS
sha256sum "$(command -v supabase)"

# Windows, Git Bash
sha256sum "$(command -v supabase)"
```

Expect `da4948c1…6cc6e1`. Anything else — including `9aedef98…0bd1a53` — means you are **not** on
the pinned binary, no matter what `--version` says.

---

## Why this is not trivia — the coupling is real and it is load-bearing

`scripts/production_migration_guard.py` (line ~934) parses the CLI's dry-run output by matching a
**literal string**:

```python
marker = "Would push these migrations:"
```

plus a filename regex. If the other binary words that line even slightly differently, the guard's
`verify_dry_run` fails — and **the failure presents as a migration fault, not as a wrong-binary
problem.** Someone would spend a session debugging migrations that are fine.

> ⚠️ **That parser has still never been exercised successfully.** Nobody has yet produced a
> successful `verify_dry_run` against either binary. So the failure mode above is a live,
> unproven risk, not a solved one. Do not record it as tested until a run proves it.

## Where the version-string assertion is still relied upon

Issue #611's gate, and `docs/verification/issue-611-run-brief.md`, both establish the pin by
asserting that `supabase --version` prints `2.105.0`. **That assertion is insufficient** for the
reason above and should point here instead. That file is owned by another live workstream at the
time of writing, so the correction is recorded here rather than applied there.

---

## Machine-by-machine state

| Machine | State | Evidence |
|---|---|---|
| `al8960ofc` (Windows) | ✅ On the pin | scoop shim `~/scoop/shims/supabase.shim` resolves to `…\scoop\apps\supabase\current\supabase.exe`, checksum `da4948c1…`. Both binaries sit side by side in `current\`; only the shim decides which one you get. |
| `hetz` (Ubuntu, production server) | ✅ On the pin | Updated 2026-08-10 from `2.98.2`. The binary used by the #611 run was identified and `/usr/local/bin/supabase` checksum-matched to it. |
| `t16`, `916`, `4837` | ❓ Unverified | Nobody has run the checksum on these. |

### `hetz` rollback, if ever needed

The previous `2.98.2` is backed up and checksum-verified against the original. As root:

```bash
mv /root/supabase-cli-backup/supabase-2.98.2 /usr/local/bin/supabase
```

It was a plain dropped-in binary — not apt, not npm, not snap, not a symlink — so replacing it
creates no package-manager conflict. There is no self-update command, no cron job and no systemd
timer touching it. `unattended-upgrades` is enabled but only manages apt packages, and this binary
is not apt-owned, so nothing will drift it off the pin on its own.

---

## Two traps that look like a broken install but are not

1. **A behavioural difference you can see immediately.** On `al8960ofc`, `supabase.exe --version`
   prints `2.105.0` and stops. `supabase-go.exe --version` prints `2.105.0` **and then an update
   notice** ("A new version of Supabase CLI is available: v2.113.0"). Same version string,
   different program, visibly different output — which is exactly the class of difference that
   would break a literal-string parser.

2. **Running `supabase --version` from inside a directory that itself contains a file named
   `supabase` makes the CLI crash with a misleading error.** It looks exactly like a broken
   install. It is not. `cd` somewhere else and run it again.

---

## The rule for the next CLI update, on any machine

Every future update faces this same fork. So:

1. After installing, **record the SHA-256 of the binary the shim/`PATH` actually resolves to** —
   not the one you think you installed.
2. **Update the table at the top of this file in the same pull request** that moves the pin.
3. Do not treat a matching `--version` as evidence. It is not, and that is the whole point of this
   page.
