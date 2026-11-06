# #5758 Step 0 baseline — read-only production survey

Read 2026-11-05 6:18 PM EST (2026-11-05T23:18:57Z) through the pooler
(`aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`).
Target proof emitted by the reading script before any query ran:
`db=postgres user=postgres addr=2600:1f18:4f06:de02:5cfe:53d9:472c:a837/128 port=5432`.
SELECT-only; no writes were made. Times below are UTC unless noted.

Headline numbers (queries below reproduce them live — never paste these into
another document as if they were current):

- `coldlion.change_log`: **1,000,290 rows, 1,009 MB heap, 1,322 MB with indexes**;
  oldest entry 2026-09-14. 807,622 `item_merch_group` + 135,134 `item_header`
  `updated` rows are ~94% of the table.
- **Description flapping is the dominant writer**: of the newest 3,000
  `item_merch_group` `updated` rows, **2,994 changed only `mg_desc`** (+hash/id);
  of 3,000 `item_header` `updated` rows, **2,981 changed only `merchGroupNNDesc`**
  (+hash). One 2026-11-05 morning run alone wrote 43,723 `item_merch_group` and
  9,058 `item_header` change rows.
- `public.style_guide_search_documents`: 197,739 updates, **0 HOT**, 14 indexes,
  heap 482 MB / indexes 1,053 MB.
- Label-resolution baseline for the Step 1 gate: **68,289 of 252,269
  `item_merch_group` slot rows have no `merch_group_detail` match** under the
  (company, division, `lpad(slot_no)` as mg_type_code, mg_code) join; 181
  (company, division, mg_type_code, mg_code) groups span more than one
  `mg_category` row.
- Item-master sweeps (`ingest.sync_run`, `item_taxonomy_resolver`): PM sweeps
  update thousands of rows (5,101 on 2026-11-05 3:30 PM EST; 5,831 on 2026-11-04
  3:20 PM EST) while the overnight AM sweeps update ~0-4. `ingest.raw_record`
  keeps only the current payload, so whether the PM updates are real ERP changes
  or a residual always-changing column **cannot be decided from a single
  reading**; the after-measurement (Step 8) re-diffs against this baseline and
  decides Step 3d. No payload values are recorded here (public repository).

Reproduce the headline counts (SELECT-only):

```sql
-- change_log size and span
select count(*) rows, min(changed_at), max(changed_at),
       pg_size_pretty(pg_relation_size('coldlion.change_log')) heap
from coldlion.change_log;

-- rows by table/kind
select table_name, change_kind, count(*) from coldlion.change_log
group by 1,2 order by 3 desc;

-- description-only flap fraction (item_merch_group; newest 3,000)
with s as (select previous_raw, new_raw from coldlion.change_log
           where table_name='item_merch_group' and change_kind='updated'
           order by changed_at desc limit 3000)
select count(*) sampled, count(*) filter (where d.non_desc = 0 and d.any_diff) desc_only
from s cross join lateral (
  select (select count(*) from jsonb_object_keys(s.previous_raw) k
           where s.previous_raw->k is distinct from s.new_raw->k
             and k not in ('mg_desc','source_hash','id')) non_desc,
         (select exists(select 1 from jsonb_object_keys(s.new_raw) k2
           where s.previous_raw->k2 is distinct from s.new_raw->k2)) any_diff) d;

-- item_header variant: exclude keys matching '^merchGroup[0-9]{2}Desc$' and source_hash

-- label-resolution baseline
select count(*) slot_rows, count(*) filter (where d.mg_code is null) unmatched_slots
from coldlion.item_merch_group g
left join (select distinct company_code, division_code, mg_type_code, mg_code
           from coldlion.merch_group_detail) d
  on d.company_code=g.company_code and d.division_code=g.division_code
 and d.mg_type_code=lpad(g.slot_no::text,2,'0') and d.mg_code=g.mg_code;
```

`pg_stat_database.stats_reset` at reading time: never reset (counters are
cumulative since project creation). Note: `pg_stat_user_tables` counters for the
`coldlion.*` tables read as zero despite daily loader activity while older
tables show full history — treat those specific counters as untrustworthy for
this baseline; the `change_log` per-day counts above come from the table itself.

Full survey output follows.

Target proof: db=postgres user=postgres addr=2600:1f18:4f06:de02:5cfe:53d9:472c:a837/128 port=5432
Read at: 2026-11-05T23:18:57.701Z (11/5/2026, 6:18:57 PM EST)
stats_reset: (never reset)

### User tables over 50 MB (heap/live/index bytes, counters since stats_reset)

| tbl | total_sz | heap_b | index_b | est_rows | live_est_b | n_tup_ins | n_tup_upd | n_tup_hot_upd | n_tup_del | idx_count |
|---|---|---|---|---|---|---|---|---|---|---|
| public.assets | 3495 MB | 2122317824 | 1408868352 | 151540 | 251859480 | 43 | 95220 | 54244 | 0 | 46 |
| public.style_guide_search_documents | 2327 MB | 481886208 | 1053089792 | 231769 | 259581280 | 0 | 197322 | 0 | 0 | 14 |
| hts_rag.hts_rag_rulings | 2054 MB | 108625920 | 660029440 | 138130 | 91580190 | 15167 | 39025 | 4 | 0 | 10 |
| plm.nbcu_asset_metadata_value | 2031 MB | 878108672 | 1251287040 | 2421445 | 842662860 | 0 | 0 | 0 | 0 | 2 |
| public.dam_search_documents | 1909 MB | 394985472 | 621592576 | 156638 | 225402082 | 45 | 14337 | 951 | 0 | 6 |
| coldlion.change_log | 1322 MB | 1058529280 | 71458816 | 988449 | 1019090919 | 26 | 0 | 0 | 0 | 4 |
| plm.dcp_metadata_asset | 1272 MB | 322052096 | 127041536 | 375308 | 323515496 | 0 | 0 | 0 | 0 | 7 |
| public.asset_tags | 1197 MB | 478380032 | 776937472 | 2178560 | 416104960 | 39637 | 0 | 0 | 34610 | 6 |
| dam.dam_asset_image_vectors | 1005 MB | 290004992 | 528269312 | 141560 | 251552120 | 42 | 0 | 0 | 0 | 4 |
| public.style_guide_files | 966 MB | 293953536 | 718856192 | 301178 | 446948152 | 0 | 0 | 0 | 0 | 23 |
| hts_rag.hts_rag_ruling_sentences | 776 MB | 531251200 | 282705920 | 2482242 | 511341852 | 0 | 0 | 0 | 0 | 3 |
| public.style_guide_file_tags | 774 MB | 436109312 | 375504896 | 1195503 | 419621553 | 0 | 0 | 0 | 0 | 5 |
| plm.nbcu_asset | 724 MB | 461463552 | 277569536 | 232084 | 426338308 | 0 | 0 | 0 | 0 | 12 |
| dflow_prod.AuditLog | 580 MB | 344014848 | 156467200 | 651188 | 521601588 | 240 | 0 | 0 | 0 | 6 |
| public.asset_effective_tags | 547 MB | 174866432 | 398442496 | 2159853 | 129591180 | 39643 | 0 | 0 | 34610 | 2 |
| plm.nbcu_asset_property | 545 MB | 390774784 | 180232192 | 274287 | 373030320 | 0 | 0 | 0 | 0 | 2 |
| ingest.raw_record | 527 MB | 215580672 | 26042368 | 103747 | 73452876 | 18 | 5101 | 827 | 0 | 2 |
| public.dam_search_keys | 508 MB | 96567296 | 179855360 | 148395 | 76275030 | 45 | 13126 | 2 | 0 | 6 |
| plm.dcp_asset_term_observation | 437 MB | 216719360 | 241729536 | 2328040 | 214179680 | 0 | 0 | 0 | 0 | 3 |
| app.AuditLog | 373 MB | 294912000 | 13287424 | 624000 | 464256000 | 0 | 0 | 0 | 0 | 1 |
| dflow.AuditLog | 365 MB | 289144832 | 13172736 | 552500 | 393932500 | 0 | 0 | 0 | 0 | 1 |
| pim.product | 318 MB | 15187968 | 9437184 | 17953 | 10951330 | 0 | 0 | 0 | 0 | 15 |
| plm.pmt_asset_metadata_value | 312 MB | 179765248 | 147038208 | 622771 | 267168759 | 0 | 0 | 0 | 0 | 5 |
| archive.erp_items_raw | 292 MB | 288948224 | 17506304 | 298284 | 275017848 | 0 | 0 | 0 | 0 | 3 |
| plm.nbcu_asset_style_guide | 282 MB | 212762624 | 82944000 | 136440 | 198383760 | 0 | 0 | 0 | 0 | 2 |
| plm.nbcu_asset_ip_family | 277 MB | 152535040 | 137879552 | 214378 | 144705150 | 0 | 0 | 0 | 0 | 2 |
| hts_rag.hts_rag_ruling_codes | 274 MB | 132874240 | 154509312 | 960609 | 108548817 | 86887 | 0 | 0 | 21141 | 4 |
| plm.nbcu_asset_scope | 243 MB | 92512256 | 161923072 | 255297 | 90885732 | 0 | 0 | 0 | 0 | 2 |
| hts_rag.hts_rag_ruling_products | 231 MB | 182886400 | 59416576 | 103142 | 90146108 | 0 | 0 | 0 | 0 | 9 |
| plm.dcp_asset_property_observation | 191 MB | 81444864 | 118857728 | 874896 | 80490432 | 0 | 0 | 0 | 0 | 4 |
| hts_rag.hts_rag_ruling_current_codes | 176 MB | 149348352 | 30793728 | 178231 | 89650193 | 20777 | 510 | 335 | 0 | 3 |
| plm.wb_asset_normalized | 164 MB | 154664960 | 17178624 | 147830 | 151377920 | 0 | 0 | 0 | 0 | 3 |
| plm.lucasfilm_dcp_metadata_asset | 156 MB | 34668544 | 14991360 | 43717 | 36459978 | 0 | 0 | 0 | 0 | 7 |
| hts_rag.hts_rag_extractions | 146 MB | 115007488 | 17047552 | 104965 | 146216245 | 0 | 0 | 0 | 0 | 3 |
| coldlion.item_merch_group | 144 MB | 107569152 | 43425792 | 245243 | 47577142 | 0 | 0 | 0 | 0 | 2 |
| plm.dcp_asset | 141 MB | 64184320 | 84164608 | 192193 | 64769041 | 0 | 0 | 0 | 0 | 6 |
| plm.item_import | 118 MB | 119455744 | 4677632 | 19949 | 36207435 | 18 | 5119 | 566 | 0 | 3 |
| public.style_guide_tagging_state | 110 MB | 57884672 | 57286656 | 305958 | 47117532 | 0 | 0 | 0 | 0 | 2 |
| plm.dcp_asset_tile_observation | 104 MB | 48898048 | 59695104 | 447217 | 54113257 | 0 | 0 | 0 | 0 | 4 |
| plm.wb_asset_property | 104 MB | 96468992 | 12115968 | 188416 | 95526912 | 0 | 0 | 0 | 0 | 1 |
| plm.style_tracker_item_bridge | 98 MB | 83214336 | 19144704 | 16265 | 28073390 | 40 | 16225 | 2557 | 0 | 10 |
| public.pdf_text_samples | 94 MB | 38576128 | 25952256 | 28913 | 44121238 | 0 | 0 | 0 | 0 | 5 |
| public.style_tracker_rows | 87 MB | 60719104 | 30121984 | 17072 | 21493648 | 40 | 0 | 0 | 0 | 7 |
| plm.nbcu_entity_lifecycle | 86 MB | 44449792 | 45924352 | 121343 | 46231683 | 0 | 0 | 0 | 0 | 5 |
| plm.production_order_line | 85 MB | 76742656 | 11902976 | 23264 | 39176576 | 0 | 0 | 0 | 0 | 11 |
| plm.wb_asset_style_guide_normalized | 85 MB | 79708160 | 9486336 | 147474 | 75064266 | 0 | 0 | 0 | 0 | 1 |
| hts_rag.hts_rag_heading_decisions | 85 MB | 70615040 | 17997824 | 153723 | 68560458 | 0 | 0 | 0 | 0 | 5 |
| coldlion.order_history_line | 83 MB | 56115200 | 30400512 | 119624 | 44500128 | 0 | 0 | 0 | 0 | 3 |
| plm.wb_asset_franchise | 81 MB | 75538432 | 9494528 | 147536 | 71112352 | 0 | 0 | 0 | 0 | 1 |
| plm.item | 80 MB | 78790656 | 5275648 | 19965 | 36915285 | 18 | 5101 | 652 | 0 | 6 |
| plm.dcp_asset_crawl | 77 MB | 48611328 | 32129024 | 344172 | 45774876 | 0 | 0 | 0 | 0 | 2 |
| plm.wwe_asset_tag | 73 MB | 37806080 | 38633472 | 200353 | 36063540 | 0 | 0 | 0 | 0 | 2 |
| dflow.itemAttachment | 67 MB | 64978944 | 4866048 | 213529 | 61709881 | 0 | 0 | 0 | 0 | 1 |
| coldlion.order_history_component | 65 MB | 30482432 | 37445632 | 117782 | 30623320 | 0 | 0 | 0 | 0 | 5 |
| plm.peanuts_asset | 64 MB | 17268736 | 4620288 | 23019 | 18553314 | 0 | 0 | 0 | 0 | 4 |
| plm.dcp_asset_character_observation | 64 MB | 31490048 | 35291136 | 338272 | 31121024 | 0 | 0 | 0 | 0 | 3 |
| hts_rag.hts_rag_product_attributes | 60 MB | 42893312 | 20463616 | 283669 | 42550350 | 0 | 0 | 0 | 0 | 3 |
| plm.marvel_asgard_node_asset_observation | 60 MB | 53166080 | 9945088 | 44673 | 51284604 | 0 | 0 | 0 | 0 | 1 |
| coldlion.prod_history_line | 57 MB | 29949952 | 30212096 | 62493 | 30121626 | 4 | 0 | 0 | 0 | 5 |
| dam.search_group_vectors | 57 MB | 56541184 | 622592 | 10951 | 34889886 | 2 | 0 | 0 | 0 | 1 |
| plm.lucasfilm_dcp_asset_term_observation | 55 MB | 26943488 | 30392320 | 289432 | 26627744 | 0 | 0 | 0 | 0 | 3 |
| public.style_groups | 53 MB | 18825216 | 36085760 | 11252 | 15032672 | 2 | 1583 | 36 | 0 | 17 |


### Top 30 UPDATE/INSERT statements by rows (pg_stat_statements)

| calls | rows | ms | q |
|---|---|---|---|
| 86894 | 86894 | 164373 | in ert into ht _rag.ht _rag_ruling_code  (ruling_number, code, role,  ource_ pan, extract_ver ion,  ource_environment)         value  ($1, $2, $3, int |
| 15577 | 21295 | 34256 | in ert into ht _rag.ht _rag_ruling_current_code       (ruling_number, held_code,  tate, current_code, candidate_code , method, mapping_path, ht _revi  |
| 18836 | 18836 | 774575 | update ht _rag.ht _rag_ruling   et raw_j on = ca t($1 a  j onb), pdf_url = $2 where ruling_number = $3 |
| 17679 | 17679 | 687953 | update ht _rag.ht _rag_ruling   et category = $1, h _era = $2,       extract_ver ion = $3, extracted_at = now() where ruling_number = $4 |
| 15168 | 15168 | 507971 | INSERT INTO "ht _rag"."ht _rag_ruling " ("id","ruling_number","full_text","full_text_ha h"," ubject","ruling_date","collection","tariff ","operational |
| 11418 | 11394 | 11988 | UPDATE "ht _rag"."ht _rag_ruling_inge t_job " SET " tatu "=$1,"claimed_at"=$2,"claimed_by"=$3,"lea e_expire _at"=$4,"attempt_count"=$5,"updated_at"=$6 |
| 10479 | 10479 | 4329 | UPDATE "ht _rag"."ht _rag_ruling_inge t_job " SET " tatu "=$1,"error_code"=$2,"error_detail"=$3,"completed_at"=$4,"updated_at"=$5,"lea e_expire _at"=$ |
| 5082 | 5082 | 5060 | in ert into ht _rag.ht _rag_ruling_link  (from_ruling, to_ruling, kind, link_ ource,  ource_environment)         value  ($1, $2, $3, $4, $5) on confli |
| 2079 | 2079 | 3368 | INSERT INTO "ht _rag"."ht _rag_ruling_inge t_job " ("id","ruling_number"," ource_determination_id"," tatu ","attempt_count","max_attempt "," ource_env |
| 1374 | 1374 | 97031 | UPDATE "ht _rag"."ht _rag_ruling " SET "fetched_at"=$1 WHERE "id" = $2 |
| 954 | 954 | 317 | UPDATE "ht _rag"."ht _rag_ruling_inge t_job " SET " tatu "=$1,"completed_at"=$2,"updated_at"=$3,"lea e_expire _at"=$4,"error_code"=$5,"error_detail"=$ |
| 696 | 696 | 7651 | UPDATE "ht _rag"."ht _rag_ruling " SET " ubject"=$1,"collection"=$2," ource_url"=$3,"fetched_at"=$4 WHERE "id" = $5 |
| 240 | 240 | 1390 | INSERT INTO "dflow_prod"."AuditLog" ("id","oldValue","newValue","u ername","actionType","actionDate","u er_id_fk","moduleName","ref_id_fk","element_id |
| 194 | 194 | 5895 | UPDATE "ht _rag"."ht _rag_ruling " SET " ubject"=$1,"collection"=$2,"tariff "=$3," ource_url"=$4,"fetched_at"=$5 WHERE "id" = $6 |
| 159 | 159 | 1372 | UPDATE "ht _rag"."ht _rag_ruling " SET "collection"=$1," ource_url"=$2,"fetched_at"=$3 WHERE "id" = $4 |
| 128 | 128 | 3356 | UPDATE "ht _rag"."ht _rag_cla ification_job " SET "actual_co t_u d"=COALESCE(actual_co t_u d, $2) + $3,"re ult"=j onb_ et(COALESCE(re ult, $4::j onb), |
| 110 | 110 | 82 | update cron.job_run_detail   et  tatu  = $1, return_me age = $2, end_time = $3 where runid = $4 |
| 104 | 104 | 188 | in ert into cron.job_run_detail  (jobid, runid, databa e, u ername, command,  tatu ) value  ($1,$2,$3,$4,$5,$6) |
| 104 | 104 | 14 | update cron.job_run_detail   et  tatu  = $1 where runid = $2 |
| 104 | 104 | 5 | update cron.job_run_detail   et  tatu  = $1,  tart_time = $2 where runid = $3 |
| 104 | 104 | 12 | update cron.job_run_detail   et job_pid = $1,  tatu  = $2 where runid = $3 |
| 102 | 102 | 1499 | UPDATE "ht _rag"."ht _rag_cla ification_job " SET "re ult"=COALESCE(re ult, $5::j onb) || $6::j onb WHERE "id" = $1 AND " tatu " = $2 AND "claimed_by" |
| 54 | 54 | 22 | UPDATE "ht _rag"."ht _rag_cla ification_job " SET " tatu "=$1,"claimed_at"=$2,"claimed_by"=$3,"lea e_expire _at"=$4,"attempt_count"=$5,"updated_at"=$6 |
| 53 | 53 | 13 | INSERT INTO "dflow_prod"."app_ etting " ("key","value","created_at","updated_at") VALUES ($1,$2,$3,$4) ON CONFLICT ("key") DO UPDATE SET "key"=EXCLUDE |
| 53 | 53 | 103 | in ert into coldlion. ync_run   (id, endpoint, company_code, reque t_param , window_from, window_to,     tatu , reque ted_by,  tarted_at, fini hed_at, |
| 48 | 48 | 307 | INSERT INTO "refre h_token " ("created_at", "in tance_id", "parent", "revoked", " e ion_id", "token", "updated_at", "u er_id") VALUES ($1, $2, $3, $4, |
| 48 | 48 | 51 | UPDATE "u er " AS u er  SET "la t_ ign_in_at" = $1, "updated_at" = $2 WHERE u er .id = $3 |
| 42 | 42 | 331 | INSERT INTO "ht _rag"."ht _rag_determination " ("id","product_example_id","precedent_id","method","propo ed_ht ","cla ification_ tate","operative_elig |
| 42 | 42 | 53 | INSERT INTO "ht _rag"."ht _rag_cla ification_job " ("id","determination_id"," e ion_id","turn_index","kind"," tatu ","owner_key","created_by","input", |
| 41 | 40 | 173 | update ht _rag.ht _rag_ruling_inge t_job      et  tatu =$1,claimed_at=clock_time tamp(),claimed_by=$2,         lea e_expire _at=clock_time tamp()+inte |


### coldlion.change_log rows by (table_name, change_kind)

| table_name | change_kind | n_rows | oldest | newest |
|---|---|---|---|---|
| item_merch_group | updated | 807622 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| item_header | updated | 135134 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| item_detail | updated | 18660 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| prod_detail | inserted | 17572 | Thu Sep 17 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Wed Oct 28 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| prepack_detail | inserted | 10259 | Thu Sep 17 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| item_merch_group | inserted | 6017 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| merch_group_detail | inserted | 1986 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Sat Oct 31 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| merch_group_detail | updated | 885 | Tue Oct 20 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| customer | inserted | 837 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| item_header | inserted | 561 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| item_detail | inserted | 379 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| prod_detail | updated | 189 | Wed Sep 23 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Wed Oct 28 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| vendor | inserted | 101 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Wed Oct 21 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| merch_group_header | inserted | 30 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| season | inserted | 20 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| prepack_detail | updated | 19 | Thu Sep 24 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Wed Nov 04 2026 00:00:00 GMT-0500 (Eastern Standard Time) |
| salesperson | inserted | 8 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| vendor | updated | 5 | Fri Sep 25 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Fri Oct 30 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| merch_group_header | updated | 3 | Thu Oct 22 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Wed Oct 28 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |
| division | inserted | 3 | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | Mon Sep 14 2026 00:00:00 GMT-0400 (Eastern Daylight Time) |


### coldlion.change_log size and span

| total_sz | heap_sz | n_rows | oldest | newest |
|---|---|---|---|---|
| 1322 MB | 1009 MB | 1000290 | Mon Sep 14 2026 09:15:29 GMT-0400 (Eastern Daylight Time) | Thu Nov 05 2026 15:30:43 GMT-0500 (Eastern Standard Time) |


### Nightly change_log rows, item_merch_group + item_header (last 8 days)

| table_name | day | n_rows |
|---|---|---|
| item_header | Wed Oct 28 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | 4059 |
| item_merch_group | Wed Oct 28 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | 20680 |
| item_header | Thu Oct 29 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | 1 |
| item_header | Fri Oct 30 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | 91 |
| item_merch_group | Fri Oct 30 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | 76 |
| item_header | Sat Oct 31 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | 1735 |
| item_merch_group | Sat Oct 31 2026 00:00:00 GMT-0400 (Eastern Daylight Time) | 7720 |
| item_header | Tue Nov 03 2026 00:00:00 GMT-0500 (Eastern Standard Time) | 33 |
| item_merch_group | Tue Nov 03 2026 00:00:00 GMT-0500 (Eastern Standard Time) | 44 |
| item_header | Wed Nov 04 2026 00:00:00 GMT-0500 (Eastern Standard Time) | 4150 |
| item_merch_group | Wed Nov 04 2026 00:00:00 GMT-0500 (Eastern Standard Time) | 18680 |
| item_header | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) | 9058 |
| item_merch_group | Thu Nov 05 2026 00:00:00 GMT-0500 (Eastern Standard Time) | 43723 |


### item_merch_group updated rows whose only changed fields are mg_desc (+hash/id) — sample 3000 newest

| sampled | desc_only |
|---|---|
| 3000 | 2994 |


### item_header updated rows whose only changed fields are merchGroupNNDesc (+hash) — sample 3000 newest

| sampled | desc_only |
|---|---|
| 3000 | 2981 |


### item_merch_group slots whose (company, division, slot-as-type, mg_code) has no merch_group_detail row

| slot_rows | unmatched_slots |
|---|---|
| 252269 | 68289 |


### merch_group_detail (company,division,mg_type_code,mg_code) groups spanning more than one mg_category row

| type_code_groups_with_multiple_category_rows |
|---|
| 181 |


### Recent /items full-snapshot runs

| id | started_at | finished_at | http_status | body_status | rows_fetched | rows_inserted | rows_updated | rows_unchanged | params |
|---|---|---|---|---|---|---|---|---|---|
| adefd39d-9eac-41d7-b26c-f5087898a65f | Thu Nov 05 2026 09:46:19 GMT-0500 (Eastern Standard Time) | Thu Nov 05 2026 09:48:37 GMT-0500 (Eastern Standard Time) | 200 | — | 19935 | 44 | 9000 | 10440 | {"requests": [{"page": 0, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 1, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 2, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 3, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 4, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 5, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 6, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 7, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 8, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 9, "size": 2000, "companyCode": "EDGEHOME"}], "companyCode": "EDGEHOME", "fullSnapshot": true} |
| 0b9f28b7-1b22-4182-8914-dcdaef38e421 | Wed Nov 04 2026 08:06:32 GMT-0500 (Eastern Standard Time) | Wed Nov 04 2026 08:08:54 GMT-0500 (Eastern Standard Time) | 200 | — | 19891 | 0 | 4139 | 15301 | {"requests": [{"page": 0, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 1, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 2, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 3, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 4, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 5, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 6, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 7, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 8, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 9, "size": 2000, "companyCode": "EDGEHOME"}], "companyCode": "EDGEHOME", "fullSnapshot": true} |
| 2f39044c-771d-4bad-879c-796fce41b7b5 | Tue Nov 03 2026 07:54:46 GMT-0500 (Eastern Standard Time) | Tue Nov 03 2026 07:57:20 GMT-0500 (Eastern Standard Time) | 200 | — | 19877 | 0 | 30 | 19396 | {"requests": [{"page": 0, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 1, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 2, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 3, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 4, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 5, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 6, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 7, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 8, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 9, "size": 2000, "companyCode": "EDGEHOME"}], "companyCode": "EDGEHOME", "fullSnapshot": true} |
| 343ad4d5-cb54-442b-92b2-ee429c93df47 | Mon Nov 02 2026 08:37:59 GMT-0500 (Eastern Standard Time) | Mon Nov 02 2026 08:40:20 GMT-0500 (Eastern Standard Time) | 200 | — | 19877 | 0 | 0 | 19426 | {"requests": [{"page": 0, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 1, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 2, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 3, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 4, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 5, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 6, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 7, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 8, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 9, "size": 2000, "companyCode": "EDGEHOME"}], "companyCode": "EDGEHOME", "fullSnapshot": true} |
| 3cc0b33e-3042-4c64-b149-7bf9e0512e66 | Sat Oct 31 2026 07:02:40 GMT-0400 (Eastern Daylight Time) | Sat Oct 31 2026 07:05:01 GMT-0400 (Eastern Daylight Time) | 200 | — | 19877 | 0 | 1733 | 17693 | {"requests": [{"page": 0, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 1, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 2, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 3, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 4, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 5, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 6, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 7, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 8, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 9, "size": 2000, "companyCode": "EDGEHOME"}], "companyCode": "EDGEHOME", "fullSnapshot": true} |
| 09667f9c-7b45-415a-892a-580b757ff3a1 | Fri Oct 30 2026 07:29:37 GMT-0400 (Eastern Daylight Time) | Fri Oct 30 2026 07:32:10 GMT-0400 (Eastern Daylight Time) | 200 | — | 19867 | 0 | 79 | 19337 | {"requests": [{"page": 0, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 1, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 2, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 3, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 4, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 5, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 6, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 7, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 8, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 9, "size": 2000, "companyCode": "EDGEHOME"}], "companyCode": "EDGEHOME", "fullSnapshot": true} |
| 159b377d-b334-48ea-ba4a-7efffe9c04fe | Thu Oct 29 2026 07:36:39 GMT-0400 (Eastern Daylight Time) | Thu Oct 29 2026 07:39:00 GMT-0400 (Eastern Daylight Time) | 200 | — | 19862 | 0 | 0 | 19411 | {"requests": [{"page": 0, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 1, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 2, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 3, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 4, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 5, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 6, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 7, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 8, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 9, "size": 2000, "companyCode": "EDGEHOME"}], "companyCode": "EDGEHOME", "fullSnapshot": true} |
| e3fbade9-45b3-46cd-9285-ccb6ee2cfa38 | Wed Oct 28 2026 18:37:59 GMT-0400 (Eastern Daylight Time) | Wed Oct 28 2026 18:40:21 GMT-0400 (Eastern Daylight Time) | 200 | — | 19862 | 38 | 4021 | 15352 | {"requests": [{"page": 0, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 1, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 2, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 3, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 4, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 5, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 6, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 7, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 8, "size": 2000, "companyCode": "EDGEHOME"}, {"page": 9, "size": 2000, "companyCode": "EDGEHOME"}], "companyCode": "EDGEHOME", "fullSnapshot": true} |


### Recent item-master import sweeps (ingest.sync_run)

| id | source_system | source_name | status | started_at | finished_at | rows_seen | rows_inserted | rows_updated |
|---|---|---|---|---|---|---|---|---|
| 986cf2b3-3cec-4217-8497-7e3f19a274ee | coldlion | item_taxonomy_resolver | succeeded | Thu Nov 05 2026 15:30:45 GMT-0500 (Eastern Standard Time) | Thu Nov 05 2026 15:30:45 GMT-0500 (Eastern Standard Time) | 19949 | 18 | 5101 |
| dae40c80-24cd-430f-a7fd-532a1a1f37db | coldlion | item_taxonomy_resolver | succeeded | Thu Nov 05 2026 00:40:05 GMT-0500 (Eastern Standard Time) | Thu Nov 05 2026 00:40:05 GMT-0500 (Eastern Standard Time) | 19931 | 0 | 4 |
| 4eac1d48-bf53-4ac7-8496-4b1173ceec94 | coldlion | item_taxonomy_resolver | succeeded | Wed Nov 04 2026 15:20:14 GMT-0500 (Eastern Standard Time) | Wed Nov 04 2026 15:20:14 GMT-0500 (Eastern Standard Time) | 19931 | 40 | 5831 |
| f6a2eb9d-201d-4ddd-b0c6-d09566c66f0e | coldlion | item_taxonomy_resolver | succeeded | Wed Nov 04 2026 08:00:43 GMT-0500 (Eastern Standard Time) | Wed Nov 04 2026 08:00:43 GMT-0500 (Eastern Standard Time) | 19891 | 0 | 0 |
| 457c00b4-782f-4c8d-93bf-d87be477e38a | coldlion | item_taxonomy_resolver | succeeded | Wed Nov 04 2026 00:20:41 GMT-0500 (Eastern Standard Time) | Wed Nov 04 2026 00:20:41 GMT-0500 (Eastern Standard Time) | 19891 | 11 | 3690 |
| 10fcb0e2-ba78-4613-9436-ecf3b436f4b4 | coldlion | item_taxonomy_resolver | succeeded | Tue Nov 03 2026 15:00:13 GMT-0500 (Eastern Standard Time) | Tue Nov 03 2026 15:00:13 GMT-0500 (Eastern Standard Time) | 19880 | 3 | 3557 |


### ingest.raw_record coldlion/items rows (rewrites happen only when record_hash differs)

| rows_total | rows_updated_last_sweep |
|---|---|
| — | 8570 |


### Update counters on the plan's named tables (since stats_reset)

| relname | n_tup_upd | n_tup_hot_upd | n_tup_ins | n_tup_del | hot_pct |
|---|---|---|---|---|---|
| style_guide_search_documents | 197739 | 0 | 0 | 0 | 0.0 |
| assets | 95444 | 54348 | 43 | 0 | 56.9 |
| hts_rag_rulings | 39134 | 4 | 15211 | 0 | 0.0 |
| hts_rag_ruling_ingest_jobs | 22917 | 0 | 2118 | 0 | 0.0 |
| style_tracker_item_bridge | 16225 | 2557 | 40 | 0 | 15.8 |
| item_import | 5119 | 566 | 18 | 0 | 11.1 |
| raw_record | 5101 | 827 | 18 | 0 | 16.2 |
| item | 5101 | 652 | 18 | 0 | 12.8 |
| change_log | 0 | 0 | 26 | 0 | 0.0 |
| item_header | 0 | 0 | 14 | 0 | 0.0 |
| item_merch_group | 0 | 0 | 0 | 0 | 0.0 |
| item_detail | 0 | 0 | 12 | 0 | 0.0 |
| item_detail | 0 | 0 | 0 | 0 | 0.0 |
| item_import_unresolved | 0 | 0 | 26504 | 26471 | 0.0 |
| hts_rag_rulings | 0 | 0 | 0 | 0 | 0.0 |


### coldlion.change_log indexes

| indexrelname | sz | idx_scan |
|---|---|---|
| change_log_pkey | 38 MB | 0 |
| coldlion_change_log_natural_key_idx | 15 MB | 0 |
| coldlion_change_log_run_idx | 7752 kB | 4 |
| coldlion_change_log_table_changed_idx | 7600 kB | 28 |


### plm.item_import_unresolved current rows

| n_rows |
|---|
| 26504 |


### Existing pg_cron jobs

| jobid | jobname | schedule | active |
|---|---|---|---|
| 2 | purge-render-queue-old-rows | 0 3 * * * | true |
| 3 | purge-sg-render-queue-old-rows | 15 3 * * * | true |
| 4 | purge-asset-path-history-old-rows | 30 3 * * * | true |
| 5 | nightly-sg-crawl | 0 2 * * * | true |
| 9 | refresh-style-guide-matviews | 7 * * * * | true |
| 10 | refresh-sku-human-description | 30 4 * * * | true |
| 11 | nightly-rebuild-style-groups | */10 * * * * | true |
| 12 | refresh-style-guide-library-default-snapshot | */15 * * * * | true |
| 13 | prewarm-style-guide-search | */5 * * * * | true |
| 14 | purge-image-embed-jobs | 17 3 * * * | true |
| 16 | nightly-style-tracker-item-autoflow | 50 5 * * * | true |
| 17 | resolve-sku-style-guide-links-nightly | 30 4 * * * | true |
