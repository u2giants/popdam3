begin;

insert into core.freelance_designer (name)
values ('Eduarda Costa')
on conflict (normalized_name) do update
set
  name = excluded.name,
  status = 'active',
  updated_at = now();

delete from core.creative_designer
where normalized_name = lower(regexp_replace(btrim('Eduarda Costa'), '\s+', ' ', 'g'));

commit;
