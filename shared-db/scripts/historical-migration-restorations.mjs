#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const HISTORICAL_RESTORATIONS = Object.freeze({
  // #2988. Preview applied these exact bytes in run 35060692115, dispatched at
  // pre-merge main 3fdd16ef and applied from PR #3007 head bac58c5f before the
  // pull request merged. The production apply was refused because the merge
  // commit 86da2d44 carries a new preview-producer sidecar
  // (scripts/production-verification-sidecars/20260916033914.json) that the
  // dispatch commit could not have had, so the immutable original apply must be
  // rebound through this registry rather than replayed. Producer provenance is
  // complete because this exact version merged from PR #3007 as 86da2d44.
  '20260916033914': Object.freeze({
    filename: 'supabase/migrations/20260916033914_dam_order_list_role_free_party_names.sql',
    name: 'dam_order_list_role_free_party_names',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '35060692115',
    previewDispatchCommit: '3fdd16effbd154e1602c29aa5610161910138d68',
    previewAppliedCommit: 'bac58c5f49687c7911d013e1f392fcf5c356e626',
    sourcePr: 3007,
    sourceMergeCommit: '86da2d44bcd390b3177f322f947b212c8dc9bbc9',
    statementBytes: 13874,
    statementSha256: '568e72b43a86a70cc1001a52331615b8b7d13b5310567d2f29657e77bcc93723',
    fileSha256: 'e8fbe0874fcb5289f1d60ec5a5c75c541fd234a3015458bb9d9ff26790ad65d0',
    objects: Object.freeze([
      'view dam.dam_order_list_customer_directory',
      'view dam.dam_order_list_vendor_directory',
      'view api.dam_order_list',
    ]),
  }),
  // #2863. Preview applied these exact bytes in claim-mode run 35047947727,
  // dispatched at main commit 0a11c42d and bound (instance-binding
  // appliedCommit) to PR #3008 commit 1595aec0 before the PR merged. The
  // production apply of this version was refused because the evidence-producing
  // scripts/manage-migration-author-lanes.mjs at the dispatch commit differs
  // from the one at merge commit 6c9b149d, so the immutable original apply must
  // be rebound through this registry rather than replayed. Producer provenance
  // is complete because this exact version merged from PR #3008 as 6c9b149d.
  '20260916001944': Object.freeze({
    filename: 'supabase/migrations/20260916001944_coldlion_prepack_and_prod_detail_landing.sql',
    name: 'coldlion_prepack_and_prod_detail_landing',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '35047947727',
    previewDispatchCommit: '0a11c42d3e373fe9b45e826a3015c93bb7cf4704',
    previewAppliedCommit: '1595aec05565b1a138b6f40e09bda8191fa40acf',
    sourcePr: 3008,
    sourceMergeCommit: '6c9b149d8747293cdb306a73262bd341873bc682',
    statementBytes: 13890,
    statementSha256: 'f54b6ffb87a38c11201fb61a80c6af61bead7399f41c410a629d02500cee1c91',
    fileSha256: 'c79374a85369589e3a5ed6e5f58b5ccf495e0ba1ad420f9e589b7bd1dba6aec9',
    objects: Object.freeze([
      'table coldlion.prepack_detail',
      'table coldlion.prod_detail',
    ]),
  }),
  // #2792. Preview applied these exact bytes in claim-mode run 34920902290,
  // dispatched at and applied from unmerged PR #2930 head a119760e (claim
  // #2929). The PR was then closed unmerged after a derived-from header changed
  // the bytes, so the version is RETIRED (production_migration_guard
  // HARD_BLOCKED / RETIRED_VERSION_REASONS) and reissued as 20260915023506
  // under claim #2931. This pin exists only so the historical file can live on
  // main (preview holds the version) without being mistaken for an edit.
  // Production producer provenance is deliberately NOT registered: no
  // `sourcePr`/`sourceMergeCommit`, so it can never be promoted.
  '20260915015414': Object.freeze({
    filename: 'supabase/migrations/20260915015414_popsg_reconcile_bounded_under_statement_ceiling.sql',
    name: 'popsg_reconcile_bounded_under_statement_ceiling',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '34920902290',
    previewDispatchCommit: 'a119760ec139c2d738c23b39c20d94fada2313ae',
    previewAppliedCommit: 'a119760ec139c2d738c23b39c20d94fada2313ae',
    statementBytes: 15745,
    statementSha256: 'c60313fac7fa4d5bffdbd6bc2c681d491ca49bf71e8f898f9a7e22ca698e34f5',
    fileSha256: '1ab60ae6cde98e4d2127cc3615cc76bfb1480b4f537b85d2d6a73959dcd50e02',
    objects: Object.freeze([
      'function public.preview_stale_sg_files',
      'function public.reconcile_stale_sg_files_batch',
    ]),
  }),
  // #2792. Preview applied these exact bytes in claim-mode run 34922309051,
  // dispatched at ffa300c7 and bound (instance-binding appliedCommit) to PR
  // #2933 commit 0c7ebecf before the PR merged. The migration blob 3f1f8874 is
  // unchanged on main. Producer provenance is complete because this exact
  // version merged from PR #2933 as ae295b65.
  '20260915023506': Object.freeze({
    filename: 'supabase/migrations/20260915023506_popsg_reconcile_bounded_under_statement_ceiling.sql',
    name: 'popsg_reconcile_bounded_under_statement_ceiling',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '34922309051',
    previewDispatchCommit: 'ffa300c7918b30a54bb033267596c6a70e66c438',
    previewAppliedCommit: '0c7ebecf1d8ffb5e0980a279d7e32b9d14a343f4',
    sourcePr: 2933,
    sourceMergeCommit: 'ae295b6541e4429b8ac61d8b04a5ae7c22a836b4',
    statementBytes: 15780,
    statementSha256: 'ded20c542b4d7498f4925fe8e169aa3846f21a5b8fe0f16f84e958d08c00083b',
    fileSha256: '6e2c22ecb99464d2584cfc2823b053a300cc59044f3354a634ece0eb40c9d27d',
    objects: Object.freeze([
      'function public.preview_stale_sg_files',
      'function public.reconcile_stale_sg_files_batch',
    ]),
  }),
  // #2879 / #2885 / #2889. Preview applied these exact successor bytes in
  // post-merge rehearsal run 34827941186 at PR #2886 head ce7eff73. The later
  // workflow-only repair #2887 changed the evidence-producing workflow, so the
  // immutable original apply must be rebound through the historical no-write
  // path rather than replayed. Producer provenance is complete because this
  // exact version merged from PR #2886 as c0a36970.
  '20260914075758': Object.freeze({
    filename: 'supabase/migrations/20260914075758_reissue_dcp_inventory_families.sql',
    name: 'reissue_dcp_inventory_families',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '34827941186',
    previewDispatchCommit: 'ce7eff73a2f68ba9309b2b2da4a411f8fef042ae',
    previewAppliedCommit: 'ce7eff73a2f68ba9309b2b2da4a411f8fef042ae',
    sourcePr: 2886,
    sourceMergeCommit: 'c0a369705480a29e64ae6ff22d162022c09e7a7e',
    statementBytes: 38131,
    statementSha256: '00872d31763e3ec3a01ace3fe7dca02bb0cfb07f4b60767e8ddedcb0d010cda5',
    fileSha256: '51dd41075554c1af6896d7e9b1a532313f1bb1aa97e2692dd02afabb8f741f2b',
    objects: Object.freeze([
      'function api.source_capture_inventory_exact',
      'view api.source_capture_inventory',
    ]),
  }),
  // #2797 / #2817. Preview applied these exact bytes in claim-mode run
  // 34655606553, dispatched at and applied from PR #2808 commit
  // 916b8005f4588ece389f1f137faf651bd78ef0a2 before the PR merged, because that
  // lane dispatched the preview apply ahead of the merge. The migration blob is
  // unchanged on the PR head. This pin exists only so the applied-migration-edit
  // guard can tell "the exact applied bytes" from "an edit to an applied
  // version". Production producer provenance is deliberately NOT registered:
  // `sourcePr`/`sourceMergeCommit` are omitted, so
  // `validateHistoricalProductionProvenance` refuses this version until a later
  // change registers the real merge commit. No production eligibility is granted
  // or changed here.
  '20260911221304': Object.freeze({
    filename: 'supabase/migrations/20260911221304_db_data_admin_scraped_source_inventory.sql',
    name: 'db_data_admin_scraped_source_inventory',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '34655606553',
    previewDispatchCommit: '916b8005f4588ece389f1f137faf651bd78ef0a2',
    previewAppliedCommit: '916b8005f4588ece389f1f137faf651bd78ef0a2',
    statementBytes: 55149,
    statementSha256: 'a9171a6023e724b677655db8d89e572f4394ad8c1b4db41d37a52438b492d20e',
    fileSha256: 'ecc847f602358edb27829cc49faba86b58e3788b6cf98c702eaccf8b8527904d',
    objects: Object.freeze(['function api.db_data_admin_scraped_source_inventory']),
  }),
  // #2744 / #2798. Preview applied these exact bytes in claim-mode run
  // 34636342626, dispatched at and applied from PR #2793 head commit
  // 1eae69db6ed5c938a109fde0c9040849ec30bffe before the PR merged. The migration
  // blob 15317e82ef011de07d076224cd20638e52e6622c is unchanged on the PR head.
  // This pin exists only so the applied-migration-edit guard can tell "the exact
  // applied bytes" from "an edit to an applied version". Production producer
  // provenance is deliberately NOT registered: `sourcePr`/`sourceMergeCommit` are
  // omitted, so `validateHistoricalProductionProvenance` refuses this version until
  // a later change registers the real merge commit. No production eligibility is
  // granted or changed here.
  '20260911170526': Object.freeze({
    filename: 'supabase/migrations/20260911170526_scraped_properties_page_asset_context.sql',
    name: 'scraped_properties_page_asset_context',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '34636342626',
    previewDispatchCommit: '1eae69db6ed5c938a109fde0c9040849ec30bffe',
    previewAppliedCommit: '1eae69db6ed5c938a109fde0c9040849ec30bffe',
    statementBytes: 58609,
    statementSha256: '455cd87dd1076eb33ece81361609f772154d1f651d5a95f993d077c294373dd3',
    fileSha256: 'e14fe1cd1670d4ea277c1e76bbeb8cae864765dff2f293b3ac0a95bd7042219f',
    objects: Object.freeze(['function api.db_data_admin_scraped_properties']),
  }),
  // #2535 / #2768. Preview applied these exact bytes in claim-mode run
  // 34281856111, dispatched at and applied from PR #2584 head commit
  // 69226335c20fef57f8a7c15cd7b014a157b61484 before the PR merged as
  // d669c43eda033919091c532605ee1cf1f2e786e4. The migration blob on main is
  // identical to the applied blob. This pin binds only that immutable apply and
  // those exact bytes; it does not mark the migration preview-only or otherwise
  // change its production eligibility.
  '20260908202651': Object.freeze({
    filename: 'supabase/migrations/20260908202651_hts_rag_dual_model_debate_audit.sql',
    name: 'hts_rag_dual_model_debate_audit',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '34281856111',
    previewDispatchCommit: '69226335c20fef57f8a7c15cd7b014a157b61484',
    previewAppliedCommit: '69226335c20fef57f8a7c15cd7b014a157b61484',
    sourcePr: 2584,
    sourceMergeCommit: 'd669c43eda033919091c532605ee1cf1f2e786e4',
    statementBytes: 12526,
    statementSha256: '409eec6e8dbd7ebe6499351bcb504f23130ffc4a089b983d3bb27e1619cf8441',
    fileSha256: '0f0bd894725486ba6fb80990c09e00e8048e3e433242746e79e4883d4a14b74a',
    objects: Object.freeze([
      'table public.hts_rag_debate_runs',
      'column public.hts_rag_precedents.promotion_basis',
      'column public.hts_rag_precedents.promotion_policy_version',
      'column public.hts_rag_precedents.promotion_source_determination_id',
      'column public.hts_rag_precedents.promotion_debate_run_id',
      'column public.hts_rag_precedents.promotion_gate_result',
      'function public.enforce_hts_rag_precedent_promotion_gate_immutable',
      'trigger hts_rag_precedents_promotion_gate_immutable on public.hts_rag_precedents',
      'trigger set_updated_at on public.hts_rag_debate_runs',
      'index public.hts_rag_debate_runs_claim_idx',
      'index public.hts_rag_debate_runs_source_determination_idx',
      'index public.hts_rag_debate_runs_precedent_idx',
      'policy hts_rag_debate_runs_backend_read on public.hts_rag_debate_runs',
      'policy hts_rag_debate_runs_backend_insert on public.hts_rag_debate_runs',
      'policy hts_rag_debate_runs_backend_update on public.hts_rag_debate_runs',
    ]),
  }),
  // #2622. The protected version and exact migration bytes were authored on
  // PR #2651 before 20260909202801 reached main. This entry permits only those
  // exact bytes to survive the backdated-version guard; it does not mark the
  // migration preview-only or otherwise change its production eligibility.
  '20260909194231': Object.freeze({
    filename: 'supabase/migrations/20260909194231_coldlion_merch_group_detail_category_identity.sql',
    name: 'coldlion_merch_group_detail_category_identity',
    statementBytes: 2575,
    statementSha256: '5840ad59c1328329f523487d2431dc8ac6f40eeb55706b06070ad5ac70b25245',
    fileSha256: '4db5068dab42833921153aad59d97ed9201ed093047296ec5cc58601004cc39d',
    objects: Object.freeze([
      'table coldlion.merch_group_detail',
    ]),
  }),
  // #2543. The protected version and exact migration bytes were authored on
  // PR #2631 before 20260909121403 reached main. This entry permits only those
  // exact bytes to survive the backdated-version guard; it does not mark the
  // migration preview-only or otherwise change its production eligibility.
  '20260909115140': Object.freeze({
    filename: 'supabase/migrations/20260909115140_opa_coherent_complete_capture.sql',
    name: 'opa_coherent_complete_capture',
    statementBytes: 61299,
    statementSha256: '8e054097c5f73d050aacd6ef315b97c709e53f46618b034816c4536b6a28effc',
    fileSha256: '8720f0a1fe9a6dbcfc3d40ca6ad5906e08424ea69d84df1284eb75ed544041bc',
    objects: Object.freeze([
      'table plm.opa_capture',
      'table plm.opa_capture_scope',
      'table plm.opa_property_character_capture',
      'function plm.begin_opa_capture',
      'function plm.load_opa_capture_chunk',
      'function plm.finalize_opa_capture',
      'function api.source_capture_inventory_exact',
      'table api.source_capture_inventory',
      'view api.source_capture_inventory',
    ]),
  }),
  // #2580. The protected version and exact migration bytes were authored on
  // PR #2627 before 20260909121403 reached main. This entry permits only those
  // exact bytes to survive the backdated-version guard; it does not mark the
  // migration preview-only or otherwise change its production eligibility.
  '20260909084253': Object.freeze({
    filename: 'supabase/migrations/20260909084253_sample_shipment_notice_outbox.sql',
    name: 'sample_shipment_notice_outbox',
    statementBytes: 6537,
    statementSha256: '1dd8adc722def760f9d3dde9abfff9cf53e3929fab97e49954b8512d91c1f33b',
    fileSha256: '70beba94d21b05384438a298fa3d49bd0a1bbdb31cbf4cb0216bec8aa380e76f',
    objects: Object.freeze([
      'table dflow.sample_shipment_notice',
      'table dflow.sample_shipment_notice_recipient',
      'function dflow.prevent_sample_shipment_notice_snapshot_mutation',
      'function dflow.prevent_sample_shipment_notice_recipient_snapshot_mutation',
      'trigger sample_shipment_notice_snapshot_immutable on dflow.sample_shipment_notice',
      'trigger sample_shipment_notice_recipient_snapshot_immutable on dflow.sample_shipment_notice_recipient',
      'function dflow.claim_sample_shipment_notice',
    ]),
  }),
  // #2506. Preview applied these exact bytes in run 34290415305, dispatched at and
  // applied from PR #2542 head commit 281b967986b7cca99b13722f4d9ed3c988902c9d --
  // the same commit this branch still carries, so the file IS the applied body.
  // The version was reserved by claim #2510 and is therefore not a version mismatch;
  // this pin exists only so the applied-migration-edit guard can tell "the exact
  // applied bytes" from "an edit to an applied version". Production producer
  // provenance is deliberately NOT registered: `sourcePr`/`sourceMergeCommit` are
  // omitted, so `validateHistoricalProductionProvenance` refuses this version until
  // a later change registers the real merge commit. No production eligibility is
  // granted or changed here.
  '20260908214749': Object.freeze({
    filename: 'supabase/migrations/20260908214749_popsg_search_v2_bounded_paging.sql',
    name: 'popsg_search_v2_bounded_paging',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '34290415305',
    previewDispatchCommit: '281b967986b7cca99b13722f4d9ed3c988902c9d',
    previewAppliedCommit: '281b967986b7cca99b13722f4d9ed3c988902c9d',
    statementBytes: 25052,
    statementSha256: 'fe5982e1dd711ef7e136727323cb125d6b095ab83de9edd5eaa3ad28258fb780',
    fileSha256: 'e79a608eedbfc31dab4c70acb2ad2709f3f4d56ee8d2bb7c3e6d43a96632968f',
    objects: Object.freeze(['function public.search_style_guide_library_v2']),
  }),
  // #2356. The protected version and exact migration bytes were authored on
  // PR #2523 before 20260907200221 reached main. This entry permits only those
  // exact bytes to survive the backdated-version guard; it does not mark the
  // migration preview-only or otherwise change its production eligibility.
  '20260907152838': Object.freeze({
    filename: 'supabase/migrations/20260907152838_dam_asset_freshness_current_state.sql',
    name: 'dam_asset_freshness_current_state',
    statementBytes: 3747,
    statementSha256: '8f9179afb6f2e01cd6684b591dae5e996381036b733a964450aa464128edab05',
    fileSha256: '6c04610f8e63d7d67b5c74610a69e219f912fa1b7fb520d7839ab8a81d77e022',
    objects: Object.freeze([
      'column dam.asset.first_seen_at',
      'column dam.asset.last_seen_at',
      'column dam.asset.missing_since',
      'constraint dam_asset_seen_order on dam.asset',
      'constraint dam_asset_missing_after_first_seen on dam.asset',
      'function dam.enforce_asset_freshness',
      'table dam.asset',
      'trigger dam_asset_freshness_guard on dam.asset',
    ]),
  }),
  // #2509. Preview applied these exact bytes in run 34157812748 from PR #2513
  // commit bcc2603977678db73b4ca12d3ed1312a1bff64e2. Migration 20260907200221
  // then reached main first, so the unchanged source-restoration sorts behind
  // main. This pin authorizes only the exact applied file; it does not make the
  // version preview-only or otherwise change its production eligibility.
  '20260907131728': Object.freeze({
    filename: 'supabase/migrations/20260907131728_popsg_preview_stats_indexed_categories.sql',
    name: 'popsg_preview_stats_indexed_categories',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '34157812748',
    previewDispatchCommit: '4f093e3d4c97e4272d147d38e7243ec57d3c08f1',
    previewAppliedCommit: 'bcc2603977678db73b4ca12d3ed1312a1bff64e2',
    sourcePr: 2513,
    sourceMergeCommit: 'c5f85ad3a98b7a5598e8c81a56735473d5bb5487',
    statementBytes: 9125,
    statementSha256: 'd273d46aa662d3ae24502da44e3226e9c5932c7646b8d5d430b76563fa9d2191',
    fileSha256: '03648ecbbee473f539c27f929a248c503c18d5fb906efe1409d11593cfdb5d7e',
    objects: Object.freeze([
      'function public.get_sg_preview_stats',
      'index public.idx_sgf_active_preview_category',
      'table public.style_guide_files',
    ]),
  }),
  // #2035. Preview applied this version in run 33454217961 from PR #2009 commit
  // bb77fdd49fe032c985dc93c907f5d4d93a2456a1, then the PR head moved twice to fix two
  // High review findings and the corrected body merged as 30221c0b. Preview therefore
  // holds the seven hts_rag_* tables from the SUPERSEDED body, and the production
  // business-risk gate refuses a promotion whose rehearsal digest is not the file on
  // exact main. Preview cannot re-run `create table`, so the file is restored to the
  // bytes preview actually ran and the corrections are fixed forward in 20260901011306.
  '20260831234750': Object.freeze({
    filename: 'supabase/migrations/20260831234750_hts_rag_durable_precedent_contract.sql',
    name: 'hts_rag_durable_precedent_contract',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    previewApplyRun: '33454217961',
    previewAppliedCommit: 'bb77fdd49fe032c985dc93c907f5d4d93a2456a1',
    forwardFixVersion: '20260901011306',
    statementBytes: 12578,
    statementSha256: '646bc6be0bef4e5bcc09cc944a46ff8910d9cab72a6b19ce66f3df60e2e15af4',
    fileSha256: '2931391a44f512ec80fe468b00c3b92c277397418e5fda25fa98907dad6559cb',
    objects: Object.freeze([
      'table public.hts_rag_precedents',
      'table public.hts_rag_precedent_rulings',
      'table public.hts_rag_product_examples',
      'table public.hts_rag_determinations',
      'table public.hts_rag_extraction_jobs',
      'table public.hts_rag_review_events',
      'table public.hts_rag_product_family_allowlist',
    ]),
  }),
  '20260828052706': Object.freeze({
    filename: 'supabase/migrations/20260828052706_sync_dflow_columns_onto_plm_designflow_copies.sql',
    name: 'sync_dflow_columns_onto_plm_designflow_copies',
    productionProject: 'qsllyeztdwjgirsysgai',
    sourceVersion: '20260817150944',
    verificationRun: '33169143850',
    codeTruthOnly: true,
    statementCount: 1,
    statementBytes: 3213,
    statementSha256: '03f40fec5d4d72443b31ac5c7bdb028d4972eedf057479c596214efb1b189779',
    fileSha256: 'c8ab692586a94fef5dfdf18b32105ccb9f9469bb8336c40fab793c1c4404dace',
    objects: Object.freeze(['table plm.rfqitem','table plm.gridviewstate','table plm.itemdetail']),
  }),
  '20260824150630': Object.freeze({
    filename: 'supabase/migrations/20260824150630_sample_tracking_piece_split_and_transit_return.sql',
    name: 'sample_tracking_piece_split_and_transit_return',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    creatorSha256: '7f4d74d1ffa4d74b239be01bcfa4261610d2107a08f2e3d967feede858b5a96c',
    statementCount: 1,
    statementBytes: 15811,
    statementSha256: 'fa01a4f5cf7a944bfbba2faa0176a696beca64bb69e838869a8e085019a1ab77',
    fileSha256: '5e9829b2cab7f0462804acce18bccf0d65b9c88363e9e54290581513047f4a52',
    objects: Object.freeze([
      'function dflow.post_sample_piece_split',
      'function dflow.validate_sample_movement_shipment_identity',
      'table dflow.sample_movement',
      'view dflow.sample_global_status',
      'function dflow.sample_movement_guard',
    ]),
  }),
  '20260817150944': Object.freeze({
    filename: 'supabase/migrations/20260817150944_sync_dflow_columns_onto_plm_designflow_copies.sql',
    name: 'sync_dflow_columns_onto_plm_designflow_copies',
    previewProject: 'mvpkijzfmfcxhnzqogzs',
    creatorSha256: 'ede9ab5ebdcbbb7af5760ff9ce653aa402b0c53a41e2ee9bdf18121204e58b9a',
    statementCount: 1,
    statementBytes: 3213,
    statementSha256: '03f40fec5d4d72443b31ac5c7bdb028d4972eedf057479c596214efb1b189779',
    fileSha256: 'c8ab692586a94fef5dfdf18b32105ccb9f9469bb8336c40fab793c1c4404dace',
    objects: Object.freeze(['table plm.rfqitem','table plm.gridviewstate','table plm.itemdetail']),
  }),
})

export function validateHistoricalRestorationFile(filename, raw) {
  const version=path.basename(filename).slice(0,14), record=HISTORICAL_RESTORATIONS[version]
  if(!record||filename.replaceAll('\\','/')!==record.filename)throw new Error('file is not an approved exact historical restoration')
  const governedRaw=raw.replaceAll('\r\n','\n')
  const digest=createHash('sha256').update(governedRaw,'utf8').digest('hex')
  if(digest!==record.fileSha256)throw new Error(`historical restoration file hash mismatch for ${version}`)
  const statement=governedRaw.endsWith('\n')?governedRaw.slice(0,-1):governedRaw
  if(governedRaw!==`${statement}\n`||Buffer.byteLength(statement)!==record.statementBytes||createHash('sha256').update(statement,'utf8').digest('hex')!==record.statementSha256)throw new Error(`historical restoration statement bytes mismatch for ${version}`)
  return record
}

export function validateHistoricalProductionProvenance(filename, raw, evidence) {
  const record=validateHistoricalRestorationFile(filename,raw)
  const expected={
    version:path.basename(filename).slice(0,14),
    previewApplyRun:record.previewApplyRun,
    previewDispatchCommit:record.previewDispatchCommit,
    previewAppliedCommit:record.previewAppliedCommit,
    sourcePr:record.sourcePr,
    sourceMergeCommit:record.sourceMergeCommit,
    artifactFileSha256:record.fileSha256,
  }
  if(!record.sourcePr||!record.sourceMergeCommit)throw new Error('historical restoration is not registered for production producer provenance')
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||Object.keys(evidence).sort().join(',')!==Object.keys(expected).sort().join(','))throw new Error('historical production provenance evidence has an incomplete schema')
  for(const [key,value] of Object.entries(expected))if(evidence[key]!==value)throw new Error(`historical production provenance mismatch for ${key}`)
  return record
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  try {
    const filename=String(process.argv[3]??'')
    if(process.argv[2]==='--allows-backdated')validateHistoricalRestorationFile(filename,readFileSync(filename,'utf8'))
    else if(process.argv[2]==='--production-provenance'){
      const record=validateHistoricalProductionProvenance(filename,readFileSync(filename,'utf8'),JSON.parse(String(process.argv[4]??'')))
      process.stdout.write(JSON.stringify({version:path.basename(filename).slice(0,14),fileSha256:record.fileSha256})+'\n')
    } else throw new Error('unsupported command')
    process.exitCode=0
  } catch (error) {
    console.error(error.message)
    process.exitCode=2
  }
}
