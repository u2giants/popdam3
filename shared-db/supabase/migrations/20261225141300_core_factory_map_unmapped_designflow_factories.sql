-- Curated Master Data load (issue #7070, Task 1): link unmapped Active
-- DesignFlow factories (dflow_prod."Factory") to core.factory through
-- core.factory_source_ref, creating new core factories where no shared
-- factory matches. New core.factory rows seed their approval rows through the
-- existing factory_seed_approvals trigger.
--
-- Source: read-only production comparison on 2026-11-25 of dflow_prod."Factory"
-- name, nickname and country against core.factory and its coldlion refs.
-- Codes follow the existing DesignFlow placeholder convention: DF<Factory.id>.
-- Possible duplicates 3/63, 212/145, 204/210, 161/167 and 174/179 are
-- different factories (owner, 2026-11-25: "all different factories"). Not in this
-- file: DesignFlow test or internal rows 36, 157, 42 (to be set Inactive in
-- DesignFlow). Row 65 is kept as the one DesignFlow test factory (owner,
-- 2026-11-25: "we need 1 test factory") and linked to DF65.
-- Idempotent: every insert is ON CONFLICT DO NOTHING.

with new_factory(dflow_id, name, nickname, country) as (values
  (159, '(DongYang) SANTAS-PRO Creation CO Ltd', 'DY Santas-Pro Plush', null),
  (151, '3T Group', 'Daisy Lapdesk', 'CHN'),
  (59,  '7 EASY HOUSEWARE LTD', '7Easy', 'CHN'),
  (191, 'Amy Hengfan', 'Amy Hengfan', null),
  (169, 'Artcool Ray', 'Artcool Ray', 'CHN'),
  (144, 'Bacninh', 'Chinh', null),
  (168, 'Cavela', 'cavela', 'USA'),
  (110, 'CM Group', 'Derek Song', null),
  (134, 'Coirflex', 'Govind Joy', null),
  (164, 'DongYang YuMei Home Products Co., LTD', 'Haidi DY Yumei Mat', null),
  (188, 'HANGZHOU EDAR INTERNATIONAL CO., LTD.', 'EDAR GARDEN', null),
  (211, 'FUZHOU YIBANG PLASTICS CO.,LTD', 'FUZHOU YIBANG', null),
  (117, 'GAMS', 'Gams', 'IND'),
  (189, 'HANGZHOU L&Y TRADING CO., LTD', 'HZ Liangyan Garden', null),
  (194, 'Hangzhou Light Industrial Products, Arts&Crafts, Textiles I/E. CO., LTD', 'HZ light Industrial', null),
  (209, 'Hunan Mingci Homeware Co.,ltd', 'Lynn Hunan Mingci', null),
  (114, 'iera living', 'Dhruv', 'IND'),
  (193, 'Linhai Liguang Arts & Crafts Manufacture', 'Linhai Liguang', null),
  (160, 'Linyi Leadchem Inc.', 'Linyi Elza Toddle', 'CHN'),
  (128, 'Lishun', 'Damon', null),
  (170, 'Lucky Star', 'Lucky Star', null),
  (206, 'Mike Fujian Jinhao', 'Mike Fujian Jinhao', null),
  (190, 'NINGBO JOHN INTERNATIONAL INDUSTRIAL CO LTD', 'NB John Garden', null),
  (208, 'NINGBO M&J IMPORT AND EXPORT CO.,LTD.', 'Ben NBMJ', null),
  (119, 'NINGBO MOVING UP HOUSEWARE CO.,LTD', 'Kathy Movingup', 'CHN'),
  (96,  'Prisma', 'Prisma', 'IND'),
  (192, 'Qingdao Victoria', 'Jason', null),
  (201, 'Shangdong Jiahua', 'Lucy from jiahua', null),
  (175, 'Shanghai Winnel Industry Co., Ltd.', 'Shanghai Winnel', null),
  (197, 'Smithcrafts Pvt Ltd', 'Vibhu from Sudir', null),
  (162, 'Taizhou Huiya Carpet Co.,Ltd.', 'Sarah Huiya Carpet', 'CHN'),
  (141, 'UNION HOME CO.,LTD', 'Union Home', null),
  (183, 'Wenzhou Seko Packing Co,Ltd', 'Leo Seko Storage', null),
  (180, 'Xianju Xinyue Home Textile Co Ltd', 'Xinyue Textile', null),
  (163, 'YAJIE VIETNAM CO LTD', 'YAJIE VN RUG', 'VNM'),
  (182, 'YIWU RICH PHOTO FRAME CO.,LTD', 'Cindy YWRich', null),
  (87,  'YiWu YuFei color printing factory', 'Happy', null),
  (102, 'YiwuJiaodian', 'AriSoft Stg', 'CHN'),
  (200, 'Zhejiang Bestime Trading Co., Ltd', 'ZheJiang Bestime', null),
  (121, 'Zhejiang Lianbo Digital Technology Co., Ltd', 'LuoStorage', 'CHN'),
  (3,   'Susan Shengxing', 'Guangdong Shengxing Craft', 'CHN'),
  (145, 'Jack', 'Jack', null),
  (212, 'Ningbo Henghui frames Co.,Ltd', 'Jack NBHH', null),
  (204, 'serena', 'Serena', null),
  (210, 'Serena Gracecoaster', 'Serena Gracecoaster', null),
  (161, 'Oriental Weavers Group', 'Oriental Weavers (Egypt)', 'EGY'),
  (167, 'Orientals Group', 'MAC Carpets Egypt', null),
  (174, 'Cherry Jinhua Dike', 'Cherry Jinhua Dike', null),
  (65,  'DesignFlow Test Factory', 'test', null)
)
insert into core.factory (code, name, display_name, country, status, party_type, designflow_vendor_id, metadata)
select 'DF' || dflow_id, name, nickname, country, 'active'::app.entity_status, 'factory', dflow_id,
       jsonb_build_object('issue', 7070, 'source', 'designflow factory mapping 2026-11-25',
                          'designflow_nickname', nickname, 'code_is_designflow_placeholder', true)
from new_factory
on conflict do nothing;

-- DesignFlow Factory id -> core.factory code. Several DesignFlow rows are
-- duplicate entries of one company and share one core factory.
with link(dflow_id, core_code, confidence, basis) as (values
  (159, 'DF159', 'verified', 'new core factory from designflow row'),
  (151, 'DF151', 'verified', 'new core factory from designflow row'),
  (59,  'DF59',  'verified', 'new core factory from designflow row'),
  (191, 'DF191', 'verified', 'new core factory from designflow row'),
  (169, 'DF169', 'verified', 'new core factory from designflow row'),
  (171, 'DF169', 'probable', 'duplicate designflow row: Artcool-Ray'),
  (144, 'DF144', 'verified', 'new core factory from designflow row'),
  (168, 'DF168', 'verified', 'new core factory from designflow row'),
  (110, 'DF110', 'verified', 'new core factory from designflow row'),
  (134, 'DF134', 'verified', 'new core factory from designflow row'),
  (164, 'DF164', 'verified', 'new core factory from designflow row'),
  (188, 'DF188', 'verified', 'new core factory from designflow row'),
  (177, 'DF188', 'probable', 'duplicate designflow row: Edar'),
  (211, 'DF211', 'verified', 'new core factory from designflow row'),
  (117, 'DF117', 'verified', 'new core factory from designflow row'),
  (189, 'DF189', 'verified', 'new core factory from designflow row'),
  (194, 'DF194', 'verified', 'new core factory from designflow row'),
  (209, 'DF209', 'verified', 'new core factory from designflow row'),
  (114, 'DF114', 'verified', 'new core factory from designflow row'),
  (193, 'DF193', 'verified', 'new core factory from designflow row'),
  (160, 'DF160', 'verified', 'new core factory from designflow row'),
  (128, 'DF128', 'verified', 'new core factory from designflow row'),
  (170, 'DF170', 'verified', 'new core factory from designflow row'),
  (206, 'DF206', 'verified', 'new core factory from designflow row'),
  (190, 'DF190', 'verified', 'new core factory from designflow row'),
  (208, 'DF208', 'verified', 'new core factory from designflow row'),
  (119, 'DF119', 'verified', 'new core factory from designflow row'),
  (96,  'DF96',  'verified', 'new core factory from designflow row'),
  (192, 'DF192', 'verified', 'new core factory from designflow row'),
  (201, 'DF201', 'verified', 'new core factory from designflow row'),
  (175, 'DF175', 'verified', 'new core factory from designflow row'),
  (197, 'DF197', 'verified', 'new core factory from designflow row'),
  (198, 'DF197', 'verified', 'duplicate designflow row: Smithcrafts Pvt Ltd'),
  (199, 'DF197', 'verified', 'duplicate designflow row: Smithcrafts Pvt Ltd'),
  (162, 'DF162', 'verified', 'new core factory from designflow row'),
  (141, 'DF141', 'verified', 'new core factory from designflow row'),
  (183, 'DF183', 'verified', 'new core factory from designflow row'),
  (180, 'DF180', 'verified', 'new core factory from designflow row'),
  (163, 'DF163', 'verified', 'new core factory from designflow row'),
  (182, 'DF182', 'verified', 'new core factory from designflow row'),
  (87,  'DF87',  'verified', 'new core factory from designflow row'),
  (102, 'DF102', 'verified', 'new core factory from designflow row'),
  (200, 'DF200', 'verified', 'new core factory from designflow row'),
  (121, 'DF121', 'verified', 'new core factory from designflow row'),
  (123, 'INBABU', 'verified', 'exact name match: BABU COIR WORKS'),
  (133, 'FLGDS',  'verified', 'exact name match: Floor Gardens'),
  (124, 'FLGDS',  'verified', 'exact name match: Floor Gardens'),
  (129, 'DF129',  'verified', 'exact name and code match: FEH'),
  (63,  'CNCXC',  'verified', 'exact name match: Shantou Chengxing Craft'),
  (149, 'CNZJNA', 'verified', 'exact name match: Zhejiang Wuyi Natural Home Deco'),
  (140, 'CNSHR',  'verified', 'name match: Sanmen Hengxin Rubber and Plastic'),
  (74,  'CNINT',  'probable', 'name match: Shandong Intco'),
  (186, 'CNCHP',  'verified', 'name match: Ningbo Chanfonn Home Products'),
  (202, 'CNCHP',  'probable', 'name match: Ningbo Chanfonn Home'),
  (207, 'CNCHP',  'probable', 'name and contact match: Sunny NB Chanfonn'),
  (3,   'DF3',    'verified', 'new core factory from designflow row'),
  (145, 'DF145',  'verified', 'new core factory from designflow row'),
  (212, 'DF212',  'verified', 'new core factory from designflow row'),
  (204, 'DF204',  'verified', 'new core factory from designflow row'),
  (210, 'DF210',  'verified', 'new core factory from designflow row'),
  (161, 'DF161',  'verified', 'new core factory from designflow row'),
  (167, 'DF167',  'verified', 'new core factory from designflow row'),
  (174, 'DF174',  'verified', 'new core factory from designflow row'),
  (65,  'DF65',   'verified', 'designflow test factory kept by owner')
)
insert into core.factory_source_ref (factory_id, source_system, source_table, source_id, confidence, raw)
select f.id, 'designflow', 'Factory', l.dflow_id::text, l.confidence::app.source_confidence,
       jsonb_build_object('at', '2026-11-25', 'basis', l.basis, 'reconciled_for', 'popcre/shared-db#7070')
from link l
join core.factory f on f.code = l.core_code
on conflict (source_system, source_table, source_id) do nothing;
