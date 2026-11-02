
OrderList workflow fallback (#5393) preserves the canonical order item and exact
item-bridge precedence. Only absent exact candidates may use one exact normalized
style/catalog Master Data row whose ColdLion item has the same nonempty source
company. Duplicate fallback rows abstain even when their values agree. Named
blank fields remain authoritative. The separate bounded
`public.get_dam_order_vendor_ids(uuid[])` reader supplies source Vendor IDs as
text, without exposing landing tables or adding work to the primary row query.
It requires exact primary ColdLion SO/line, latest consistent intake reference,
parent/component match and unanimous nonblank history codes; missing evidence
stays NULL. Both reader contracts are exercised by
`scripts/test-orderlist-vendor-workflow.sh` in disposable PostgreSQL.
