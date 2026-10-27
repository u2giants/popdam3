# C-RADIOv4-H versus PopDAM: findings and evidence

Trial performed October 27, 2026, on edge-dev. [Tracking and remaining query-evidence requirement](https://github.com/u2giants/popdam3/issues/538).

This is the scientific report, not the operational handoff. Source used: [PopDAM snapshot](https://github.com/u2giants/popdam3/tree/193b84d27cf1ab0a254f752c26c4bf803311f32b/apps/image-embed-worker). No application or production changes accompany publication.

**Verdict: DON'T SWITCH.** On this sample C-RADIO did not establish a meaningful overall improvement. It found the same number of confirmed specification counterparts among the first ten, made no convincing look-alike gain, and returned slightly fewer clearly relevant text results. Its summary head found two additional specification targets within the first twenty. That small gain does not justify replacing the current models, larger vectors, or additional operating complexity.

The trial itself ran on real images on edge-dev. Production data, settings, schemas and workers were not modified by this trial. The existing worker still had a fresh heartbeat at 10:17 AM EDT on 2026-10-27. No library embedding job or deployed search request was submitted; typed-query vectors were obtained directly from the existing text encoder, without writing searches or vectors to the database.

**Exact coverage:** 500 distinct asset images, plus 50 additional style-group primary images: 550 distinct real thumbnails. The main sample represents 233 non-null style-group IDs and 105 ungrouped assets. Sixty actual style groups were evaluated separately using their primary images and their stored search-document vectors: 50 additional primaries and ten primaries already in the main sample. All 500 main thumbnails downloaded successfully. The three initial apparel lexical hits were really doormats; they were reclassified and one genuine shirt was included before candidate inference. Main sampling strata: 103 doormat, 100 plush, 100 packaging, 89 spec, 107 siblings, one apparel. These are selection strata, not a claim that every thumbnail is a literal example of that product: plush is mainly soft storage baskets and lap desks, not stuffed toys.

**Text, visually judged top-20 precision:**

| Pool | Current | C-RADIO SigLIP2 adaptor |
|---|---:|---:|
| 500 assets, 24 queries | 54.2% | 52.3% |
| Including every visually uncertain result as relevant | 57.3% | 55.0% |
| 60 actual style groups, same 24 queries | 22.3% | 22.5% |
| Group upper bound including uncertain results | 26.0% | 25.4% |

These are single-Codex visual judgments, not independent human labels. Bounds reflect ambiguous thumbnails, not statistical confidence intervals. A paired resample over the 24 asset queries gives a candidate-minus-current difference interval of approximately -4.6 to +0.4 percentage points; this exploratory set does not prove a general text-quality regression or improvement. Most group queries have fewer than twenty relevant candidates, so group precision has a low ceiling. Do not compare the group percentage with the asset percentage as though the pools were equally populated.

For Albert's exact phrases, clearly relevant results out of twenty:

| Query | Current | C-RADIO |
|---|---:|---:|
| spiderman floor covering | 2 | 2 |
| coirmat | 20 | 20 |
| doormat | 20 | 20 |
| lapdesk | 5 | 3 |

For `lapdesk`, three current and two candidate results were uncertain. This tests the embedding leg by itself. The live application also uses exact words, synonym expansion, filters and hybrid ranking; these figures are not a measurement of the full customer search page.

**50-seed image comparison:** every seed's ten neighbours was visually inspected for DINOv3, the current 60:40 DINO/SigLIP blend, RADIO summary, and RADIO DINO adaptor. A strict useful match means the same artwork/product rendering or its clear appearance on a spec, not merely the same franchise or a similarly shaped unrelated product.

| Method | Seeds with at least one clear useful top-10 match | Strict precision across 500 displayed neighbours |
|---|---:|---:|
| DINOv3 | 28/50 | 12.6% |
| Current dual blend | 30/50 | 12.6% |
| RADIO summary | 30/50 | 12.4% |
| RADIO DINO adaptor | 30/50 | 12.8% |

Uncertain-result precision upper bounds: 14.0%, 14.0%, 14.4%, 14.6%, respectively. The tiny differences are not a material win. Some deliberately diverse seeds have no known exact counterpart in the small pool, and duplicate exports crowd other results; these strict precision percentages should not be interpreted as full-library similarity quality. The 50 seeds comprise 22 pre-established containment seeds plus 28 diverse seeds selected using stored DINO distances; selection is therefore not model-neutral.

**Containment, 22 visually established product/part-to-spec pairs:**

| Method | Exact target in first 10 | Exact target in first 20 | Mean reciprocal target rank |
|---|---:|---:|---:|
| DINOv3 | 13/22 | 15/22 | 0.351 |
| Current dual blend | 13/22 | 15/22 | 0.415 |
| RADIO summary | 13/22 | 17/22 | 0.471 |
| RADIO DINO adaptor | 13/22 | 15/22 | 0.483 |

Pairs were established before seeing RADIO rankings. They include a held Shrek mat and its spec, a Wicked mat and its spec, Mickey and Care Bears mats, Sonic and Stitch storage art, a Spider-Man mask design, clocks, a Snoopy frame and a Jack phone stand. One query is only a black frame corner; it is a deliberately hard part/fragment case. Removing it leaves the first-ten count unchanged at 13/21 for all four methods. Exact target IDs are private; duplicate spec exports can count as visually good matches without being the designated exact target. No claim is made about recall across all 140,204 assets.

**Performance on edge-dev:** PyTorch 2.6.0+cu124; batch one; same 55 thumbnails; first five warmups excluded. Current uses its actual native processors and fp32 recipe. RADIO uses bfloat16 autocast, preserves aspect ratio, scales its long edge to 512 and snaps dimensions to multiples of sixteen. Both use the production border crop unchanged. The measured interval is synchronized GPU image forward passes, excluding downloads, crop, image preprocessing, text encoding and result ranking.

| Measurement | Current dual models | RADIO, giant text encoder moved to CPU after encoding queries |
|---|---:|---:|
| Warm median per image | 0.0420 seconds | 0.1014 seconds |
| Warm mean per image | 0.0453 seconds | 0.1672 seconds |
| Peak PyTorch allocated GPU memory | 1.78 GiB | 4.20 GiB |
| Peak reserved GPU memory | 1.94 GiB | 4.50 GiB |

Median candidate cost was about 2.4 times current; mean about 3.7 times. Both candidate image alternatives were loaded for the comparison; timing a selected single-head production recipe remains a separate experiment. These are batch-one measurements, not bulk throughput or end-to-end customer latency. The initial 500-image candidate run retained the giant text encoder on GPU and used 6.83 GiB allocated / 7.32 GiB reserved, with a 1.604-second median. It experienced memory pressure and is not the fair deployment-oriented timing. Offloading that unused text encoder preserved all matching text output and yielded cosine 1.0 against the original first55 image embeddings on every head. The 55 recomputed current vectors also matched stored vectors with minimum cosine above 0.9999999. No existing service or capability was disabled to obtain these results.

**Vector size and storage:** measured outputs are current 768+768; RADIO summary 2,560, SigLIP adaptor 1,536, DINO adaptor 4,096. For two-byte image vectors over the live count of 140,204 non-deleted assets:

| Image vector recipe | Bytes per asset | Whole-library raw image-vector payload |
|---|---:|---:|
| Current two heads | 3,072 | 0.431 GB / 0.401 GiB |
| RADIO summary + SigLIP | 8,192 | 1.149 GB / 1.070 GiB |
| RADIO DINO + SigLIP | 11,264 | 1.579 GB / 1.471 GiB |

The first RADIO option is 2.67 times the current payload; the second is 3.67 times. Keeping all three RADIO outputs would be 2.297 GB and is unnecessary for choosing an image head. Current live vector rows numbered 139,403, occupying about 1.006 GB including table/index overhead; the full-library projections use all 140,204 assets rather than pretending every asset currently has a vector. The difference was observed, not repaired by this trial.

There are also 132,420 asset search-document vectors and 5,808 style-group search-document vectors, currently float32 SigLIP2 embeddings. If that duplication is retained and its dimensions change from768 to1536, the combined raw image-plus-search-vector projection becomes about 0.855 GB current, 1.998 GB with RADIO summary/SigLIP, or 2.429 GB with RADIO DINO/SigLIP. This is a capacity projection, not a proposed schema or a re-embedding job.

[Supabase's published disk overage rate](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size) is $0.125 per GB-month beyond included capacity. Raw image vectors alone correspond to roughly $0.054/month current, $0.144/month summary/SigLIP and $0.197/month DINO/SigLIP. Including the existing duplicated search-document design gives payload-equivalent amounts around $0.107, $0.250 and $0.304/month. These are not predicted bills: allocation increments, free headroom, indexes, row/header overhead, backups, compute and other data are excluded. Actual added disk charge may be zero until more capacity is allocated. New indexes were not built or measured.

The live pgvector extension is0.8.0. Its [documented HNSW half-vector limit](https://github.com/pgvector/pgvector#hnsw) is4,000 dimensions: the4,096-dimensional DINO adaptor cannot be indexed directly with the existing HNSW approach. The2,560-dimensional summary is below that limit but still cannot replace the existing768-dimensional columns without a separately governed future change. This trial made none.

**Commercial license:** NVIDIA identifies this exact C-RADIO model as commercially usable under the [NVIDIA Open Model License](https://developer.download.nvidia.com/licenses/nvidia-open-model-license-agreement-june-2024.pdf), not the noncommercial terms of older unprefixed RADIO models. It grants royalty-free use and distribution subject to its conditions, including lawful use. Redistribution requires the agreement and the specified NVIDIA notice; NVIDIA does not claim ownership of generated outputs. [Official C-RADIOv4-H model card](https://huggingface.co/nvidia/C-RADIOv4-H/blob/0057b339059c0b9e1b4ba996f975410ebbfdfcc8/README.md).

Important separate evidence: the [GitHub research implementation's license](https://github.com/NVlabs/RADIO/blob/4ffaf15d0ff48197c194e306772bdb5fb92db230/LICENSE) limits that software to research/evaluation. This local trial is evaluation. The commercial model license is not a blanket clearance for every upstream code file or third-party dependency. A future shipping proposal must identify a commercially cleared inference implementation; none was deployed here. This is a reading of the identified terms, not a legal opinion about all possible deployments.


## Evidence and limits

[Numeric results](summary.json), [evaluation protocol](protocol.md), and [private artifact hashes and validation receipts](evidence-manifest.json) accompany this report. All four image-search methods' 50-by-10 results and both text methods' 24-by-20 results were visually judged. Raw licensed thumbnails, source rows, vectors and detailed labels remain private on edge-dev; the manifest binds their hashes. The private archive was copied back to edge-dev and every member and all550 thumbnail entries were verified.

The requested20 extra queries from real customer search logs could not be obtained. The24 tested phrases were four supplied by Albert, five pre-existing smoke-test prompts and fifteen analyst probes. They are not historical customer queries. That requirement remains on the same tracking issue. Apparel coverage is one genuine shirt; plush coverage is predominantly soft storage baskets and lap desks. Findings do not establish representative apparel/stuffed-toy performance or full live-application hybrid search quality. The recommendation is to retain current models on the evidence measured.

The handoff copy remains separately preserved and unpublished under the temporary handoff-path freeze; this publication contains the scientific findings and evidence only.

Posted by Codex chat 01a17d9d-d1c2-7680-af0f-76ba48b18bcf on hetz
