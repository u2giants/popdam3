# Cloud SQL Depth snapshot and MG04 gap resolution

Captured read-only on 2026-08-07 at 23:12 UTC through Cloud SQL Auth Proxy using the dedicated `albert_read_only` database account and the read-only `sa-supabase-planning-proxy` service account. Credentials came from 1Password vault `vibe_coding`; no value was printed or written to this repository.

## Authoritative production Depth snapshot

- Database: DesignFlow production Cloud SQL, PostgreSQL 17.9.
- `designflow."itemDepth"`: 121 rows.
- `designflow."itemHeader"`: 19,671 rows.
- Depth lookup snapshot SHA-256: `6a8dd274e380bbb12fd997d916858a75d5f6ae61872be02a92432f2a1f92c1ce`.
- Depth usage snapshot SHA-256: `89a7d0cceead215252a36af71b91344584784a5c3623e884161d0665f3882f04`.
- `0.63` is present.
- All 121 Cloud SQL lookup rows match the Supabase `dflow."itemDepth"` mirror exactly across legacy ID, code, title, status, and audit text.
- All nonblank Item Header Depth values match the mirror's usage totals. Cloud SQL has 209 additional items, and every additional row has blank Depth.

Conclusion: the 121-row Cloud SQL lookup is the authoritative first import snapshot. Its legacy IDs and exact labels can seed `core.product_depth`. The older Airbyte timestamp does not indicate lookup drift; direct comparison proved zero row differences.

## MG04 direct-feed proof

- ColdLion `/merchGroupHeaders?companyCode=EDGEHOME&size=200&page=0` returned a paged envelope with `37/37` rows, `totalPages=1`, `first=true`, and `last=true`.
- The Size headers identify MG04 for `SP001`, `EH001`, and `CW001`.
- `/merchGroupDetails` returns complete plain arrays, not paged envelopes:
  - `SP001`: 187 rows.
  - `EH001`: 156 rows.
  - `CW001`: 187 rows.
  - Total direct Size rows: 530.
- Production Cloud SQL has 661 legacy MG04 rows.

## Resolution of the 17 direct-feed gaps

The rows are not unexplained truncation:

- Eight are inactive historical Size rows with zero current item-code usage:
  - `CW001`: `5B`, `8H`, `TT`.
  - `EH001`: `5B`, `8T`, `ET`, `M8`, `TT`.
- Nine belong to `EP001`, whose MG04 header means **Pages**, not Size: `114`, `144`, `168`, `192`, `288`, `360`, `504`, `576`, and `672`.
- EP001 must not enter `core.product_size` merely because its legacy slot number is `04`. MG meaning is division-scoped.
- The eight retired Size identities must be retained as inactive, nonselectable legacy source references so rollback and old-ID resolution remain possible.

## Resolution of the 11 normalized label differences

The stable identity is `(companyCode, divisionCode, mgTypeCode, mgCode)`. ColdLion is the current authority for the label attached to that identity. The importer may therefore use the current ColdLion label while preserving the legacy Cloud SQL label in source history and comparison audit data.

The 11 reviewed differences are:

| Division | Code | Legacy Cloud SQL label | Current ColdLion label |
|---|---|---|---|
| CW001 | 25 | `12.5X15.5"` | `12.5X15.25"` |
| CW001 | 4A | `40"X20"` | `40X20"` |
| CW001 | 4S | `48 X 60"` | `48X60"` |
| CW001 | 58 | `5"x8"` | `5X8"` |
| CW001 | 71 | `7X10.25"` | `7.9X11.5"` |
| CW001 | T2 | `20x3.5"` | `30X22"` |
| EH001 | 05 | `9.5X5` | `10X5"` |
| EH001 | 1A | `10X20"` | `15X23"` |
| EH001 | 41 | `40x16"` | `14X30"` |
| EH001 | 6T | `6X2"` | `60X48"` |
| EH001 | Q6 | `22X16"` | `15X22"` |

Item Headers mostly retain only the MG04 code, not a stable MG04 ID. The guarded importer and backfill must resolve by item division plus code. It must never resolve by code alone.

## Gate result

The read-only evidence gaps from Steps 1, 3, and 6 are closed. This does not authorize a production write. The next session may design the guarded importer and additive shared-db migrations after recording the owner's selection policy for inactive Size rows. Legacy IDs and labels remain compatibility shadows through parity and rollback checks.
