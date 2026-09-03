# Evidence-handling incident — 2026-09-03

The first baseline collection attempt buffered a private NAS path export through the protected command runner. The buffer overflow error rendered one licensed relative path in the private Codex task transcript. No credentials were exposed, no path data was committed, and no evidence was sent to GitHub or an external reviewer.

Remediation: collection now streams NAS path output directly into a mode-0600 file under git-ignored `.private/popsg-readiness/`; errors contain only the fixed artifact name. The failed attempt stopped before database export or comparison.
