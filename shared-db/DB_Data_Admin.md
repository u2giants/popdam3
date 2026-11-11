---
summary: "DB Data Admin authoritative specification entry: status, ownership, production URL, domain identity rule, and table of the part files in docs/."
kind: spec
status: current
read-when: any DB Data Admin (data.designflow.app) work; migrations cite this file by name
---

# DB Data Admin — authoritative product and implementation specification

Status: **approved direction; implementation not started**  
Decision date: **2026-07-21**  
Owner and code repository: **`popcre/shared-db`**

Frontend location: **`apps/db-data-admin/` in `u2giants/popdam3`** (moved from this repository on 2026-09-16, popdam3 PR #135)

Production URL: **`https://data.designflow.app`**

> **Domain identity is non-negotiable:** this hostname now means DB Data Admin
> exclusively. A retired application previously used the DNS name, but it has
> no runtime, credential, API, database-connection, import, rollback, proxy, or
> deployment relationship to this application. See
> [`docs/db-data-admin-domain-ownership.md`](docs/db-data-admin-domain-ownership.md).

> **Where this screen is heading:** the Licensors and Properties tabs are the first
> two surfaces of a larger destination — consolidated portal scrapes as the canonical
> `core.*` master data, with ColdLion mapped onto it and a mapping/review screen hosted
> here. Read [`docs/core-master-data-consolidation-aim.md`](docs/core-master-data-consolidation-aim.md)
> before extending either tab. It also records the outstanding access grant for
> `app.profile` `8f383a14-f303-4890-90a2-80306a2d4665` and the two grants DB Data Admin requires.

This is the cold-start specification for a developer with no prior context. It incorporates
the useful database inventory, curation workflows, safety checks, traps, and acceptance
criteria from [`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md), while replacing
that document's obsolete proposal to build the page inside PopCRM.

---

## Where each section lives

The full text was split **verbatim** on 2026-11-11 (size budget; popcre/designflow-backend issue 391). Section numbers and headings are unchanged. Open only the part that holds your section.

| Part | Sections |
|---|---|
| [db-data-admin-spec-part-1.md](docs/db-data-admin-spec-part-1.md) | 1. What we are building and why<br>Ownership decision<br>Repository-mirror decision<br>2. Data architecture a new developer must understand<br>Source references preserve identity<br>Authority rules<br>3. Grid standard — do not create three strategic grid platforms<br>Why RevoGrid here<br>Required grid behavior<br>4. Shared entities and application extension tables<br>Field ownership test<br>Channel decision<br>Dilution<br>PopDAM “Originally Designed For”<br>5. Global and per-application inactivation<br>6. Database inventory to verify before implementation<br>Serving contracts the Step 11 pickers depend on<br>Customers<br>Vendors<br>Licensors and Properties<br>7. Safe DB Data Admin API<br>Authorization mechanism<br>Audit storage<br>Merge execution semantics<br>8. Screen requirements<br>8.1 Customers<br>8.2 Vendors<br>8.3 Duplicate merge workflow<br>8.4 Licensors → Properties<br>9. Mandatory cross-application cutover-safety audit<br>Dated inventory evidence and repeatable searches<br>Step 11 repository and live-confirmation findings (2026-07-23) |
| [db-data-admin-spec-part-2.md](docs/db-data-admin-spec-part-2.md) | 10. Delivery sequence<br>Live deployment state and migration-order hazard (read before Steps 11–13)<br>11. Testing and visual-verification gates<br>Automated tests<br>Required visual evidence<br>Step 11 enforcement and audit verification gates<br>12. Definition of done<br>13. Known traps and failed shortcuts<br>14. Constraints and non-goals<br>15. Key references |
