# PopDAM #121 signed-in acceptance

Captured 2026-09-11 in the production PopDAM browser session using the protected administrator test account. The session was read-only: no order or Master Data edits were saved, and no request headers, cookies, browser storage, row payloads, or credentials were recorded.

## Live build

- Customer-visible build stamp: `dc7e4c0` on `/styles` and `/orders`.
- Exact deployed implementation commits: `1d17075ebe0c0283bebfaa20cb73ce4295e2077a` (progressive Master Data loading), `f6af7dd8cd50e9b3f92c9e3f4c00d48f1bc0b1ee` (count-free OrderList opening), and `dc7e4c0fcf4d31f5726bcdb0a4e33e3b29a31acb` (governed Find lookup).

## Acceptance evidence

### Generic Master Data

- `/styles` Generic tab completed with **3,215 rows loaded**.
- The signed-in network list showed four bounded 1,000-row requests at offsets 0, 1,000, 2,000, and 3,000; all completed with HTTP 200, followed by the count check (HTTP 206).
- Find was entered after completion using a production description term; the control remained active and the grid retained the full 3,215-row dataset.
- Screenshot: [Generic toolbar with Find](./generic-toolbar-find.png).

### Licensed Master Data

- `/styles` Licensed tab completed with **12,527 rows loaded**.
- The signed-in network list showed the four-request first wave at offsets 0, 1,000, 2,000, and 3,000, then bounded continuation requests through the remaining ranges; the final observed continuation requests completed with HTTP 200.
- A transient HTTP 500 occurred once for the offset-1,000 request during the first attempt; the application retried that range successfully with HTTP 200 and reached the unchanged final count. This was recorded rather than hidden.
- Screenshot: [Licensed toolbar](./licensed-toolbar.png).

### OrderList opening and Find

- `/orders` opened with **24,486 shown of 24,486 lines**; the first visible data appeared in approximately 0.8 seconds in a fresh tab, with the normal 500-row block request.
- Find was entered after scrolling within the bounded loaded window. The production network list showed one `find_dam_order_list_row` POST with HTTP 200, followed only by the ordinary bounded destination block request when needed; no ID-range scan requests and no fallback warning appeared.
- The result returned to the matching context while the Find control remained active. The summary stayed at 24,486 lines, confirming Find did not replace the bounded grid with a filtered full download.
- Screenshot: [OrderList toolbar with Find](./orderlist-toolbar-find.png).

## Result

The final signed-in acceptance gates for Generic Master Data, Licensed Master Data, and OrderList opening/Find passed on the deployed build. The transient retried HTTP 500 is retained here as an operational observation; it did not change the final dataset or customer-visible result.
