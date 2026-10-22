# Indirect database consumers

Fresh production catalog references, October 18, 2026 EDT. Function bodies were not invoked. Text references alone do not prove an active application call. Fingerprints bind these catalog definitions.

```json
[
  {
    "kind": "function",
    "schema": "public",
    "name": "get_style_guide_deterministic_tag_batch",
    "identity": "get_style_guide_deterministic_tag_batch(uuid,integer,boolean)",
    "fingerprint": "1c87c8c50a79431a8b66fa008cbbf9ae",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_folder_consensus_tags",
    "identity": "replace_style_guide_folder_consensus_tags(uuid,jsonb,text)",
    "fingerprint": "afb5afe11a636f69cf87e0b3963f1892",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_folder_consensus_tags",
    "identity": "replace_style_guide_folder_consensus_tags(uuid,jsonb,text)",
    "fingerprint": "afb5afe11a636f69cf87e0b3963f1892",
    "referenced_table": [
      "style_guide_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_folder_consensus_tags",
    "identity": "replace_style_guide_folder_consensus_tags(uuid,jsonb,text)",
    "fingerprint": "afb5afe11a636f69cf87e0b3963f1892",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "reject_style_guide_auto_tag",
    "identity": "reject_style_guide_auto_tag(uuid,uuid)",
    "fingerprint": "16bd22618af6cb293bbc985f091e3f15",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "refresh_style_guide_folder_consensus_batch",
    "identity": "refresh_style_guide_folder_consensus_batch(text,integer,text)",
    "fingerprint": "9ded7048bef0916ae5e5644b9f1de126",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "refresh_style_guide_folder_consensus_batch",
    "identity": "refresh_style_guide_folder_consensus_batch(text,integer,text)",
    "fingerprint": "9ded7048bef0916ae5e5644b9f1de126",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "refresh_style_guide_folder_consensus_batch",
    "identity": "refresh_style_guide_folder_consensus_batch(text,integer,text)",
    "fingerprint": "9ded7048bef0916ae5e5644b9f1de126",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "refresh_style_guide_folder_consensus_batch",
    "identity": "refresh_style_guide_folder_consensus_batch(text,integer,text)",
    "fingerprint": "9ded7048bef0916ae5e5644b9f1de126",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "plm",
    "name": "refresh_style_tracker_item_bridge",
    "identity": "plm.refresh_style_tracker_item_bridge()",
    "fingerprint": "b7e951407761a4c72edac7d02f29c0e4",
    "referenced_table": [
      "legacy_erp_item_identity"
    ]
  },
  {
    "kind": "function",
    "schema": "plm",
    "name": "refresh_style_tracker_item_bridge",
    "identity": "plm.refresh_style_tracker_item_bridge()",
    "fingerprint": "b7e951407761a4c72edac7d02f29c0e4",
    "referenced_table": [
      "erp_items_current"
    ]
  },
  {
    "kind": "function",
    "schema": "plm",
    "name": "refresh_style_tracker_item_bridge",
    "identity": "plm.refresh_style_tracker_item_bridge()",
    "fingerprint": "b7e951407761a4c72edac7d02f29c0e4",
    "referenced_table": [
      "legacy_erp_item_identity"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "refresh_style_guide_file_tag_cache",
    "identity": "refresh_style_guide_file_tag_cache(uuid)",
    "fingerprint": "da35ddc35c4f94adf9c2df3fa55e5d91",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "refresh_style_guide_file_tag_cache",
    "identity": "refresh_style_guide_file_tag_cache(uuid)",
    "fingerprint": "da35ddc35c4f94adf9c2df3fa55e5d91",
    "referenced_table": [
      "style_guide_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "trg_queue_style_guide_deterministic_tags",
    "identity": "trg_queue_style_guide_deterministic_tags()",
    "fingerprint": "36ca396d351c1b5b6bce03f62371caca",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "add_style_guide_manual_tag",
    "identity": "add_style_guide_manual_tag(uuid,text,text)",
    "fingerprint": "5138439811b030e32c31e4179c9ecce9",
    "referenced_table": [
      "style_guide_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "add_style_guide_manual_tag",
    "identity": "add_style_guide_manual_tag(uuid,text,text)",
    "fingerprint": "5138439811b030e32c31e4179c9ecce9",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "add_style_guide_manual_tag",
    "identity": "add_style_guide_manual_tag(uuid,text,text)",
    "fingerprint": "5138439811b030e32c31e4179c9ecce9",
    "referenced_table": [
      "style_guide_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "remove_style_guide_manual_tag",
    "identity": "remove_style_guide_manual_tag(uuid,uuid)",
    "fingerprint": "8db2a28c03e20651743055a9fbe99284",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_deterministic_tags",
    "identity": "replace_style_guide_deterministic_tags(uuid,jsonb,text,text)",
    "fingerprint": "227f4c963592e0e9ff1dd21fd9a9f0a0",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_deterministic_tags",
    "identity": "replace_style_guide_deterministic_tags(uuid,jsonb,text,text)",
    "fingerprint": "227f4c963592e0e9ff1dd21fd9a9f0a0",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_deterministic_tags",
    "identity": "replace_style_guide_deterministic_tags(uuid,jsonb,text,text)",
    "fingerprint": "227f4c963592e0e9ff1dd21fd9a9f0a0",
    "referenced_table": [
      "style_guide_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_deterministic_tags",
    "identity": "replace_style_guide_deterministic_tags(uuid,jsonb,text,text)",
    "fingerprint": "227f4c963592e0e9ff1dd21fd9a9f0a0",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_deterministic_tags",
    "identity": "replace_style_guide_deterministic_tags(uuid,jsonb,text,text)",
    "fingerprint": "227f4c963592e0e9ff1dd21fd9a9f0a0",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "replace_style_guide_deterministic_tags",
    "identity": "replace_style_guide_deterministic_tags(uuid,jsonb,text,text)",
    "fingerprint": "227f4c963592e0e9ff1dd21fd9a9f0a0",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "get_style_guide_tagging_stats",
    "identity": "get_style_guide_tagging_stats()",
    "fingerprint": "ac1256d8e13f42b3fa711eebfa3a566f",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "get_style_guide_deterministic_tag_batch_v2",
    "identity": "get_style_guide_deterministic_tag_batch_v2(uuid,integer,boolean)",
    "fingerprint": "cb2b8dd363e4e4455a968364ab52e78f",
    "referenced_table": [
      "style_guide_tagging_state"
    ]
  },
  {
    "kind": "function",
    "schema": "public",
    "name": "resolve_product_category_prediction_item_identity",
    "identity": "resolve_product_category_prediction_item_identity()",
    "fingerprint": "d7d0f02c3e3726ac43bac3fe39a48ab4",
    "referenced_table": [
      "legacy_erp_item_identity"
    ]
  },
  {
    "kind": "view",
    "schema": "public",
    "name": "style_guide_file_tags_display",
    "identity": "public.style_guide_file_tags_display",
    "fingerprint": "64fbf48cf8d1929b6168a4c0d5da78ca",
    "referenced_table": [
      "style_guide_file_tags"
    ]
  },
  {
    "kind": "view",
    "schema": "public",
    "name": "style_guide_file_tags_display",
    "identity": "public.style_guide_file_tags_display",
    "fingerprint": "64fbf48cf8d1929b6168a4c0d5da78ca",
    "referenced_table": [
      "style_guide_tags"
    ]
  },
  {
    "kind": "view",
    "schema": "api",
    "name": "plm_item_list",
    "identity": "api.plm_item_list",
    "fingerprint": "1e07c9469612b28f8267673bbc54d41f",
    "referenced_table": [
      "legacy_erp_item_identity"
    ]
  }
]
```
