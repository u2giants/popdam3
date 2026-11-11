# Folder shortening — dry-run summary (#963, Phase 4)

Inputs: 58,750 folders, 378,102 files (listing from edgesynology2, read-only). Target: path from the share root ≤ 200 characters.

## Totals

- Folders to rename: 4,094
- Files over 200 before: 44,090
- Files over 200 after (year rule off): 9,173
- Files over 200 after if the year rule were on: 8,942 (folders renamed: 4,106)
- Files over 240 before / after: 3,058 / 538
- Needs attention: 1

## Renames by rule

- customer_alias: 2
- drop_finished_suffix: 33
- exact_folder_rename: 370
- pattern:licensor_vault_folder: 6
- phrase_abbreviation: 3,145
- stage_abbreviation: 2
- strip_customer: 541

## Needs attention by kind

- fragment_under_3: 1

## Where the remaining files over 200 live (top 25 folders, 4 levels below the root)

- 1,220 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/STORAGE/BGP_HGP_Fabric storage/BGP_HGP`
- 764 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Multicustomer`
- 654 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar General/2026`
- 569 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross`
- 447 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Burlington`
- 419 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Hobby Lobby`
- 371 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/BGX _GFZ - Printed glass/BGQ_GFQ - Printed glass with glitter`
- 301 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/CPC_C00_MQC - Die-cut MDF plaque or sign/Non-std sizes`
- 261 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/MBF_Floating frame canvas box/MBF_Floating character MDF box`
- 158 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Homegoods`
- 145 — `Decor/Character Licensed/____New Structure/In Dev/Line Designs Inventory/Garden_WB Marvel Disney/_freelancer`
- 125 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/BAM`
- 124 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/FUNCTIONAL WALL/PQK_MQK_Wall clock/12x12`
- 114 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/DESKTOP/MDS_Phone_tablet holder/MDSH7_MDSH9_Phone stand`
- 97 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/MFQ_Framed MDF with glitter_Framed high gloss w glitter/12x16`
- 87 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AA0_AAA_VSZ - Canvas/10x13.5`
- 85 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Hobby Lobby/2026`
- 82 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/DESKTOP/UP0_MDE - Lap writing desk/23.5x10`
- 81 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/MQC_Die-cut MDF plaque or sign/Non-std sizes`
- 80 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Burlington/2026`
- 80 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar General/2027`
- 77 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Hot Topic`
- 76 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/MFH_Framed high gloss_MDF print with spot varnish/16x20`
- 75 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/BR0_MFZ_VFZ - Framed MDF print/Non-std sizes`
- 72 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/CSM - Tin signs/SQX_Tin signs`

## 50 longest paths after renaming

- 308 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=1025616458319080647&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 308 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=2742208581948301999&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 308 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=2792655721927020168&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 308 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=4191799682739962852&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 308 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=6846343860196376616&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 308 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=8427181649028906510&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 307 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AAD_VSY_VQY - DIY canvas/12x12/Marvel/VSY21MVSP02/PPS Photos/Jon photos 9.8.2026/_cgi-bin_mmwebwx-bin_webwxgetmsgimg__&MsgID=854724289720457506&skey=@crypt_dea0f548_28e97393dc2bf9a3248d3175f65b9aa0&mmweb_appid=wx_webfilehelper.jpg`
- 294 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYLS03/Option 2/Glitter Placement/VSN2KDYLS03_art_canvas 1 art_glitter placement.jpg`
- 294 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYLS03/Option 2/Glitter Placement/VSN2KDYLS03_art_canvas 2 art_glitter placement.jpg`
- 289 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Hobby Lobby/2026/Warehouse Refresh FH26/Jon/_working/custom art/art styles/Spider-Man Graffiti Canvas Wall Art _Spider-Man Poster_Spider-man Canvas Print Art_Spider-Man Wall Decor_Spiderman Gift_Decorative Painting image 1.png`
- 287 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYLS04/Option 2/Foil Placement/VSN2KDYLS04_canvas 1 art_glitter placement.jpg`
- 287 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KDYLS04/Option 2/Foil Placement/VSN2KDYLS04_canvas 2 art_glitter placement.jpg`
- 283 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/DESKTOP/UP0_MDE - Lap writing desk/21x13/Disney/MDE42DYPN02/For Factory/MDE42DYPN02 Disney rectangle dry-erase lap desk w cushion Princess vector art group on blue 21x13_edgesynology3_Nov-22-024256-2023_Conflict.zip`
- 283 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KPNUT02/Option 1/Placement/VSN2KPNUT02_canvas 2 art_glitter placement_.jpg`
- 282 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/AB0_VSM - Metallic canvas/25x25/Warner Bros/VSM22WASM/VSM22WASM - Superman Metallic Canvas 25x25/File Factory - VSM22WASM -Superman Metallic Canvas/VSM22WASM Superman Metallic Canvas 25x25 File Factory.psd`
- 282 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/MFH_Framed high gloss_MDF print with spot varnish/13x19/Warner Bros/MFH93DCJK01/For Factory/MFH93DCJK01 DC Comics framed high gloss print Batman Heath Joker on newspaper 13x19 .25 frame width 1.5 depth.zip`
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
- 280 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/HSR_MFC - Die-cut MDF shadowbox & die-cut photo frame/Disney/MFC2MDYWP01/For Factory/MFC2MDYWP01 tech pack Disney die-cut MDF shadowbox Winnie the Pooh Happy Holidays 9x24 .5 frame width 1 depth Ross.zip`
- 279 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/MBF_Floating frame canvas box/MBF_Floating character MDF box/8x12/Marvel/MBF82MVSP01/For Factory/MBF82MVSP01 TECH PACK 7.9x11.2 MDF floating character box Spider-man Amazing Fantasy No 1 Hobby Lobby.zip`
- 278 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/FUNCTIONAL WALL/PQK_MQK_Wall clock/12x12/Warner Bros/MQK21DCBM01/For Factory/MQK21DCBM01 tech pack DC Comics PP molded wall clock TP516 step movement no-batt Batman swinging through hexagon 12x12 Burlington.zip`
- 274 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Multicustomer/Store Shopping_SS23/Burlington/Costing/Half-Moon Hamper Storage costing sheet/halfmoon hamper construction photos/20230228_half-moon hamper EVA foam body inside view w fabric removed2.jpg`
- 273 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/B3M_3FZ - 3D Lenticular framed/13x19/Warner Bros/3FZ93DCJK02/For Factory/3FZ93DCJK02 tech pack DC Comics framed 3D lenticular image flip Joker with tomato and fish 13x19 289x442mm 1 frame Ross.zip`
- 273 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Multicustomer/Store Shopping_SS23/Burlington/Costing/Half-Moon Hamper Storage costing sheet/halfmoon hamper construction photos/20230228_half-moon hamper EVA foam body inside view w fabric removed.jpg`
- 273 — `Decor/Character Licensed/____New Structure/Product Ideas/2024-07_Garden gloves and tools/Garden Tools Costing 6-2024/For Factory/Garden Trowel with wood handle printed tool head/3.35x11.8 x1.15 garden trowel with wood handle and printed tool head costing sheet 06-27-24.pdf`
- 272 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/STORAGE/BG_Greyboard storage/Lift-off lid boxes/Disney/BGW55DYNX01/For Factory/BGW55DYNX01 Disney XLarge greyboard lift-off lid glitter lid box w glow in dark print NBX group purple pattern 15x14 x7.5.zip`
- 272 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/STORAGE/PBG_BBP - Greyboard Faux book storage/8.5x12/Disney/BBP92DYHP01/For Factory/BBP92DYHP01 Disney Fall Holiday greyboard faux book storage Three Sisters with text Hocus Pocus on grey 8.5x12 x3.25.zip`
- 272 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/GFA_Framed banner and pennant and newspaper/17x19/Disney/GFA7HDYNX01/For Factory/GFA7HDYNX01 Disney framed banner under glass Nightmare BC poster satin banner 17x19 .75 frame width 1.15 depth.zip`
- 272 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/5.55”x4.09” x2.87” flat-top greyboard storage chests w attached lid costing sheet.pdf`
- 272 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KVMSB01/Option 3/VSN2KVMSB01_canvas 1 art_glitter placement.jpg`
- 272 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/_FINISHED/Ross/Q1 Q2 Dev_SS24_REVISE/_prelim/_round 1_091323/11x14'' 2 pc canvas set w glitter or foil/prelim assets/_extra designs from Gina/VSN2KVMSB01/Option 3/VSN2KVMSB01_canvas 2 art_glitter placement.jpg`
- 272 — `Decor/Character Licensed/____New Structure/Product Ideas/2025-03 Mickey and Minnie MDF print with die-cut words shape/Costing Sheet Creation Mickey and Minnie MDF print with die-cut wordsshape/Costing Sheet Creation Mickey and Minnie MDF print with die-cut words shape.pdf`
- 271 — `Decor/Character Licensed/____New Structure/Concept Approved Designs/DESKTOP/MTP78_MTP46_Countdown calendars/2 block/4x6/Peanuts/MTP57PNUT02/For Factory/MTP57PNUT02 Peanuts Winter Holiday MDF block countdown calendar Snoopy Twas the Night Before Christmas 4.33x7 x2.16.zip`
- 271 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/5.55”x4.09” x2.87” flat-top greyboard storage chests w attached lid costing sheet.ai`
- 271 — `Decor/Character Licensed/____New Structure/Product Ideas/2025-03 Mickey and Minnie MDF print with die-cut words shape/Costing Sheet Creation Mickey and Minnie MDF print with die-cut wordsshape/Costing Sheet Creation Mickey and Minnie MDF print with die-cut words shape.ai`
- 270 — `Decor/Character Licensed/____New Structure/In Dev/Cust Adopted/Dollar General/2024/Storage SS24/_freelancer/for Peter_071624/_previous costing sheets/7 piece flat-top greyboard chest set/14.49x12.24x6.46 flat-top greyboard storage chests w attached lid costing sheet.pdf`
- 270 — `Decor/Character Licensed/____New Structure/Product Ideas/2024-07_Garden gloves and tools/Garden Tools Costing 6-2024/For Factory/Garden bucket with 3pcs kids garden tool set/_old/4.72x8.66 x9 garden bucket with 3-pc kids garden tool set belly band packaging 09-06-24.pdf`
## Notes

- Listing: `find -type d` and `find -type f` on edgesynology2 under the root, 2026-11-11 about 4:05 PM EST, `@eaDir`/`#recycle`/`#snapshot` excluded. The file count (378,102) is every file on disk; the Phase 0 baseline counted only PopDAM assets (172,791), so the "over 200" numbers here are larger.
- Projection: also shortening the stage folder `Concept Approved Designs` → `Concept Approved` would bring files over 200 down to about 6,600 (not in the rules; needs owner yes/no and Phase 3 support).
- Remaining long paths are mostly 201–210 characters, inside product-type and SKU photo subfolders and finished working folders; see the groups above.
- Regenerate: `node tools/folder-rename/plan.mjs --rules tools/folder-rename/rules.json --dirs <dirs.txt> --files <files.txt> --out verification/folder-shortening`. Tests: `node --test tools/folder-rename/plan.test.mjs`.
