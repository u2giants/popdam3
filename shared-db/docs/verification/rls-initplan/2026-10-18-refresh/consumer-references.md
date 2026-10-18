# Current local consumer source references

Read-only baseline evidence for #4426. October 18, 2026 EDT. No repair or live acceptance is claimed.

```json
{
  "commits": {
    "/home/ahazan/repos/popdam3": "852266e74634c06cad4156d079f76d39eb6f56f4",
    "/home/ahazan/repos/poppim": "3bb89e219bb5441469e5b59ffa928e7517782ad0",
    "/home/ahazan/repos/dflow_plm/designflow-backend": "7e39caab04904033f373de2bd7d2e4809bd85a56",
    "/home/ahazan/repos/dflow_plm/designflow-frontend": "404323eac409d970ac345a08ceccd617da91e6b8"
  },
  "table_references": {
    "admin_config": [
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 97,
        "repository": "popdam3",
        "source": "db.from(\"admin_config\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 135,
        "repository": "popdam3",
        "source": "const { error } = await db.from(\"admin_config\").upsert({"
      },
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 157,
        "repository": "popdam3",
        "source": "db.from(\"admin_config\").select(\"value\").eq(\"key\", \"STYLE_GUIDE_CRAWL_REQUEST\").maybeSingle(),"
      },
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 158,
        "repository": "popdam3",
        "source": "db.from(\"admin_config\").select(\"value\").eq(\"key\", \"SCAN_PROGRESS\").maybeSingle(),"
      },
      {
        "file": "supabase/functions/_shared/admin-auth.ts",
        "line": 99,
        "repository": "popdam3",
        "source": "const { error } = await verifier.from(\"admin_config\").select(\"key\").limit(1);"
      }
    ],
    "agent_pairings": [
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 67,
        "repository": "popdam3",
        "source": "const { error } = await db.from(\"agent_pairings\").insert({"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 50,
        "repository": "popdam3",
        "source": ".from(\"agent_pairings\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 59,
        "repository": "popdam3",
        "source": "await db.from(\"agent_pairings\").update({ status: \"expired\" }).eq(\"id\", pairing.id);"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 97,
        "repository": "popdam3",
        "source": ".from(\"agent_pairings\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 2135,
        "repository": "popdam3",
        "source": ".from(\"agent_pairings\")"
      }
    ],
    "agent_registrations": [
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 86,
        "repository": "popdam3",
        "source": "db.from(\"agent_registrations\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 31,
        "repository": "popdam3",
        "source": ".from(\"agent_registrations\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 81,
        "repository": "popdam3",
        "source": ".from(\"agent_registrations\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 108,
        "repository": "popdam3",
        "source": "await db.from(\"agent_registrations\").delete().eq(\"id\", agentData.id);"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 128,
        "repository": "popdam3",
        "source": ".from(\"agent_registrations\")"
      }
    ],
    "ai_tag_bakeoff_results": [
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 1140,
        "repository": "popdam3",
        "source": ".from(\"ai_tag_bakeoff_results\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 1155,
        "repository": "popdam3",
        "source": "db.from(\"ai_tag_bakeoff_results\").select(\"*\").eq(\"run_id\", runId),"
      },
      {
        "file": "apps/worker/src/handlers/ai-tag-bakeoff.ts",
        "line": 300,
        "repository": "popdam3",
        "source": ".from(\"ai_tag_bakeoff_results\")"
      },
      {
        "file": "apps/worker/src/handlers/ai-tag-bakeoff.ts",
        "line": 449,
        "repository": "popdam3",
        "source": ".from(\"ai_tag_bakeoff_results\")"
      }
    ],
    "ai_tag_bakeoff_reviews": [
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 1156,
        "repository": "popdam3",
        "source": "db.from(\"ai_tag_bakeoff_reviews\").select(\"*\").eq(\"run_id\", runId),"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 1186,
        "repository": "popdam3",
        "source": ".from(\"ai_tag_bakeoff_reviews\")"
      }
    ],
    "ai_tag_bakeoff_runs": [
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 1095,
        "repository": "popdam3",
        "source": ".from(\"ai_tag_bakeoff_runs\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 1118,
        "repository": "popdam3",
        "source": ".from(\"ai_tag_bakeoff_runs\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 1132,
        "repository": "popdam3",
        "source": ".from(\"ai_tag_bakeoff_runs\")"
      },
      {
        "file": "apps/worker/src/handlers/ai-tag-bakeoff.ts",
        "line": 470,
        "repository": "popdam3",
        "source": ".from(\"ai_tag_bakeoff_runs\")"
      },
      {
        "file": "apps/worker/src/handlers/ai-tag-bakeoff.ts",
        "line": 482,
        "repository": "popdam3",
        "source": "await client.from(\"ai_tag_bakeoff_runs\").update({ status: \"running\", updated_at: new Date().toISOString() }).eq(\"id\", runId);"
      }
    ],
    "app_access": [
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 528,
        "repository": "popdam3",
        "source": ".from(\"app_access\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 535,
        "repository": "popdam3",
        "source": "const { error: insErr } = await db.from(\"app_access\").insert(rows);"
      },
      {
        "file": "supabase/functions/verify-app-access/index.ts",
        "line": 76,
        "repository": "popdam3",
        "source": ".from(\"app_access\")"
      }
    ],
    "asset_characters": [
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 652,
        "repository": "popdam3",
        "source": ".from(\"asset_characters\")"
      },
      {
        "file": "supabase/functions/_shared/operation-constants.ts",
        "line": 99,
        "repository": "popdam3",
        "source": "//   20260405000000). However INSERT INTO asset_tags / asset_characters still"
      },
      {
        "file": "apps/worker/src/handlers/ai-tagging.ts",
        "line": 228,
        "repository": "popdam3",
        "source": "const savedCharacters = await client.from(\"asset_characters\").upsert(rows, { onConflict: \"asset_id,character_id\" });"
      },
      {
        "file": "apps/worker/src/handlers/ai-tagging.ts",
        "line": 602,
        "repository": "popdam3",
        "source": "await client.from(\"asset_characters\").upsert(charLinks, { onConflict: \"asset_id,character_id\" });"
      }
    ],
    "asset_checkouts": [
      {
        "file": "src/hooks/useAssetCheckout.ts",
        "line": 17,
        "repository": "popdam3",
        "source": ".from(\"asset_checkouts\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 4170,
        "repository": "popdam3",
        "source": ".from(\"asset_checkouts\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 4228,
        "repository": "popdam3",
        "source": ".from(\"asset_checkouts\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 4272,
        "repository": "popdam3",
        "source": "await db.from(\"asset_checkouts\").update({"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 4316,
        "repository": "popdam3",
        "source": "await db.from(\"asset_checkouts\").update({"
      }
    ],
    "asset_tags": [
      {
        "file": "apps/worker/src/operation-loop.ts",
        "line": 101,
        "repository": "popdam3",
        "source": "// Root cause: speculative-insert index locks on asset_tags B-tree index when both ai-tag and"
      },
      {
        "file": "supabase/functions/_shared/operation-constants.ts",
        "line": 99,
        "repository": "popdam3",
        "source": "//   20260405000000). However INSERT INTO asset_tags / asset_characters still"
      }
    ],
    "assets": [
      {
        "file": "supabase/functions/_shared/style-group-assignment.ts",
        "line": 12,
        "repository": "popdam3",
        "source": "from(table: \"style_groups\" | \"assets\"): Query;"
      },
      {
        "file": "supabase/functions/_shared/style-group-assignment.ts",
        "line": 106,
        "repository": "popdam3",
        "source": "const assignment = await db.from(\"assets\")"
      },
      {
        "file": "supabase/functions/_shared/style-grouping.ts",
        "line": 51,
        "repository": "popdam3",
        "source": "* Select the primary asset from a list of assets in the same group."
      },
      {
        "file": "src/hooks/useStyleGroups.ts",
        "line": 398,
        "repository": "popdam3",
        "source": ".from(\"assets\")"
      },
      {
        "file": "src/hooks/useStyleGroups.ts",
        "line": 414,
        "repository": "popdam3",
        "source": ".from(\"assets\")"
      }
    ],
    "characters": [
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 664,
        "repository": "popdam3",
        "source": "await db.from(\"characters\").update({"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 674,
        "repository": "popdam3",
        "source": "await db.from(\"characters\").update({"
      },
      {
        "file": "src/components/settings/ApisTab.tsx",
        "line": 1059,
        "repository": "popdam3",
        "source": "supabase.from(\"characters\").select(\"*\", { count: \"exact\", head: true }),"
      },
      {
        "file": "src/components/settings/ApisTab.tsx",
        "line": 1060,
        "repository": "popdam3",
        "source": "supabase.from(\"characters\").select(\"*\", { count: \"exact\", head: true }).eq(\"is_priority\", true),"
      },
      {
        "file": "apps/worker/src/handlers/popsg-tags.ts",
        "line": 513,
        "repository": "popdam3",
        "source": "client.from(\"characters\").select(\"name\"),"
      }
    ],
    "erp_enrichment_log": [
      {
        "file": "src/components/settings/ErpEnrichmentTab.tsx",
        "line": 328,
        "repository": "popdam3",
        "source": ".from(\"erp_enrichment_log\")"
      },
      {
        "file": "apps/worker/src/handlers/erp.ts",
        "line": 215,
        "repository": "popdam3",
        "source": "const { error: logErr } = await client.from(\"erp_enrichment_log\").insert(logEntries);"
      }
    ],
    "erp_items_current": [],
    "erp_items_raw": [],
    "erp_sync_runs": [],
    "helper_devices": [
      {
        "file": "supabase/functions/helper-api/index.ts",
        "line": 102,
        "repository": "popdam3",
        "source": ".from(\"helper_devices\")"
      },
      {
        "file": "supabase/functions/helper-api/index.ts",
        "line": 117,
        "repository": "popdam3",
        "source": ".from(\"helper_devices\")"
      },
      {
        "file": "supabase/functions/helper-api/index.ts",
        "line": 640,
        "repository": "popdam3",
        "source": ".from(\"helper_devices\")"
      }
    ],
    "helper_tokens": [
      {
        "file": "supabase/functions/helper-api/index.ts",
        "line": 224,
        "repository": "popdam3",
        "source": "const { error } = await db.from(\"helper_tokens\").insert({"
      },
      {
        "file": "supabase/functions/helper-api/index.ts",
        "line": 255,
        "repository": "popdam3",
        "source": ".from(\"helper_tokens\")"
      },
      {
        "file": "supabase/functions/helper-api/index.ts",
        "line": 294,
        "repository": "popdam3",
        "source": ".from(\"helper_tokens\")"
      },
      {
        "file": "supabase/functions/helper-api/index.ts",
        "line": 322,
        "repository": "popdam3",
        "source": ".from(\"helper_tokens\")"
      }
    ],
    "hygiene_findings": [
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 2754,
        "repository": "popdam3",
        "source": "const { error } = await db.from(\"hygiene_findings\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/hygiene-handlers.ts",
        "line": 16,
        "repository": "popdam3",
        "source": "let query = db.from(\"hygiene_findings\").select(\"*\").order(\"found_at\", { ascending: false }).limit(limit);"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/hygiene-handlers.ts",
        "line": 26,
        "repository": "popdam3",
        "source": "db.from(\"hygiene_findings\").select(\"id\", { count: \"exact\", head: true }).eq(\"status\", \"open\"),"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/hygiene-handlers.ts",
        "line": 27,
        "repository": "popdam3",
        "source": "db.from(\"hygiene_findings\").select(\"id\", { count: \"exact\", head: true }).eq(\"status\", \"dismissed\"),"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/hygiene-handlers.ts",
        "line": 28,
        "repository": "popdam3",
        "source": "db.from(\"hygiene_findings\").select(\"id\", { count: \"exact\", head: true }).eq(\"status\", \"resolved\"),"
      }
    ],
    "invitations": [
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 387,
        "repository": "popdam3",
        "source": ".from(\"invitations\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 400,
        "repository": "popdam3",
        "source": ".from(\"invitations\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 421,
        "repository": "popdam3",
        "source": "await db.from(\"invitations\").delete().eq(\"id\", data.id);"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 433,
        "repository": "popdam3",
        "source": ".from(\"invitations\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 448,
        "repository": "popdam3",
        "source": ".from(\"invitations\")"
      }
    ],
    "legacy_erp_item_identity": [],
    "licensors": [
      {
        "file": "supabase/functions/export-sql-dump/index.ts",
        "line": 61,
        "repository": "popdam3",
        "source": "if (table === \"licensors\") return db.schema(\"core\").from(\"licensor\");"
      },
      {
        "file": "supabase/functions/export-table/index.ts",
        "line": 43,
        "repository": "popdam3",
        "source": "if (table === \"licensors\") return db.schema(\"core\").from(\"licensor\");"
      }
    ],
    "order_list_user_views": [
      {
        "file": "src/hooks/useOrderList.ts",
        "line": 303,
        "repository": "popdam3",
        "source": ".from(\"order_list_user_views\")"
      },
      {
        "file": "src/pages/OrdersPage.tsx",
        "line": 245,
        "repository": "popdam3",
        "source": ".from(\"order_list_user_views\")"
      },
      {
        "file": "src/pages/OrdersPage.tsx",
        "line": 269,
        "repository": "popdam3",
        "source": "const { error } = await (supabase as any).from(\"order_list_user_views\").delete().eq(\"id\", view.id);"
      }
    ],
    "packaging_type": [
      {
        "file": "src/components/settings/PackagingTypesTab.tsx",
        "line": 60,
        "repository": "popdam3",
        "source": "return (supabase as unknown as CoreSupabaseClient).schema(\"core\").from(\"packaging_type\");"
      },
      {
        "file": "src/pages/StylesPage.tsx",
        "line": 733,
        "repository": "popdam3",
        "source": ".from(\"packaging_type\")"
      }
    ],
    "pdf_text_samples": [
      {
        "file": "scripts/popsg-readiness-baseline.mjs",
        "line": 67,
        "repository": "popdam3",
        "source": "client.from(\"pdf_text_samples\").select(\"char_count\", { count: \"exact\" }),"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 1465,
        "repository": "popdam3",
        "source": ".from(\"pdf_text_samples\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 2005,
        "repository": "popdam3",
        "source": "const { error } = await db.from(\"pdf_text_samples\").delete().in(\"asset_id\", assetIds);"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 2021,
        "repository": "popdam3",
        "source": "await db.from(\"pdf_text_samples\").delete().in(\"asset_id\", assetIds);"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 3510,
        "repository": "popdam3",
        "source": "// 1. Insert into pdf_text_samples (skip assets already there)"
      }
    ],
    "processing_queue": [
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 1721,
        "repository": "popdam3",
        "source": ".from(\"processing_queue\")"
      },
      {
        "file": "src/components/settings/diagnostics/ErrorHistoryPanel.tsx",
        "line": 33,
        "repository": "popdam3",
        "source": ".from(\"processing_queue\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/agent-handlers.ts",
        "line": 504,
        "repository": "popdam3",
        "source": ".from(\"processing_queue\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/agent-handlers.ts",
        "line": 519,
        "repository": "popdam3",
        "source": ".from(\"processing_queue\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/agent-handlers.ts",
        "line": 1175,
        "repository": "popdam3",
        "source": "db.from(\"processing_queue\").select(\"id\", { count: \"exact\", head: true }).eq(\"status\", \"pending\"),"
      }
    ],
    "prod_order_headers_current": [
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 327,
        "repository": "popdam3",
        "source": "db.from(\"prod_order_headers_current\").select(\"*\", { count: \"exact\", head: true }),"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 340,
        "repository": "popdam3",
        "source": "const { data } = await db.from(\"prod_order_headers_current\").select(\"style_number\").limit(10000);"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 437,
        "repository": "popdam3",
        "source": "const { data: upserted, error: upsertErr } = await db.from(\"prod_order_headers_current\")"
      },
      {
        "file": "src/components/library/StyleGroupDetailPanel.tsx",
        "line": 580,
        "repository": "popdam3",
        "source": ".from(\"prod_order_headers_current\")"
      }
    ],
    "prod_order_headers_raw": [
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 430,
        "repository": "popdam3",
        "source": "const { error: rawErr } = await db.from(\"prod_order_headers_raw\").insert(deduped.map((row) => ({"
      }
    ],
    "prod_order_sync_runs": [
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 312,
        "repository": "popdam3",
        "source": "const { data, error } = await db.from(\"prod_order_sync_runs\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 350,
        "repository": "popdam3",
        "source": "const { data: runningRuns } = await db.from(\"prod_order_sync_runs\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 374,
        "repository": "popdam3",
        "source": "const { data: run, error: runErr } = await db.from(\"prod_order_sync_runs\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 456,
        "repository": "popdam3",
        "source": "await db.from(\"prod_order_sync_runs\").update({"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/prod-order-handlers.ts",
        "line": 475,
        "repository": "popdam3",
        "source": "await db.from(\"prod_order_sync_runs\").update({"
      }
    ],
    "product_categories": [],
    "product_category_predictions": [
      {
        "file": "src/components/settings/ErpEnrichmentTab.tsx",
        "line": 215,
        "repository": "popdam3",
        "source": ".from(\"product_category_predictions\")"
      },
      {
        "file": "apps/worker/src/handlers/erp.ts",
        "line": 115,
        "repository": "popdam3",
        "source": ".from(\"product_category_predictions\")"
      },
      {
        "file": "apps/worker/src/handlers/erp.ts",
        "line": 326,
        "repository": "popdam3",
        "source": "? client.from(\"product_category_predictions\").select(\"plm_item_id,status\").in(\"plm_item_id\", predictionItemIds)"
      },
      {
        "file": "apps/worker/src/handlers/erp.ts",
        "line": 363,
        "repository": "popdam3",
        "source": "const { error: insertError } = await client.from(\"product_category_predictions\").insert({"
      },
      {
        "file": "apps/worker/src/handlers/erp.ts",
        "line": 436,
        "repository": "popdam3",
        "source": "const { error: insertError } = await client.from(\"product_category_predictions\").insert({"
      }
    ],
    "product_subtypes": [],
    "product_types": [],
    "profiles": [
      {
        "file": "src/hooks/useAssetCheckout.ts",
        "line": 27,
        "repository": "popdam3",
        "source": ".from(\"profiles\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 472,
        "repository": "popdam3",
        "source": ".from(\"profiles\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 491,
        "repository": "popdam3",
        "source": ".from(\"profiles\")"
      }
    ],
    "properties": [
      {
        "file": "supabase/functions/export-sql-dump/index.ts",
        "line": 62,
        "repository": "popdam3",
        "source": "if (table === \"properties\") return db.schema(\"core\").from(\"property\");"
      },
      {
        "file": "supabase/functions/export-table/index.ts",
        "line": 44,
        "repository": "popdam3",
        "source": "if (table === \"properties\") return db.schema(\"core\").from(\"property\");"
      },
      {
        "file": "src/pages/popsg/PopSGLibraryPage.tsx",
        "line": 754,
        "repository": "popdam3",
        "source": ".map(([l, props]) => ({ licensor: l, properties: Array.from(props).sort() }))"
      }
    ],
    "render_queue": [
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 345,
        "repository": "popdam3",
        "source": "await db.from(\"render_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 360,
        "repository": "popdam3",
        "source": "db.from(\"render_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 1519,
        "repository": "popdam3",
        "source": ".from(\"render_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 1530,
        "repository": "popdam3",
        "source": ".from(\"render_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 1600,
        "repository": "popdam3",
        "source": ".from(\"render_queue\")"
      }
    ],
    "style_group_tags": [
      {
        "file": "apps/worker/src/handlers/group-metadata-refresh.ts",
        "line": 105,
        "repository": "popdam3",
        "source": ".from(\"style_group_tags\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/tag-propagation-handlers.ts",
        "line": 55,
        "repository": "popdam3",
        "source": ".from(\"style_group_tags\")"
      }
    ],
    "style_groups": [
      {
        "file": "supabase/functions/_shared/style-group-assignment.ts",
        "line": 12,
        "repository": "popdam3",
        "source": "from(table: \"style_groups\" | \"assets\"): Query;"
      },
      {
        "file": "supabase/functions/_shared/style-group-assignment.ts",
        "line": 65,
        "repository": "popdam3",
        "source": "const selected = await db.from(\"style_groups\")"
      },
      {
        "file": "supabase/functions/_shared/style-group-assignment.ts",
        "line": 78,
        "repository": "popdam3",
        "source": "const inserted = await db.from(\"style_groups\")"
      },
      {
        "file": "supabase/functions/_shared/style-group-assignment.ts",
        "line": 87,
        "repository": "popdam3",
        "source": "const concurrent = await db.from(\"style_groups\").select(\"id\").eq(\"sku\", sku).single();"
      },
      {
        "file": "supabase/functions/_shared/style-group-assignment.ts",
        "line": 96,
        "repository": "popdam3",
        "source": "const updated = await db.from(\"style_groups\").update(changed).eq(\"id\", group.id).select(\"id\").single();"
      }
    ],
    "style_guide_crawl_runs": [
      {
        "file": "scripts/popsg-readiness-baseline.mjs",
        "line": 63,
        "repository": "popdam3",
        "source": "const { data: crawls, error: crawlError } = await client.from(\"style_guide_crawl_runs\").select(\"*\").order(\"started_at\", { ascending: false }).limit(30);"
      },
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 89,
        "repository": "popdam3",
        "source": "db.from(\"style_guide_crawl_runs\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 159,
        "repository": "popdam3",
        "source": "db.from(\"style_guide_crawl_runs\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 313,
        "repository": "popdam3",
        "source": ".from(\"style_guide_crawl_runs\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 402,
        "repository": "popdam3",
        "source": "await db.from(\"style_guide_crawl_runs\").update({"
      }
    ],
    "style_guide_file_tags": [],
    "style_guide_files": [
      {
        "file": "scripts/popsg-readiness-baseline.mjs",
        "line": 57,
        "repository": "popdam3",
        "source": "const { data, error } = await client.from(\"style_guide_files\").select(\"id,root_label,relative_path,crawl_run_id,file_extension,licensor_name,property_folder,thumbnail_url,thumbnail_error,tag_search_text\").eq(\"is_active\","
      },
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 94,
        "repository": "popdam3",
        "source": "db.from(\"style_guide_files\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 390,
        "repository": "popdam3",
        "source": ".from(\"style_guide_files\")"
      },
      {
        "file": "supabase-popsg/supabase/functions/agent-api/index.ts",
        "line": 432,
        "repository": "popdam3",
        "source": ".from(\"style_guide_files\")"
      },
      {
        "file": "supabase/functions/admin-api/index.ts",
        "line": 813,
        "repository": "popdam3",
        "source": "const { count: totalActive } = await db.from(\"style_guide_files\")"
      }
    ],
    "style_guide_render_queue": [
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 3220,
        "repository": "popdam3",
        "source": "db.from(\"style_guide_render_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 3228,
        "repository": "popdam3",
        "source": "db.from(\"style_guide_render_queue\").update(fields, { count: \"exact\" })"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 3262,
        "repository": "popdam3",
        "source": "await db.from(\"style_guide_render_queue\").update({"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 3297,
        "repository": "popdam3",
        "source": ".from(\"style_guide_render_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 3312,
        "repository": "popdam3",
        "source": "updateJob: (id, fields) => db.from(\"style_guide_render_queue\").update(fields, { count: \"exact\" }).eq(\"id\", id),"
      }
    ],
    "style_guide_tag_aliases": [],
    "style_guide_tagging_state": [],
    "style_guide_tags": [],
    "style_tracker_rows": [
      {
        "file": "src/pages/StylesPage.tsx",
        "line": 1361,
        "repository": "popdam3",
        "source": "const { error } = await (supabase as any).from(\"style_tracker_rows\").update(buildUpdate(row, column, value)).eq(\"id\", row.id);"
      },
      {
        "file": "src/pages/StylesPage.tsx",
        "line": 1834,
        "repository": "popdam3",
        "source": "const { error } = await (supabase as any).from(\"style_tracker_rows\").update(buildUpdate(row, column, value)).eq(\"id\", row.id);"
      }
    ],
    "style_tracker_user_views": [
      {
        "file": "src/pages/StylesPage.tsx",
        "line": 540,
        "repository": "popdam3",
        "source": ".from(\"style_tracker_user_views\")"
      },
      {
        "file": "src/pages/StylesPage.tsx",
        "line": 1515,
        "repository": "popdam3",
        "source": ".from(\"style_tracker_user_views\")"
      },
      {
        "file": "src/pages/StylesPage.tsx",
        "line": 1541,
        "repository": "popdam3",
        "source": ".from(\"style_tracker_user_views\")"
      },
      {
        "file": "src/pages/StylesPage.tsx",
        "line": 1559,
        "repository": "popdam3",
        "source": ".from(\"style_tracker_user_views\")"
      },
      {
        "file": "src/pages/StylesPage.tsx",
        "line": 1576,
        "repository": "popdam3",
        "source": "const { error } = await (supabase as any).from(\"style_tracker_user_views\").delete().eq(\"id\", view.id);"
      }
    ],
    "tiff_optimization_queue": [
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 2325,
        "repository": "popdam3",
        "source": "const { error } = await db.from(\"tiff_optimization_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 2435,
        "repository": "popdam3",
        "source": "let query = db.from(\"tiff_optimization_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 2497,
        "repository": "popdam3",
        "source": "const { error } = await db.from(\"tiff_optimization_queue\")"
      },
      {
        "file": "supabase/functions/agent-api/index.ts",
        "line": 2530,
        "repository": "popdam3",
        "source": "const { error } = await db.from(\"tiff_optimization_queue\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/tiff-handlers.ts",
        "line": 68,
        "repository": "popdam3",
        "source": "let query = db.from(\"tiff_optimization_queue\")"
      }
    ],
    "user_roles": [
      {
        "file": "supabase-popsg/supabase/functions/admin-api/index.ts",
        "line": 36,
        "repository": "popdam3",
        "source": ".from(\"user_roles\")"
      },
      {
        "file": "supabase/functions/_shared/admin-auth.ts",
        "line": 161,
        "repository": "popdam3",
        "source": ".from(\"user_roles\")"
      },
      {
        "file": "supabase/functions/dam-search-ai/index.ts",
        "line": 45,
        "repository": "popdam3",
        "source": "const { data: role } = await serviceClient().from(\"user_roles\").select(\"role\").eq(\"user_id\", data.user.id).eq(\"role\", \"admin\").maybeSingle();"
      },
      {
        "file": "src/hooks/useIsAdmin.ts",
        "line": 20,
        "repository": "popdam3",
        "source": ".from(\"user_roles\")"
      },
      {
        "file": "supabase/functions/_shared/admin-handlers/scoped-tag-review-handlers.ts",
        "line": 32,
        "repository": "popdam3",
        "source": "const { data, error } = await db.from(\"user_roles\").select(\"role\").eq(\"user_id\", userId);"
      }
    ]
  }
}
```
