# PopSG crawl-health signed-in QA — 2026-09-07

- Production: `https://sg.designflow.app/settings`
- Database target observed by the browser: `qsllyeztdwjgirsysgai`
- Signed-in role: dedicated production administrator with `styleguides` access
- Live frontend build shown in the application: `70680cb`
- State exercised: `attention_required` from the ordinary 2026-09-06 crawl

The panel truthfully showed discovered/accepted/stale/deactivated/remaining labels, active-library and prior-run counts, aggregate freshness, the empty-crawl guard reason, and the safe instruction that existing files were preserved and the next ordinary crawl should retry. The manual crawl control was not used.

Desktop and 390-pixel mobile checks passed. At 390 pixels the card was 356 pixels wide and the document had zero horizontal overflow. Five observed crawl-health Admin requests returned HTTP 200.

The broader Settings journey is not accepted: the separate preview-coverage RPC repeatedly returned HTTP 500, and matching Virginia database logs recorded normal statement-timeout cancellations. The timeout was not increased. Structural repair is routed as `u2giants/shared-db#2509`; final console/network acceptance remains pending it.

Raw screenshots remain private and git-ignored because production QA may reveal licensed library context:

- desktop SHA-256: `3a4ba371d71bd639444bf744025cb5e594d370f156cb0be249cd6a2d80ef9d27`
- mobile SHA-256: `36d69f5a69351ec1130782b8633de00a63fe40c72f8c29b1d091e53771424e68`

Healthy/reconciling production evidence remains pending the next ordinary crawl and is not claimed by this artifact.
