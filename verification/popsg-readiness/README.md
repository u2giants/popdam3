# PopSG production-readiness evidence

Committed files in this directory contain counts, timestamps, hashes, and redacted operational evidence only. Licensed filenames, paths, database row IDs, and candidate exports stay in the git-ignored `.private/popsg-readiness/` directory.

## Reproduce the baseline

1. Launch the read-only, low-priority NAS inventory:
   `node scripts/popsg-readiness-baseline.mjs --launch-nas`
2. Wait for the reported remote job to contain `exit-code.txt` with `0` and an empty `stderr.txt`.
3. Inject the production Supabase URL/service-role credentials through 1Password, set `POPSG_NAS_JOB` to that completed job directory, and run:
   `node scripts/popsg-readiness-baseline.mjs --collect`

The collector refuses any Supabase URL except `https://qsllyeztdwjgirsysgai.supabase.co`. Review `.private/popsg-readiness/` locally for exact path differences; publish only the generated summary in this directory.
