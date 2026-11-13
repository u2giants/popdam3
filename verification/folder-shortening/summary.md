# Folder shortening — dry-run summary (#963, Phase 4)

Inputs: 58,785 folders, 378,215 files (listing from edgesynology2, read-only). Target: path from the share root ≤ 200 characters.

## Totals

- Folders to rename: 4,152
- Files over 200 before: 43,985
- Files over 200 after (year rule on): 6,102
- Files over 200 after if the year rule were off: 6,325 (folders renamed: 4,135)
- Files over 240 before / after: 3,049 / 449
- Needs attention: 2

## Renames by rule

- customer_alias: 31
- customer_alias_in_name: 29
- drop_finished_suffix: 33
- exact_folder_rename: 372
- pattern:licensor_vault_folder: 6
- phrase_abbreviation: 3,144
- stage_abbreviation: 3
- strip_customer: 539
- strip_year: 86

## Needs attention by kind

- fragment_under_3: 1
- would_be_empty: 1

## Where the remaining files over 200 live (top 25 folders, 4 levels below the root)

- 764 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Multicustomer`
- 569 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross`
- 447 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Burlington`
- 419 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Hobby_Lobby`
- 353 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2026`
- 342 — `Decor/Character Licensed/____New Structure/Concept_Approved/STORAGE/BGP_HGP_Fabric storage/BGP_HGP`
- 158 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Homegoods`
- 155 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/BGX _GFZ - Printed glass/BGQ_GFQ - Printed glass with glitter`
- 145 — `Decor/Character Licensed/____New Structure/In Dev/Line Designs Inventory/Garden_WB Marvel Disney/_freelancer`
- 125 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/BAM`
- 123 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/MBF_Floating frame canvas box/MBF_Floating character MDF box`
- 114 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/CPC_C00_MQC - Die-cut MDF plaque or sign/Non-std sizes`
- 80 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2027`
- 78 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Burlington/2026`
- 69 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Hobby_Lobby/2026`
- 65 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/HotTopic`
- 64 — `Decor/Character Licensed/____New Structure/Concept_Approved/DESKTOP/MDS_Phone_tablet holder/MDSH7_MDSH9_Phone stand`
- 56 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/MFH_Framed high gloss_MDF print with spot varnish/16x20`
- 56 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/MFQ_Framed MDF with glitter_Framed high gloss w glitter/12x16`
- 56 — `Decor/Character Licensed/____New Structure/Product Ideas/2024-07_Garden gloves and tools/Sample photos/Gavin Photos`
- 50 — `Decor/Character Licensed/____New Structure/Concept_Approved/FUNCTIONAL WALL/PQK_MQK_Wall clock/12x12`
- 49 — `Decor/Character Licensed/____New Structure/In Dev/Line Designs Inventory/Marvel_Coir door mats/_freelancer`
- 49 — `Decor/Character Licensed/____New Structure/Product Ideas/2023-05_Multi-piece framed art set/_freelancer/Devon Swing_Multi-piece framed art set mockup project`
- 49 — `Decor/Character Licensed/____New Structure/Product Ideas/2024-03_Collapsible plastic storage crate/Round 2/COLLAPSIBLE CRATES ALL DIE-LINES - STITCH`
- 47 — `Decor/Character Licensed/____New Structure/In Dev/Line Designs Inventory/Disney WB NBCU_Coir mats/_freelancer`

## 50 longest paths after renaming

- 300 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=1025616458319080647&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 300 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=2742208581948301999&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 300 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=2792655721927020168&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 300 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=4191799682739962852&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 300 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=6846343860196376616&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 300 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=8427181649028906510&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 299 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=854724289720457506&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 294 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYLS03/Option 2/Glitter Placement/VSN2KDYLS03_art_canvas 1 art_glitter placement.jpg`
- 294 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYLS03/Option 2/Glitter Placement/VSN2KDYLS03_art_canvas 2 art_glitter placement.jpg`
- 289 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Hobby_Lobby/2026/Warehouse Refresh FH26/Jon/_working/custom art/art styles/Spider-Man Graffiti Canvas Wall Art _Spider-Man Poster_Spider-man Canvas Print Art_Spider-Man Wall Decor_Spiderman Gift_Decorative Painting image 1.png`
- 287 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYLS04/Option 2/Foil Placement/VSN2KDYLS04_canvas 1 art_glitter placement.jpg`
- 287 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYLS04/Option 2/Foil Placement/VSN2KDYLS04_canvas 2 art_glitter placement.jpg`
- 283 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KPNUT02/Option 1/Placement/VSN2KPNUT02_canvas 2 art_glitter placement_.jpg`
- 282 — `Decor/Character Licensed/____New Structure/Freelancer art/2026_09 Mukesh Ideas/venom/8XR2pEict4M_8TkYBFLXRrEAvHmXds0EyTkchfu752_oitMjQtmgy7WCFebxhJKXApqJCbOpTKlr9ApYeLSIIv5IW3yIPLx7dHCejnkTKGzYtRjKYj_apEGsbrQRBF2z0Cn1wMEs8O2Y5PCkSfGUnKnB2Js5X3ssYHeirlPosbWkWGEQf63Y90DD_q0Gxhlu.jpeg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYNX01/Option 2/Placement/VSN2KDYNX01_canvas 1 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYNX01/Option 2/Placement/VSN2KDYNX01_canvas 2 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYPN02/Option 2/Placement/VSN2KDYPN02_canvas 1 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYPN04/Option 1/Placement/VSN2KDYPN04_canvas 1 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYPN04/Option 1/Placement/VSN2KDYPN04_canvas 2 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KNBGD01/Option 1/Placement/VSN2KNBGD01_canvas 1 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KNBGD01/Option 1/Placement/VSN2KNBGD01_canvas 2 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KNBGD01/Option 2/Placement/VSN2KNBGD01_canvas 1 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KNBGD01/Option 2/Placement/VSN2KNBGD01_canvas 2 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KPNUT02/Option 1/Placement/VSN2KPNUT02_canvas 1 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KVMSB01/Option 1/Placement/VSN2KVMSB01_canvas 1 art_glitter placement.jpg`
- 282 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KVMSB01/Option 1/Placement/VSN2KVMSB01_canvas 2 art_glitter placement.jpg`
- 281 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYPN02/Option 2/Placement/VSN2KDYPN02_canvas 2art_glitter placement.jpg`
- 281 — `Decor/Character Licensed/____New Structure/Product Ideas/2024-07_Garden gloves and tools/Garden Tools Costing 6-2024/For Factory/Garden Rake with color printing and PP + TPR handle/2.95x11.42 x2.17 garden hand rake with color printing and PP + TPR handle costing sheet 06-25-24.pdf`
- 275 — `Decor/Character Licensed/____New Structure/Concept_Approved/DESKTOP/UP0_MDE - Lap writing desk/21x13/Disney/MDE42DYPN02/For Factory/MDE42DYPN02 Disney rectangle dry-erase lap desk w cushion Princess vector art group on blue 21x13_edgesynology3_Nov-22-024256-2023_Conflict.zip`
- 274 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/AB0_VSM - Metallic canvas/25x25/Warner Bros/VSM22WASM/VSM22WASM - Superman Metallic Canvas 25x25/File Factory - VSM22WASM -Superman Metallic Canvas/VSM22WASM Superman Metallic Canvas 25x25 File Factory.psd`
- 274 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/MFH_Framed high gloss_MDF print with spot varnish/13x19/Warner Bros/MFH93DCJK01/For Factory/MFH93DCJK01 DC Comics framed high gloss print Batman Heath Joker on newspaper 13x19 .25 frame width 1.5 depth.zip`
- 274 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Multicustomer/Store Shopping_SS23/Burlington/Costing/Half-Moon Hamper Storage costing sheet/halfmoon hamper construction photos/20230228_half-moon hamper EVA foam body inside view w fabric removed2.jpg`
- 273 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Multicustomer/Store Shopping_SS23/Burlington/Costing/Half-Moon Hamper Storage costing sheet/halfmoon hamper construction photos/20230228_half-moon hamper EVA foam body inside view w fabric removed.jpg`
- 273 — `Decor/Character Licensed/____New Structure/Product Ideas/2024-07_Garden gloves and tools/Garden Tools Costing 6-2024/For Factory/Garden Trowel with wood handle printed tool head/3.35x11.8 x1.15 garden trowel with wood handle and printed tool head costing sheet 06-27-24.pdf`
- 272 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/HSR_MFC - Die-cut MDF shadowbox & die-cut photo frame/Disney/MFC2MDYWP01/For Factory/MFC2MDYWP01 tech pack Disney die-cut MDF shadowbox Winnie the Pooh Happy Holidays 9x24 .5 frame width 1 depth Ross.zip`
- 272 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/5.55”x4.09” x2.87” flat-top greyboard storage chests w attached lid costing sheet.pdf`
- 272 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KVMSB01/Option 3/VSN2KVMSB01_canvas 1 art_glitter placement.jpg`
- 272 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KVMSB01/Option 3/VSN2KVMSB01_canvas 2 art_glitter placement.jpg`
- 272 — `Decor/Character Licensed/____New Structure/Product Ideas/2025-03 Mickey and Minnie MDF print with die-cut words shape/Costing Sheet Creation Mickey and Minnie MDF print with die-cut wordsshape/Costing Sheet Creation Mickey and Minnie MDF print with die-cut words shape.pdf`
- 271 — `Decor/Character Licensed/____New Structure/Concept_Approved/WALL ART/MBF_Floating frame canvas box/MBF_Floating character MDF box/8x12/Marvel/MBF82MVSP01/For Factory/MBF82MVSP01 TECH PACK 7.9x11.2 MDF floating character box Spider-man Amazing Fantasy No 1 Hobby Lobby.zip`
- 271 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/5.55”x4.09” x2.87” flat-top greyboard storage chests w attached lid costing sheet.ai`
- 271 — `Decor/Character Licensed/____New Structure/Product Ideas/2025-03 Mickey and Minnie MDF print with die-cut words shape/Costing Sheet Creation Mickey and Minnie MDF print with die-cut wordsshape/Costing Sheet Creation Mickey and Minnie MDF print with die-cut words shape.ai`
- 270 — `Decor/Character Licensed/____New Structure/Concept_Approved/FUNCTIONAL WALL/PQK_MQK_Wall clock/12x12/Warner Bros/MQK21DCBM01/For Factory/MQK21DCBM01 tech pack DC Comics PP molded wall clock TP516 step movement no-batt Batman swinging through hexagon 12x12 Burlington.zip`
- 270 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/14.49x12.24x6.46 flat-top greyboard storage chests w attached lid costing sheet.pdf`
- 270 — `Decor/Character Licensed/____New Structure/Product Ideas/2024-07_Garden gloves and tools/Garden Tools Costing 6-2024/For Factory/Garden bucket with 3pcs kids garden tool set/_old/4.72x8.66 x9 garden bucket with 3-pc kids garden tool set belly band packaging 09-06-24.pdf`
- 269 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/11.97x9.88x5.98 flat-top greyboard storage chests w attached lid costing sheet.pdf`
- 269 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/14.49x12.24x6.46 flat-top greyboard storage chests w attached lid costing sheet.ai`
- 269 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/15.98x13.5x7.01 flat-top greyboard storage chests w attached lid costing sheet.pdf`
- 269 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Hobby_Lobby/Refresh_SS23/_prelim/New product formats 081122/Superman chest with greyboard and fabric/white-sports-clothing-fabric-football-shirt-jersey-texture-abstract-background_293060-16765.jpg`
- 268 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar_General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/5 piece lift-off lid box set/Set of 5 lift-off lid plain greyboard boxes with placement print on lid, AOP on body_.png`
