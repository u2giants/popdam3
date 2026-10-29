-- Adds DDPVA to the routing map. ColdLion's own /orderHistory warehouseDesc for
-- it is "DDP Virginia" (Lidl SOs 7127994, 7128095, 7128135, read 2026-10-28),
-- the same DDP + state family as DDPNJ/DDPMD/DDPPA/DDPOH/DDPNC/DDPCA/DDPGA.
-- Those orders sat quarantined as unknown-routing-code; the decode step's
-- release then returns them to pending on the next intake run.
begin;

insert into coldlion.sync_run (id, endpoint, company_code, request_params, status, requested_by, started_at, finished_at, notes)
select gen_random_uuid(), '/orderHistory', 'POP',
       jsonb_build_object('step', '20261028-routing-code-ddpva', 'preimage',
         (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from coldlion.routing_code_map m where m.code = 'DDPVA')),
       'succeeded', 'coldlion-order-intake', now(), now(), 'routing code DDPVA (DDP Virginia)';

insert into coldlion.routing_code_map (code, description, order_type, ship_to, is_poe_ddp_family, notes)
values ('DDPVA', 'DDP Virginia', 'DDP', 'VA', true,
        'ColdLion warehouseDesc "DDP Virginia" (Lidl SOs 7127994/7128095/7128135), added 2026-10-28')
on conflict (code) do nothing;

commit;
