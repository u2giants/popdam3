-- #5609 read-only successor acceptance; successor opening November 6, 2026, 9:52:54.996313 AM EST.
-- Historical failed-window probe preserved byte-for-byte at
-- docs/verification/issue-5609-trigger-acceptance/5609-original-failed-window.sql
-- SHA256 4db994c5425617fe5c211f688b6d35dd520f2af5449ef80d7c7e0c96d6a0eb9f
-- Original post-apply baseline observed November 5, 2026,
-- 12:36:57 AM EST after automatic run41974228042 applied the immutable source.
-- Its catalog-recovery verification remains distinct; never reapply this source.
-- Frozen pre-change main PATCH baseline: November 4, 2026, 10:37 PM EST.
-- Frozen document rate: 8,829 updates / 5,050.846546 seconds, ending
-- November 5, 2026, 12:01:25 AM EST, while the migration was still absent.
-- No writes, timers, helpers, grants, or relaxed limits are introduced.
with baseline as (
 select
   '2026-11-06T09:52:54.996313-05:00'::timestamptz as observed_at,
   '2026-11-05T13:40:56.41864-05:00'::timestamptz as statement_stats_reset,
   null::timestamptz as database_stats_reset,
   '2026-11-05T13:46:38.291291-05:00'::timestamptz as postmaster_started_at,
   87::bigint as statement_dealloc,
   103::bigint as family_entry_count,
   '70c2088a6e62d84140e0147444ad4ff1'::text as family_vector_md5,
   17809::oid as asset_relid,
   713489::oid as document_relid,
   383529::bigint as asset_updates,
   280730::bigint as document_updates,
   least(170.077045367033::numeric,4876427.13620301::numeric/29804,5249576.57683701::numeric/30092) as pre_mean_ms,
   least(59888.980667756245::numeric,1764593069::numeric/29804,1778351890::numeric/30092) as pre_wal_per_call,
   (8829::numeric / 5050.846546::numeric) as pre_document_updates_per_second
), baseline_family as (
 select * from (values
(16486::oid,5::oid,true,-9209443309706343178::bigint,'2026-11-06T12:54:15.161893+00:00'::timestamptz,'0e804dacdf3fcb0965064839e4ce1614',5::bigint,226.030179::numeric,258430::numeric),
(16486::oid,5::oid,true,-9172451651300148137::bigint,'2026-11-05T19:34:51.946328+00:00'::timestamptz,'3b1cfddb5bef816ffa09ef455f6a6924',1::bigint,0.99595::numeric,856::numeric),
(16486::oid,5::oid,true,-9146962045379965778::bigint,'2026-11-06T10:48:35.446679+00:00'::timestamptz,'03a815ae926236290d9b952e0e0b4efc',2::bigint,59.531608::numeric,63586::numeric),
(16486::oid,5::oid,true,-9066702125383713686::bigint,'2026-11-06T00:08:16.419871+00:00'::timestamptz,'20b41d09d5cb1d82fb0b85d3b7a0f8de',7::bigint,2228.72189::numeric,16636432::numeric),
(16486::oid,5::oid,true,-9017596525321169182::bigint,'2026-11-06T00:15:05.398449+00:00'::timestamptz,'1458c591bb8b28d04032c2f30246a719',66::bigint,1676.158548::numeric,3646819::numeric),
(16486::oid,5::oid,true,-8961680761994232889::bigint,'2026-11-06T00:16:27.778437+00:00'::timestamptz,'50d37ba67682e2cc71164ed9983255bf',74::bigint,1725.864908::numeric,4046231::numeric),
(16486::oid,5::oid,true,-8941233958632192943::bigint,'2026-11-06T00:22:11.921820+00:00'::timestamptz,'cc2cf8201af1df037b8b57523dbc09cf',7::bigint,135.700064::numeric,276497::numeric),
(16486::oid,5::oid,true,-8466487304042180816::bigint,'2026-11-06T00:08:39.454980+00:00'::timestamptz,'4888d501bdd1858653dc5e696b6e52d3',22::bigint,3477.040875::numeric,2259216::numeric),
(16486::oid,5::oid,true,-8326794274885270921::bigint,'2026-11-06T00:14:56.486200+00:00'::timestamptz,'ec86b6c1fa0c46b5338e7ee05d706e92',27::bigint,1865.786401::numeric,2564927::numeric),
(16486::oid,5::oid,true,-7896369387059275141::bigint,'2026-11-06T00:59:57.307686+00:00'::timestamptz,'a3481ddfdbba279438940849278c1bab',7::bigint,96.787284::numeric,485653::numeric),
(16486::oid,5::oid,true,-7873309964624841588::bigint,'2026-11-06T13:09:45.495952+00:00'::timestamptz,'b3042501e7c49c48408e7b353f8d1121',1::bigint,10.077061::numeric,47591::numeric),
(16486::oid,5::oid,true,-7484128831795557172::bigint,'2026-11-06T00:09:17.660725+00:00'::timestamptz,'bf74ad0dbdad540c304a860703648fe4',496::bigint,19488.831519::numeric,76804749::numeric),
(16486::oid,5::oid,true,-7269086418534825522::bigint,'2026-11-06T00:15:32.924160+00:00'::timestamptz,'7d79496c9407c9bd96c245399edd9e4e',74::bigint,1529.695649::numeric,2777811::numeric),
(16486::oid,5::oid,true,-7005969626952731885::bigint,'2026-11-06T00:20:59.953248+00:00'::timestamptz,'e8a087d1d68feb0f6ff5a77c048dbfd9',32::bigint,520.244852::numeric,1135747::numeric),
(16486::oid,5::oid,true,-6848799815406525428::bigint,'2026-11-06T05:32:46.310100+00:00'::timestamptz,'0b84096ab8351439d73c26979f0fb68c',11::bigint,231.20724::numeric,498302::numeric),
(16486::oid,5::oid,true,-6408571764798647371::bigint,'2026-11-05T18:48:40.044730+00:00'::timestamptz,'9eafa83fd1a665e47d12953a612b802c',4575::bigint,68006.466397::numeric,128016774::numeric),
(16486::oid,5::oid,true,-6245491547807920623::bigint,'2026-11-06T00:49:55.074716+00:00'::timestamptz,'dcba9dea035ea3e7b2eb5f93119c3bd6',65::bigint,2137.385819::numeric,13098374::numeric),
(16486::oid,5::oid,true,-6242054255837609863::bigint,'2026-11-06T00:16:54.690740+00:00'::timestamptz,'1ffc6f6dbf18e34f384e09ea4561a7fc',191::bigint,4085.417463::numeric,8171790::numeric),
(16486::oid,5::oid,true,-6239865321800273815::bigint,'2026-11-06T00:12:48.864232+00:00'::timestamptz,'bee1532e9a0a96e706be45cf33ae6b03',132::bigint,2160.067353::numeric,4808115::numeric),
(16486::oid,5::oid,true,-6147673505380501498::bigint,'2026-11-06T00:48:13.180313+00:00'::timestamptz,'a98db2f66a8cb66e22113a789bde5838',12::bigint,238.789695::numeric,497520::numeric),
(16486::oid,5::oid,true,-5944120925022736952::bigint,'2026-11-06T07:29:53.016386+00:00'::timestamptz,'124fe62cb08dd9b75eee6f4452457790',3::bigint,40.962607::numeric,101884::numeric),
(16486::oid,5::oid,true,-5879775803191925830::bigint,'2026-11-06T00:28:32.101576+00:00'::timestamptz,'928187e17ad40074abf921717f337fc0',11::bigint,237.029186::numeric,553030::numeric),
(16486::oid,5::oid,true,-5865314087008095744::bigint,'2026-11-06T00:23:03.973357+00:00'::timestamptz,'ab87c436efb65a61f9ba8f72f1dbd5fb',33::bigint,672.434639::numeric,1140819::numeric),
(16486::oid,5::oid,true,-5502919940355336545::bigint,'2026-11-06T03:24:07.265976+00:00'::timestamptz,'e46e0c2fff7b3eccfde521b991b890dc',14::bigint,179.054291::numeric,491176::numeric),
(16486::oid,5::oid,true,-5438723947593814594::bigint,'2026-11-05T18:52:32.643312+00:00'::timestamptz,'eee7a6ad3555d59c7139b553cda8f44e',97::bigint,5357.646786::numeric,23916086::numeric),
(16486::oid,5::oid,true,-5382517092594230932::bigint,'2026-11-06T07:24:19.505898+00:00'::timestamptz,'be5ac40b7ab5dec0e91dbdffc050bee9',1::bigint,8.350123::numeric,30000::numeric),
(16486::oid,5::oid,true,-4910506429341774761::bigint,'2026-11-05T19:01:22.572043+00:00'::timestamptz,'99d59626420926172b23756f37848aaf',15::bigint,23.88059::numeric,23403::numeric),
(16486::oid,5::oid,true,-4831842545730498456::bigint,'2026-11-06T00:19:49.558200+00:00'::timestamptz,'404b76eede222175264c5ecd4f325bef',32::bigint,533.114267::numeric,1353101::numeric),
(16486::oid,5::oid,true,-4494831674088424873::bigint,'2026-11-06T00:08:15.175638+00:00'::timestamptz,'f6e2379e00cd97000a4b6afd8d1ccea3',3::bigint,41.846112::numeric,98258::numeric),
(16486::oid,5::oid,true,-4314786289579662363::bigint,'2026-11-06T00:08:14.595056+00:00'::timestamptz,'9d2433f6a6cbc904fc7afd6d2a009f84',7::bigint,126.604968::numeric,245735::numeric),
(16486::oid,5::oid,true,-4304378031524677348::bigint,'2026-11-06T00:08:13.207262+00:00'::timestamptz,'b90024136afb955b54702daf3f5cb6f0',3165::bigint,83268.498034::numeric,209591124::numeric),
(16486::oid,5::oid,true,-4258679261381200171::bigint,'2026-11-05T18:48:13.761119+00:00'::timestamptz,'a2b44932978bae79c8a4fe2c02587d72',167::bigint,4830.201432::numeric,8874618::numeric),
(16486::oid,5::oid,true,-4192549116569485261::bigint,'2026-11-06T01:48:44.270701+00:00'::timestamptz,'222f4d4f7c9d04f4313fe49b52737974',4::bigint,67.843781::numeric,227542::numeric),
(16486::oid,5::oid,true,-4001955326523898304::bigint,'2026-11-06T00:21:14.615941+00:00'::timestamptz,'e15f9a4aaba8f9f16e1373032b55d1d1',390::bigint,9112.29643699999::numeric,21812332::numeric),
(16486::oid,5::oid,true,-3954792694174310816::bigint,'2026-11-06T00:11:58.503636+00:00'::timestamptz,'257d704f2cb8a3b0d960112762a2e35f',99::bigint,1787.887642::numeric,3730028::numeric),
(16486::oid,5::oid,true,-3655432256717040365::bigint,'2026-11-06T04:03:44.856097+00:00'::timestamptz,'d795ba9776292721fd4fba17bf67d6c1',12::bigint,132.194052::numeric,467473::numeric),
(16486::oid,5::oid,true,-3507091764867901600::bigint,'2026-11-05T18:48:09.815818+00:00'::timestamptz,'4a3ad8bddd9e673dfc65fc39eca43ab4',359::bigint,13720.561877::numeric,16942521::numeric),
(16486::oid,5::oid,true,-3422599514789899442::bigint,'2026-11-06T00:16:25.438042+00:00'::timestamptz,'b6edf704650a8a6832b2676fba95a61c',41::bigint,915.513088::numeric,1877631::numeric),
(16486::oid,5::oid,true,-3303948960682640800::bigint,'2026-11-06T03:59:10.736319+00:00'::timestamptz,'dd456deb4cb879e78042e0a28ffbe274',2::bigint,51.914685::numeric,62646::numeric),
(16486::oid,5::oid,true,-2927287377355301244::bigint,'2026-11-06T00:09:12.087803+00:00'::timestamptz,'b7f41a96fc6395cb1df507c10d87ecc9',707::bigint,15826.360327::numeric,39319422::numeric),
(16486::oid,5::oid,true,-2819429450413652117::bigint,'2026-11-06T01:42:09.276545+00:00'::timestamptz,'693349b45417b9754aeeb655f8d4471f',12::bigint,189.773701::numeric,496386::numeric),
(16486::oid,5::oid,true,-2502114563959766181::bigint,'2026-11-06T01:21:54.218850+00:00'::timestamptz,'799c109481df722cae463e55e72f5d9a',28::bigint,652.856826::numeric,1411315::numeric),
(16486::oid,5::oid,true,-2200186808143858685::bigint,'2026-11-05T18:47:29.343259+00:00'::timestamptz,'559598c122d4df868403a2f773b68fc5',10412::bigint,41122.3862929999::numeric,93281525::numeric),
(16486::oid,5::oid,true,-2070279713701663720::bigint,'2026-11-06T00:10:43.333462+00:00'::timestamptz,'95b620216d21b68d60263b49aa49cd18',163::bigint,5819.449511::numeric,19393233::numeric),
(16486::oid,5::oid,true,-1969980033733005055::bigint,'2026-11-06T04:53:24.926459+00:00'::timestamptz,'e7c977aa2a4fbd35b2edfa61e40c3d94',2::bigint,24.203004::numeric,75891::numeric),
(16486::oid,5::oid,true,-1787413085175375188::bigint,'2026-11-06T06:29:49.282058+00:00'::timestamptz,'019974518c892907d3b9d8d6225457a2',1::bigint,6.892083::numeric,39454::numeric),
(16486::oid,5::oid,true,-1748760605386995987::bigint,'2026-11-06T04:25:43.128838+00:00'::timestamptz,'265f087ecc46de158ff873f8297e3dd1',1::bigint,8.892653::numeric,37366::numeric),
(16486::oid,5::oid,true,-1577899453088379820::bigint,'2026-11-06T00:08:16.274706+00:00'::timestamptz,'f98f1a16520664ff0bcaca2b8da100bc',10::bigint,253.584596::numeric,359127::numeric),
(16486::oid,5::oid,true,-1438250529780673745::bigint,'2026-11-06T05:06:26.211224+00:00'::timestamptz,'41f15f783434ac8eb0a989c4be6bc69b',1::bigint,8.413855::numeric,33919::numeric),
(16486::oid,5::oid,true,-1084662265968513224::bigint,'2026-11-06T01:07:48.742086+00:00'::timestamptz,'fc61eaed15a1a9d509cb097935adce22',23::bigint,372.764236::numeric,830528::numeric),
(16486::oid,5::oid,true,-915262630237522448::bigint,'2026-11-06T00:16:02.497007+00:00'::timestamptz,'f087ef4f6d352d0c63dd7be4cbf93f35',1::bigint,20.774849::numeric,68655::numeric),
(16486::oid,5::oid,true,-902179737999765571::bigint,'2026-11-06T05:55:55.269589+00:00'::timestamptz,'302a503b35b5e4045ac77b39a5202904',2::bigint,12.222325::numeric,65959::numeric),
(16486::oid,5::oid,true,-843219759530165751::bigint,'2026-11-06T03:05:09.185735+00:00'::timestamptz,'dfa86398fe8a04f87e5b5525a1106393',7::bigint,88.987017::numeric,231388::numeric),
(16486::oid,5::oid,true,-640555994218644254::bigint,'2026-11-05T18:48:09.280263+00:00'::timestamptz,'24009fb709d4e6bcee863190ac9765bc',3456::bigint,127127.183115::numeric,241505063::numeric),
(16486::oid,5::oid,true,-547816614327025824::bigint,'2026-11-06T00:10:13.486008+00:00'::timestamptz,'86b1767de923e3b940eae31a2cf6f748',146::bigint,5384.23840699999::numeric,8788207::numeric),
(16486::oid,5::oid,true,-239261862598665458::bigint,'2026-11-06T01:12:50.951647+00:00'::timestamptz,'43be64c1c08cd5913770c9b57472838a',3::bigint,56.802803::numeric,105831::numeric),
(16486::oid,5::oid,true,208596750615503049::bigint,'2026-11-06T12:54:14.331524+00:00'::timestamptz,'0330bc4a1c7e16401e23877b82b08b68',3::bigint,63.675587::numeric,75318::numeric),
(16486::oid,5::oid,true,334497333059683897::bigint,'2026-11-06T04:16:18.320155+00:00'::timestamptz,'4dd2a089beb6d8824f61b5824a4c1e3a',4::bigint,45.027166::numeric,149813::numeric),
(16486::oid,5::oid,true,475506692779349257::bigint,'2026-11-06T00:22:41.253659+00:00'::timestamptz,'26ba0234dfff8c8ab423a529168e2b62',20::bigint,567.785301::numeric,1137746::numeric),
(16486::oid,5::oid,true,705277641840117542::bigint,'2026-11-06T00:15:58.295307+00:00'::timestamptz,'c081f3c062d5ca3a4ff4d1d7b0564460',110::bigint,3564.135296::numeric,6684734::numeric),
(16486::oid,5::oid,true,1000855145226834041::bigint,'2026-11-06T02:52:34.753676+00:00'::timestamptz,'70eca9c5a55808e0fffdfaaf831544f3',4::bigint,151.989508::numeric,145832::numeric),
(16486::oid,5::oid,true,1124168971969388564::bigint,'2026-11-06T01:45:06.933102+00:00'::timestamptz,'692517688402d38fa194d1584b589e26',10::bigint,267.62171::numeric,392442::numeric),
(16486::oid,5::oid,true,1177612810051285035::bigint,'2026-11-06T00:29:25.963142+00:00'::timestamptz,'0c089fd3621695566c7136423e4de618',43::bigint,723.383745::numeric,1608363::numeric),
(16486::oid,5::oid,true,1184692672362122791::bigint,'2026-11-06T00:30:39.224138+00:00'::timestamptz,'c39ff01b7cc38deb96dda0192958876c',14::bigint,178.78124::numeric,474411::numeric),
(16486::oid,5::oid,true,1588314641296119643::bigint,'2026-11-06T04:03:27.149853+00:00'::timestamptz,'fd81cf64c0984eb7054378fd2a1b1af1',1::bigint,26.401841::numeric,31265::numeric),
(16486::oid,5::oid,true,1641219928534179206::bigint,'2026-11-06T13:14:29.537202+00:00'::timestamptz,'4f9fd84fcc09447e4db2f621e87e6f30',1::bigint,13.628086::numeric,44677::numeric),
(16486::oid,5::oid,true,2124443168785065583::bigint,'2026-11-06T02:54:36.251349+00:00'::timestamptz,'9a21c5e155401fbf3f422b7a47d17a82',7::bigint,1893.902068::numeric,829537::numeric),
(16486::oid,5::oid,true,2163437704359693681::bigint,'2026-11-06T00:08:12.611472+00:00'::timestamptz,'2f25da3bbc146450991f1ee4a51c6c2d',43::bigint,1141.417399::numeric,3055391::numeric),
(16486::oid,5::oid,true,2856223438621687395::bigint,'2026-11-06T00:35:46.781426+00:00'::timestamptz,'8552ec8f7ae0a21df8b3de0df27c6c90',14::bigint,217.489598::numeric,510968::numeric),
(16486::oid,5::oid,true,3048833575201425536::bigint,'2026-11-06T01:03:25.049960+00:00'::timestamptz,'5c675ac196f2e373399c323529742d0e',3::bigint,47.604972::numeric,118284::numeric),
(16486::oid,5::oid,true,3412073688407337363::bigint,'2026-11-06T02:48:44.172972+00:00'::timestamptz,'ecb171d8307a6bdef73a79acc6e85346',3::bigint,59.041645::numeric,112134::numeric),
(16486::oid,5::oid,true,3517010476282697109::bigint,'2026-11-06T00:08:52.158817+00:00'::timestamptz,'8b7852a4939cad16070d5e9d29b8d136',187::bigint,6401.829427::numeric,20633894::numeric),
(16486::oid,5::oid,true,3716691163661225676::bigint,'2026-11-06T05:24:39.881727+00:00'::timestamptz,'147866db335feed1bc2f1feca3d52e58',3::bigint,33.662391::numeric,129570::numeric),
(16486::oid,5::oid,true,3810614674675689294::bigint,'2026-11-06T02:58:15.434462+00:00'::timestamptz,'d1666f52e48257a9c217be7e0b1817cd',2::bigint,206.133321::numeric,61777::numeric),
(16486::oid,5::oid,true,3861406244619420224::bigint,'2026-11-06T00:08:01.972889+00:00'::timestamptz,'05dfb9e1119c57964a4dd6e9b7224c7b',17::bigint,285.19438::numeric,833909::numeric),
(16486::oid,5::oid,true,4224640302014661331::bigint,'2026-11-06T00:09:37.998505+00:00'::timestamptz,'5dc92abe71b75dd8e8bf113f1fa945f4',1261::bigint,37858.034653::numeric,99425021::numeric),
(16486::oid,5::oid,true,4331546407317557942::bigint,'2026-11-06T00:24:28.356845+00:00'::timestamptz,'c8f4c350a5a930af818b2e2ab56d4bcc',64::bigint,1042.437439::numeric,2552459::numeric),
(16486::oid,5::oid,true,4366325668843534194::bigint,'2026-11-06T00:55:07.923486+00:00'::timestamptz,'14657b7b76491c9ce31bcb00221b92a5',5::bigint,233.337121::numeric,296092::numeric),
(16486::oid,5::oid,true,4566193517266560170::bigint,'2026-11-06T00:08:55.977380+00:00'::timestamptz,'0d456e7495fe67f14a7f338a3692f0dd',234::bigint,4269.41579::numeric,9164758::numeric),
(16486::oid,5::oid,true,4656379995363957881::bigint,'2026-11-06T00:08:54.124161+00:00'::timestamptz,'d4ae4f9e2b0299a7623c06c1c6235da8',293::bigint,6820.02596299999::numeric,12107037::numeric),
(16486::oid,5::oid,true,5103179279542507912::bigint,'2026-11-06T00:27:35.463804+00:00'::timestamptz,'d58cd934b75f811c17055634f6f701fe',8::bigint,128.340598::numeric,307682::numeric),
(16486::oid,5::oid,true,5882761008113839173::bigint,'2026-11-06T00:11:31.738050+00:00'::timestamptz,'baa4a0357577e3b71f406c443a356787',90::bigint,1856.341492::numeric,3334305::numeric),
(16486::oid,5::oid,true,6348186856622729489::bigint,'2026-11-06T00:15:59.932422+00:00'::timestamptz,'8024227602248994b889d7666668ce6b',333::bigint,6002.47296400001::numeric,12292486::numeric),
(16486::oid,5::oid,true,6390571155030007981::bigint,'2026-11-06T00:37:36.939572+00:00'::timestamptz,'b000aff66e266be5ea2a657a9f22ddba',1::bigint,8.576733::numeric,43997::numeric),
(16486::oid,5::oid,true,6430535887002143036::bigint,'2026-11-05T18:48:15.345623+00:00'::timestamptz,'88dfeefb81ba5cf9194f7a4789c8d6f0',1548::bigint,60423.971969::numeric,133670919::numeric),
(16486::oid,5::oid,true,6458912639534504436::bigint,'2026-11-06T02:57:13.473095+00:00'::timestamptz,'e3633719032887decf6bb1709502faa0',2::bigint,256.725925::numeric,177470::numeric),
(16486::oid,5::oid,true,6525346080436693372::bigint,'2026-11-06T12:52:59.053402+00:00'::timestamptz,'0e7fdbcc2ac169260efe3085cb05d2d6',2::bigint,67.275483::numeric,122794::numeric),
(16486::oid,5::oid,true,6575264301875287876::bigint,'2026-11-06T03:32:00.793500+00:00'::timestamptz,'f132dab7e2124451433a943c697bd4a1',3::bigint,58.1485::numeric,164279::numeric),
(16486::oid,5::oid,true,6812761708967041595::bigint,'2026-11-05T19:01:01.915369+00:00'::timestamptz,'cc71dcc6c44f317dd5eff423c5f26ff5',4492::bigint,300749.299085999::numeric,362383780::numeric),
(16486::oid,5::oid,true,6862715532547800613::bigint,'2026-11-05T19:19:01.502149+00:00'::timestamptz,'261e8e433fb48828bdcca5f9cce162e0',7::bigint,11.695592::numeric,23189::numeric),
(16486::oid,5::oid,true,6907289670067793425::bigint,'2026-11-05T22:41:28.522161+00:00'::timestamptz,'0ba12bd6c20108cb0798a7be45092362',1::bigint,10.422951::numeric,26416::numeric),
(16486::oid,5::oid,true,7102525105374893662::bigint,'2026-11-06T03:50:34.202636+00:00'::timestamptz,'bbb6c0166ad025f3c8cd480c14116339',1::bigint,7.128603::numeric,28648::numeric),
(16486::oid,5::oid,true,7157218383272641504::bigint,'2026-11-06T05:33:25.666097+00:00'::timestamptz,'e79c43a49a4d62c9867f47dc374eb64f',2::bigint,17.887095::numeric,64167::numeric),
(16486::oid,5::oid,true,7184230990223857211::bigint,'2026-11-05T18:50:46.598198+00:00'::timestamptz,'5165a0b5a7fd1d2600da4b38194a2704',12::bigint,734.207297::numeric,781189::numeric),
(16486::oid,5::oid,true,7373199178642469211::bigint,'2026-11-06T07:21:52.524518+00:00'::timestamptz,'98263d568034e6d52a769f286bf6e339',2::bigint,34.191044::numeric,93380::numeric),
(16486::oid,5::oid,true,7416563968712206808::bigint,'2026-11-06T01:32:21.365732+00:00'::timestamptz,'6b7dbecd9ed7cb887ea000cca8a522dd',7::bigint,141.429289::numeric,255260::numeric),
(16486::oid,5::oid,true,7705498216029115749::bigint,'2026-11-06T10:44:21.080258+00:00'::timestamptz,'86fb32c3415eae6518300b611abc5d23',1::bigint,52.379723::numeric,84335::numeric),
(16486::oid,5::oid,true,7861259013639822521::bigint,'2026-11-06T00:08:47.857051+00:00'::timestamptz,'e1f325a348bdd34194f75d67b56bf405',117::bigint,2043.260113::numeric,5021926::numeric),
(16486::oid,5::oid,true,8265133757273375558::bigint,'2026-11-06T00:09:10.244028+00:00'::timestamptz,'22a63c7a7a651f6f404c92aecfefab58',1094::bigint,37900.431677::numeric,75080085::numeric),
(16486::oid,5::oid,true,8490969820363252347::bigint,'2026-11-06T01:14:44.203119+00:00'::timestamptz,'d53c34d572fc807ea548cc29fb5b4b71',18::bigint,269.713079::numeric,652265::numeric),
(16486::oid,5::oid,true,8695287796313115953::bigint,'2026-11-05T18:46:40.737330+00:00'::timestamptz,'a10e6e6d35b0b1703ca64ef1edf58323',10670::bigint,52802.1958349999::numeric,126940657::numeric),
(16486::oid,5::oid,true,9087026206194055037::bigint,'2026-11-06T04:27:52.418959+00:00'::timestamptz,'8d01a34c2fb4b7e35565dcfebb205750',8::bigint,94.320345::numeric,379762::numeric),
(16486::oid,5::oid,true,9167753408413234353::bigint,'2026-11-06T03:20:48.776464+00:00'::timestamptz,'cd6539f9e7fa2a1ea7f6d2f87239e51f',6::bigint,71.733818::numeric,208055::numeric)
 )v(userid,dbid,toplevel,queryid,stats_since,query_md5,calls,total_exec_time,wal_bytes)
), query_stats as (
 select userid,dbid,toplevel,queryid,stats_since,md5(query) query_md5,calls,total_exec_time::text::numeric,wal_bytes::text::numeric
 from extensions.pg_stat_statements
 -- Exact authentic PRE collector: no role/database/top-level restriction or LIMIT.
 where query ilike 'with pgrst_source as (update "public"."assets"%'
), family_proof as (
 select
  (select count(*) from baseline_family)=b.family_entry_count and b.family_entry_count>0
  and (select md5(string_agg(row(userid,dbid,toplevel,queryid,extract(epoch from stats_since),query_md5,calls,total_exec_time,wal_bytes)::text,
    E'\n' order by userid,dbid,toplevel,queryid)) from baseline_family)=b.family_vector_md5
  and not exists(select from baseline_family where userid is null or dbid is null or toplevel is null or queryid is null
    or stats_since is null or stats_since>b.observed_at or query_md5 is null or query_md5 !~ '^[0-9a-f]{32}$'
    or calls is null or calls<0 or total_exec_time is null or total_exec_time<0
    or total_exec_time::text in ('NaN','Infinity','-Infinity') or wal_bytes is null or wal_bytes<0
    or wal_bytes::text in ('NaN','Infinity','-Infinity'))
  and not exists(select from baseline_family group by userid,dbid,toplevel,queryid having count(*)<>1)
  and not exists(select from query_stats group by userid,dbid,toplevel,queryid having count(*)<>1)
  and not exists(select from baseline_family f where not exists(select from query_stats q
    where (q.userid,q.dbid,q.toplevel,q.queryid)=(f.userid,f.dbid,f.toplevel,f.queryid)
      and q.stats_since=f.stats_since and q.query_md5=f.query_md5
      and q.calls>=f.calls and q.total_exec_time>=f.total_exec_time and q.wal_bytes>=f.wal_bytes))
  and not exists(select from query_stats q where q.userid is null or q.dbid is null or q.toplevel is null or q.queryid is null
    or q.stats_since is null or q.query_md5 is null or q.query_md5 !~ '^[0-9a-f]{32}$'
    or q.calls is null or q.calls<0 or q.total_exec_time is null or q.total_exec_time<0
    or q.total_exec_time::text in ('NaN','Infinity','-Infinity') or q.wal_bytes is null or q.wal_bytes<0
    or q.wal_bytes::text in ('NaN','Infinity','-Infinity')
    or (not exists(select from baseline_family f where
      (q.userid,q.dbid,q.toplevel,q.queryid)=(f.userid,f.dbid,f.toplevel,f.queryid)) and q.stats_since<b.observed_at)) as valid,
  (select sum(q.calls-coalesce(f.calls,0)) from query_stats q left join baseline_family f using(userid,dbid,toplevel,queryid)) as calls,
  (select sum(q.total_exec_time-coalesce(f.total_exec_time,0)) from query_stats q left join baseline_family f using(userid,dbid,toplevel,queryid)) as total_exec_time,
  (select sum(q.wal_bytes-coalesce(f.wal_bytes,0)) from query_stats q left join baseline_family f using(userid,dbid,toplevel,queryid)) as wal_bytes
 from baseline b
), table_stats as (
 select
  (select n_tup_upd from pg_stat_user_tables where relid='public.assets'::regclass) as asset_updates,
  (select n_tup_upd from pg_stat_user_tables where relid='public.dam_search_documents'::regclass) as document_updates
), expected as (
 select * from (values
  ('trg_auto_queue_render','public.auto_queue_render()',17,array['6d292c5ad846cc05bb3290b926bf1d20','f4a2b5b6f5877746b78d4058f55835bb']),
  ('trg_auto_queue_render_ins_del','public.auto_queue_render()',5,array['caa4f524dd84c8e24d36fc8d68c59c89']),
  ('trg_dam_search_assets_refresh','public.trg_refresh_dam_asset_search_document()',17,array['3adf740fb4f20406f6620052b23e28c3','543a6d307f7d8cb6f17c1ae4c83bdd6a']),
  ('trg_dam_search_assets_refresh_ins_del','public.trg_refresh_dam_asset_search_document()',13,array['9fb1930126a935df0ff11d05bbcfdd4b']),
  ('trg_sync_cover_description_to_style_group','public.sync_cover_description_to_style_group()',17,array['dac32eaf299fd77dfa9ac6827a18211a','9711807e2187b18a28d47bf567089328']),
  ('trg_sync_cover_description_to_style_group_ins_del','public.sync_cover_description_to_style_group()',5,array['b4ddc43b9e60e91649c6fca65ad10f6e']),
  ('trg_sync_designer_to_style_group','public.sync_designer_to_style_group()',17,array['a2037258e3fd300113b8489f25ee62a9','ad1e03640d8163a324e9a7d54db77d6f']),
  ('trg_sync_designer_to_style_group_ins_del','public.sync_designer_to_style_group()',5,array['24a12b32508aee5a6b24075d011e6897']),
  ('trg_sync_primary_on_thumbnail','public.sync_primary_asset_on_thumbnail()',17,array['224aa60d20a0b9f58a052b6f603598b8','28c25be1dbde678c718bc372439edeb4']),
  ('trg_sync_primary_on_thumbnail_ins_del','public.sync_primary_asset_on_thumbnail()',5,array['f7870cdb13d8aedf4901696cf1bc5622'])
 )e(trigger_name,function_name,event_type,definition_md5s)
), recent as (
 select a.* from public.assets a tablesample system(1) repeatable(5609) cross join baseline b
 where not a.is_deleted and a.last_seen_at>=greatest(b.observed_at,now()-interval '24 hours')
   and a.last_seen_at<=now() limit 3
), metadata_source as (
 select a.id,a.modified_at,a.file_size,a.thumbnail_url,
  d.metadata as actual_metadata,d.indexed_at,d.source_updated_at,q.render_completed_at as current_queue_render,d.embedding_lease_token,d.embedding_lease_owner,d.embedding_lease_expires_at,
  jsonb_strip_nulls(jsonb_build_object(
   'file_type',a.file_type,'asset_type',a.asset_type,'content_type',a.content_type,
   'item_description',sg.item_description,'group_ai_description',sg.group_ai_description,
   'product_material',a.product_material,'product_dimensions',a.product_dimensions,
   'workflow_status',a.workflow_status,'is_licensed',a.is_licensed,
   'licensor_name',case when a.style_group_id is null then a.licensor_name else sg.licensor_name end,
   'property_name',case when a.style_group_id is null then a.property_name else sg.property_name end,
   'product_category',a.product_category,'thumbnail_url',a.thumbnail_url)) as core_metadata,
  -- #05074126 retains a previous completed render after queue retention.
  -- Invalid JSON dates abstain; never invoke its service-only VOLATILE helper.
  greatest(q.render_completed_at,case
    when d.metadata->'_embedding_input'->>'asset_id'=a.id::text
     and pg_input_is_valid(d.metadata->'_embedding_input'->>'render_completed_at','timestamp with time zone')
    then (d.metadata->'_embedding_input'->>'render_completed_at')::timestamptz end) as retained_render,
  coalesce(not coalesce(d.metadata->'_embedding_input' ? 'render_completed_at',false) or
    (jsonb_typeof(d.metadata->'_embedding_input'->'render_completed_at')='string'
     and pg_input_is_valid(d.metadata->'_embedding_input'->>'render_completed_at','timestamp with time zone')),false) as render_valid
 from recent a left join public.style_groups sg on sg.id=a.style_group_id
 left join public.dam_search_documents d on d.document_type='asset' and d.entity_id=a.id
 left join lateral(select rq.completed_at as render_completed_at from public.render_queue rq
    where rq.asset_id=a.id and rq.status='completed' and rq.completed_at is not null
    order by rq.completed_at desc limit 1)q on true
), provenance_input as (
 select m.*,case when nullif(btrim(thumbnail_url),'') is not null
    and (modified_at is not null or retained_render is not null)
  then jsonb_strip_nulls(jsonb_build_object(
   'version',1,'model','google/siglip2-base-patch16-naflex','image_transform','uncropped-thumbnail',
   'asset_id',id,'thumbnail_url',thumbnail_url,
   -- Match the authoritative helper's SET timezone=UTC JSON encoding without SET.
   'source_modified_at',case when modified_at is null then null when isfinite(modified_at)
     then (to_jsonb(modified_at at time zone 'UTC') #>> '{}')||'+00:00' else modified_at::text end,
   'source_file_size',file_size,
   'render_completed_at',case when retained_render is null then null when isfinite(retained_render)
     then (to_jsonb(retained_render at time zone 'UTC') #>> '{}')||'+00:00' else retained_render::text end)) end as expected_input_base
 from metadata_source m
), metadata_checked as (
 select p.*,
  -- Grandfather only unchanged pre-cutover documents; present JSON NULL is not absence.
  coalesce(not (actual_metadata ? '_embedding_input')
    and indexed_at<'2026-11-05T07:30:57-05:00'::timestamptz
    and source_updated_at<'2026-11-05T07:30:57-05:00'::timestamptz
    and (modified_at is null or (modified_at<=indexed_at and modified_at<=source_updated_at))
    and (current_queue_render is null or
      (current_queue_render<=indexed_at and current_queue_render<=source_updated_at)),false) as legacy_unchanged,
  case when expected_input_base is not null then
    expected_input_base||jsonb_build_object('sha256',encode(extensions.digest(expected_input_base::text,'sha256'),'hex')) end as expected_input,
  case when embedding_lease_token is null then
    embedding_lease_owner is null and embedding_lease_expires_at is null
      and not (actual_metadata ? '_embedding_lease_input_sha256')
   else nullif(btrim(embedding_lease_owner),'') is not null
    and embedding_lease_expires_at is not null and isfinite(embedding_lease_expires_at)
    and jsonb_typeof(actual_metadata->'_embedding_lease_input_sha256')='string'
    and (actual_metadata->>'_embedding_lease_input_sha256') ~ '^[0-9a-f]{64}$' end as lease_valid
 from provenance_input p
), current_metadata as (
 select count(*) as checked,
  bool_and(coalesce(render_valid and lease_valid
    and actual_metadata is not distinct from
      core_metadata||case when expected_input is null or legacy_unchanged then '{}'::jsonb
        else jsonb_build_object('_embedding_input',expected_input) end
      ||case when embedding_lease_token is null then '{}'::jsonb else
        jsonb_build_object('_embedding_lease_input_sha256',actual_metadata->'_embedding_lease_input_sha256') end,false)) as all_match
 from metadata_checked
)
select case
 when b.observed_at is null or b.family_entry_count is null or b.family_vector_md5 is null
   or b.statement_dealloc is null or b.asset_updates is null or b.document_updates is null
   or b.statement_stats_reset is null or b.postmaster_started_at is null
   or now()<b.observed_at+interval '24 hours' then false
 else coalesce(
  b.asset_relid=to_regclass('public.assets')::oid
  and b.document_relid=to_regclass('public.dam_search_documents')::oid
  and current_user='supabase_read_only_user'
  and pg_has_role(current_user,'pg_read_all_stats','member')
  and not exists(select 1 from unnest(array[
    'public.assets','public.style_groups','public.dam_search_documents',
    'extensions.pg_stat_statements','extensions.pg_stat_statements_info','public.render_queue',
    'supabase_migrations.schema_migrations'])r(rel)
    where not has_table_privilege(current_user,rel,'select'))
  and pg_postmaster_start_time()=b.postmaster_started_at
  and (select stats_reset from extensions.pg_stat_statements_info)=b.statement_stats_reset
  and (select dealloc from extensions.pg_stat_statements_info)=b.statement_dealloc
  and (select stats_reset from pg_stat_database where datname=current_database())
      is not distinct from b.database_stats_reset
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261105033827')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261105074126')
  and exists(select from family_proof f where f.valid and f.calls>=100
    and f.total_exec_time/nullif(f.calls,0)<b.pre_mean_ms*0.5
    and f.wal_bytes/nullif(f.calls,0)<b.pre_wal_per_call*0.5)
  and exists(select 1 from table_stats t where t.asset_updates>b.asset_updates
    and t.document_updates>=b.document_updates
    and (t.document_updates-b.document_updates)
        /extract(epoch from now()-b.observed_at)<b.pre_document_updates_per_second)
  and (select count(*) from expected)=10
  and not exists(select 1 from expected e where not exists(
    select 1 from pg_trigger t where t.tgrelid=to_regclass('public.assets')
      and t.tgname=e.trigger_name and t.tgtype=e.event_type and t.tgenabled='O'
      and not t.tgisinternal and not t.tgdeferrable and not t.tginitdeferred
      and t.tgnargs=0 and t.tgattr=''::int2vector
      and (t.tgqual is not null)=(e.event_type=17)
      and t.tgfoid=to_regprocedure(e.function_name)
      and md5(split_part(pg_get_triggerdef(t.oid,false),' EXECUTE FUNCTION ',1))=any(e.definition_md5s)))
  and (select count(*) from pg_trigger where tgrelid=to_regclass('public.assets')
    and tgfoid in(select to_regprocedure(function_name) from expected))=10
  and (select count(*) from pg_trigger where tgrelid=to_regclass('public.assets')
    and tgfoid in(select to_regprocedure(function_name) from expected) and tgtype=17)=5
  and (select count(*) from pg_trigger where tgrelid=to_regclass('public.assets')
    and tgfoid in(select to_regprocedure(function_name) from expected) and tgtype in(5,13))=5
  and exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.assets')
    and t.tgname='trg_assets_enqueue_image_embed' and t.tgenabled='O' and t.tgtype=21
    and not t.tgisinternal and not t.tgdeferrable and not t.tginitdeferred and t.tgnargs=0
    and t.tgqual is null and t.tgfoid=to_regprocedure('dam.assets_enqueue_image_embed_trg_fn()')
    and t.tgattr::text=(select attnum::text from pg_attribute
      where attrelid=to_regclass('public.assets') and attname='thumbnail_url' and not attisdropped))
  and not exists(select 1 from public.style_groups sg join lateral(
      select a.thumbnail_url,a.thumbnail_error from public.assets a where a.id=sg.primary_asset_id limit 1
    )a on true where sg.primary_asset_id is not null
      and (sg.primary_thumbnail_url is distinct from a.thumbnail_url
           or sg.primary_thumbnail_error is distinct from a.thumbnail_error))
  and (select checked=3 and all_match from current_metadata)
 ,false)
end as passed
from baseline b;
