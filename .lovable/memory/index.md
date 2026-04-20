# Memory: index.md
Updated: now

# Project Memory

## Core
- **Zero-Config**: Fully automated ops. No manual config files. Pull parameters from cloud via heartbeats.
- **Timestamps**: CRITICAL: Always preserve `mtime` and `birthtime` for Disney/Marvel licensing compliance.
- **Supabase Overrides**: Prod is external `ryltkzzernhwnojzouyb.supabase.co`. DO NOT edit `client.ts`; it re-exports `external-supabase.ts`.
- **Admin**: Sole admin is `u2giants@gmail.com`.
- **Typing**: Strict TypeScript. No `any` casting. Use Zod in Edge Functions. Node types required for Agents.
- **Offload Heavy Ops**: High-volume tasks (AI, ERP, grouping) MUST run on Railway worker, not Edge Functions. DB RPCs (`plpgsql`) for heavy writes.
- **UI & UX**: No quiet failures. Always provide verbose diagnostics. Non-technical user.
- **API Limits**: Chunk Supabase REST queries (max 200 items for `.in`, max 20 for path checks).
- **Sister app PopSG**: Separate Supabase + separate Lovable project + shared bridge agent. See `mem://architecture/popsg-sister-app`.

## Memories
- [Agents Architecture](mem://features/architecture-agents) — Bridge/Windows agents, heartbeats, hot-reload config, fallback chains
- [Asset Processing](mem://features/asset-processing) — Timestamp preservation, path rules, PDF extraction, TIFF hygiene, thumbnails
- [Style Groups & SKUs](mem://features/style-groups) — SKU parsing, mega-group prevention (>50 limit), filtering, search
- [AI & ERP](mem://features/ai-and-erp) — Gemini tagging, ERP enrichment, MG01 legacy cutoff rules, audit logging
- [External Supabase & Auth](mem://architecture/supabase-and-auth) — External project routing, Google OAuth, monolith edge functions, schema truth
- [Railway Worker](mem://architecture/background-worker) — Async delegation, persistent bulk operations, API throttling, DB RPCs
- [PopSG Sister App](mem://architecture/popsg-sister-app) — Separate Supabase (eeueczxhezfhyrhdmidg), light theme, shared bridge agent, depth-2 folder grouping
