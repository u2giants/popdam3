-- 20260727180000_designer_roster_pinilla_merge_and_creative_adds.sql
--
-- Designer roster cleanup requested by Albert on 2026-07-27 (PopDAM Master Data).
--
-- Data-only migration. No DDL. Three independent cleanups:
--
--  1. "Jessica Pinilla" and "Alejandra Pinilla" are the SAME person; Alejandra
--     is the correct name. core.technical_designer has no foreign keys pointing
--     at it -- every reference in the DAM is a free-text name string in
--     public.assets and public.style_groups. So the merge is a string rewrite
--     plus a roster delete.
--
--     Every spelling variant of the surname found in production on 2026-07-27
--     collapses to the canonical "Alejandra Pinilla":
--       Jessica Pinilla / JESSICA PINILLA  (the merge)
--       ALEJANDRA PINILLA                  (casing)
--       ASSOCA PINILLA / JOSKA PINILLA / RSCA Pinilla / SUSCA PINILLA  (bad OCR)
--       Deborah Pinilla                    (confirmed by Albert: no such person)
--     The predicate is `ilike '%pinilla%'`, which deliberately does NOT touch
--     "Jessica Cortazar" -- she is a distinct, real person.
--
--  2. "Martina Cardoso" is a CREATIVE designer that leaked into
--     core.technical_designer. Verified unreferenced as a technical designer
--     (zero '%cardoso%' matches in assets, style_groups, or any jsonb payload),
--     and she already exists correctly in core.creative_designer. Delete the
--     stray technical row only.
--
--  3. Add three new creative designers to core.creative_designer.
--
-- Note on public.style_groups: its designer_name / technical_designer_name /
-- freelancer_name columns are DERIVED from public.assets by trigger
-- trg_sync_designer_to_style_group, so the asset rewrites below cascade on their
-- own. The style_groups statements are a corrective sweep for groups whose
-- assets are soft-deleted or missing, which the trigger would never revisit.

begin;

-- 1a. Canonicalize every Pinilla spelling on assets.
update public.assets
set designer_name = 'Alejandra Pinilla'
where designer_name ilike '%pinilla%'
  and designer_name is distinct from 'Alejandra Pinilla';

update public.assets
set technical_designer_name = 'Alejandra Pinilla'
where technical_designer_name ilike '%pinilla%'
  and technical_designer_name is distinct from 'Alejandra Pinilla';

update public.assets
set freelancer_name = 'Alejandra Pinilla'
where freelancer_name ilike '%pinilla%'
  and freelancer_name is distinct from 'Alejandra Pinilla';

-- 1b. Corrective sweep for style_groups rows the asset trigger cannot reach.
update public.style_groups
set designer_name = 'Alejandra Pinilla'
where designer_name ilike '%pinilla%'
  and designer_name is distinct from 'Alejandra Pinilla';

update public.style_groups
set technical_designer_name = 'Alejandra Pinilla'
where technical_designer_name ilike '%pinilla%'
  and technical_designer_name is distinct from 'Alejandra Pinilla';

update public.style_groups
set freelancer_name = 'Alejandra Pinilla'
where freelancer_name ilike '%pinilla%'
  and freelancer_name is distinct from 'Alejandra Pinilla';

-- 1c. Retire the duplicate roster entry. Alejandra Pinilla stays.
delete from core.technical_designer
where normalized_name = 'jessica pinilla';

-- 2. Remove the creative designer that leaked into the technical roster.
delete from core.technical_designer
where normalized_name = 'martina cardoso';

-- 3. New creative designers.
insert into core.creative_designer (name)
values
  ('Violette Avouac'),
  ('Andre Manoel'),
  ('Maria Williams')
on conflict (normalized_name) do nothing;

-- Guard: the canonical technical designer must survive, and neither retired
-- roster entry may remain.
do $$
begin
  if not exists (
    select 1 from core.technical_designer where normalized_name = 'alejandra pinilla'
  ) then
    raise exception 'core.technical_designer is missing the canonical Alejandra Pinilla row';
  end if;

  if exists (
    select 1 from core.technical_designer
    where normalized_name in ('jessica pinilla', 'martina cardoso')
  ) then
    raise exception 'retired technical_designer rows still present';
  end if;

  if (
    select count(*) from core.creative_designer
    where normalized_name in ('violette avouac', 'andre manoel', 'maria williams')
  ) <> 3 then
    raise exception 'expected all three new creative designers to exist';
  end if;
end
$$;

commit;
