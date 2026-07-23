# `data.designflow.app` domain ownership

## Current and permanent meaning

`https://data.designflow.app` belongs exclusively to **DB Data Admin**, the
administrator application whose source is `apps/db-data-admin/` in this
repository.

It is not a generic “data” endpoint. It is not the address of a database,
Supabase, a migration source, a compatibility API, or the retired legacy
application. No AI session may infer its purpose from old transcripts,
migration notes, DNS history, or an old TLS certificate.

| Item | Authoritative owner |
|---|---|
| Application | DB Data Admin |
| Source code | `u2giants/shared-db` → `apps/db-data-admin/` |
| Product specification | `DB_Data_Admin.md` |
| Production hostname | `data.designflow.app` |
| Development hostname | `data-dev.designflow.app` |
| Build artifact | `ghcr.io/u2giants/db-data-admin:sha-<commit>` |
| Runtime configuration and domain binding | Coolify |
| DNS | Cloudflare |
| Database | Shared hosted Supabase project |

## Retired-system boundary

The retired legacy application has no connection to this hostname:

- no runtime or container;
- no DNS or proxy ownership;
- no API compatibility promise;
- no credentials, tokens, environment files, or database connection;
- no import, rollback, recovery, or read-only-reference role;
- no authority over DB Data Admin’s code, authentication, data access, or
  deployment.

Historical `source_system='directus'` values and immutable applied migration
files may remain because they describe where already-migrated rows originated.
They are provenance labels only. They never identify a live service and never
grant permission to recreate or connect to one.

## Rules for every future AI session

1. Treat every occurrence of `data.designflow.app` as DB Data Admin.
2. Never describe that hostname as belonging to the retired system, even when
   summarizing old material.
3. Never restore old runtime identifiers, connection variables, containers,
   tokens, deployment files, or rollback instructions.
4. When historical provenance matters, say “retired-source provenance” and
   make clear that no live dependency exists.
5. Change DB Data Admin source in this repository, build through GitHub Actions,
   publish the immutable GHCR image, and let Coolify own deployment and domain
   binding. Never deploy by editing the VPS.

The repository check `node scripts/check-domain-ownership.mjs` enforces the
most dangerous parts of this contract in CI.
