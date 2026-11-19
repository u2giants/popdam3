-- CRM contact update, approved 18-argument clear-field shape — create-only
-- split of the third re-issue hop (final deliverable for popcrm-web #39).
-- Claim: popcrm-web issue #39, comment 7000442240 (the object's claim
-- thread), folded into popcre/shared-db#6820, comments 7010998738 /
-- 7015456372 / 7013547874 (2026-11-19). Version 20261225010406 reserved
-- atomically (refs/db-claims).
--
-- WHY A CREATE-ONLY FILE: the single-file hops 20261225010104 (PR #6840) and
-- 20261225010304 (PR #6845) each hard-referenced api.crm_update_contact
-- (grant/revoke/comment) while the merged tree's latest event for that name
-- is a drop by an unappliable stranded version, so the local #609 F5 tree
-- walk demands a restores-retired-object declaration naming that stranded
-- dropper, while the production preflight (which walks only the PRODUCTION
-- ledger, where no drop of this name is recorded) refuses exactly that
-- declaration — run 44577050283: "declares api.crm_update_contact was
-- dropped by 20261225010104, but history shows no recorded prior drop".
-- No single file can satisfy both walks. A CREATE-ONLY file holds no hard
-- reference and no drop, so it clears the walked removal state for the name,
-- letting the companion grants/drop file 20261225010407 reference it with no
-- declaration at all — both walks agree from there on (any future dropper
-- will be an APPLIED version).
--
-- CONTENT: the complete approved 18-argument function body, byte-identical
-- to the CREATE block of 20261225010304 (clear precedence, crm_create_contact
-- normalization parity, SECURITY DEFINER, app.has_app_access('crm') gate).
-- Preview: no-op (same shape already rehearsed). Production: creates the
-- clear-field function. Its ACL is closed by 20261225010407 in the same
-- batch; the in-body access gate raises for unauthorized callers even in the
-- seconds between the two files.
--
-- derived-from: none

CREATE OR REPLACE FUNCTION api.crm_update_contact(p_contact_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid, p_crm_department_id uuid DEFAULT NULL::uuid, p_contact_type text DEFAULT NULL::text, p_scope text DEFAULT NULL::text, p_clear_company boolean DEFAULT false, p_clear_crm_department boolean DEFAULT false, p_clear_contact_type boolean DEFAULT false, p_clear_scope boolean DEFAULT false, p_clear_email boolean DEFAULT false, p_clear_phone boolean DEFAULT false, p_clear_job_title boolean DEFAULT false)
 RETURNS core.contact
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'core', 'crm', 'public'
AS $function$
declare
  result core.contact;
  v_dept_company uuid;
  -- Same normalization as api.crm_create_contact (20261106144600): trim (and
  -- for email lowercase) before storing, so both RPCs write identical shapes.
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_title text := nullif(btrim(coalesce(p_job_title, '')), '');
begin
  if not app.has_app_access('crm') then
    raise exception 'crm: not authorized' using errcode = 'insufficient_privilege';
  end if;

  if p_crm_department_id is not null then
    select d.company_id into v_dept_company
    from crm.department d
    where d.id = p_crm_department_id;

    if v_dept_company is null then
      raise exception 'crm: department % not found', p_crm_department_id using errcode = 'no_data_found';
    end if;

    if p_company_id is not null and p_company_id <> v_dept_company then
      raise exception 'crm: department % belongs to a different company', p_crm_department_id using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- Precedence: a p_clear_* flag beats a same-call value. Passing both is
  -- defined as "clear" (the value is ignored), which also keeps the
  -- auto-attach trigger from ever seeing an address on a clearing save.
  update core.contact ct
  set
    first_name = coalesce(p_first_name, ct.first_name),
    last_name  = coalesce(p_last_name, ct.last_name),
    full_name  = coalesce(
      p_full_name,
      nullif(trim(concat_ws(' ', coalesce(p_first_name, ct.first_name), coalesce(p_last_name, ct.last_name))), ''),
      ct.full_name
    ),
    email      = case when p_clear_email then null else coalesce(v_email::extensions.citext, ct.email) end,
    phone      = case when p_clear_phone then null else coalesce(v_phone, ct.phone) end,
    title      = case when p_clear_job_title then null else coalesce(v_title, ct.title) end
  where ct.id = p_contact_id
  returning ct.* into result;

  if not found then
    raise exception 'crm: contact % not found', p_contact_id using errcode = 'no_data_found';
  end if;

  if p_clear_company then
    delete from core.contact_company cc
    where cc.contact_id = p_contact_id
      and cc.relationship_type = 'buyer';
  end if;

  if p_company_id is not null then
    update core.contact_company cc
    set is_primary = false
    where cc.contact_id = p_contact_id
      and cc.relationship_type = 'buyer'
      and cc.company_id <> p_company_id;

    insert into core.contact_company (
      contact_id,
      company_id,
      relationship_type,
      contact_type,
      scope,
      crm_department_id,
      is_primary
    )
    values (
      p_contact_id,
      p_company_id,
      'buyer',
      case when p_clear_contact_type then null else p_contact_type end,
      case
        when p_clear_scope then null
        when p_scope is not null then p_scope
        when p_crm_department_id is not null then 'DEPARTMENT'
        else null
      end,
      case when p_clear_crm_department then null else p_crm_department_id end,
      true
    )
    on conflict (contact_id, company_id, relationship_type) do update
    set
      contact_type = case
        when p_clear_contact_type then null
        when excluded.contact_type is not null then excluded.contact_type
        else core.contact_company.contact_type
      end,
      scope = case
        when p_clear_scope then null
        when p_scope is not null then p_scope
        when p_crm_department_id is not null then 'DEPARTMENT'
        when p_clear_crm_department and core.contact_company.scope = 'DEPARTMENT' then 'COMPANY_WIDE'
        else core.contact_company.scope
      end,
      crm_department_id = case
        when p_clear_crm_department then null
        when excluded.crm_department_id is not null then excluded.crm_department_id
        else core.contact_company.crm_department_id
      end,
      is_primary = true;
  elsif not p_clear_company and (
    p_clear_crm_department
    or p_clear_contact_type
    or p_clear_scope
    or p_crm_department_id is not null
    or p_contact_type is not null
    or p_scope is not null
  ) then
    update core.contact_company cc
    set
      contact_type = case
        when p_clear_contact_type then null
        when p_contact_type is not null then p_contact_type
        else cc.contact_type
      end,
      scope = case
        when p_clear_scope then null
        when p_scope is not null then p_scope
        when p_crm_department_id is not null then 'DEPARTMENT'
        when p_clear_crm_department and cc.scope = 'DEPARTMENT' then 'COMPANY_WIDE'
        else cc.scope
      end,
      crm_department_id = case
        when p_clear_crm_department then null
        when p_crm_department_id is not null then p_crm_department_id
        else cc.crm_department_id
      end
    where cc.id = (
      select x.id
      from core.contact_company x
      where x.contact_id = p_contact_id
        and x.relationship_type = 'buyer'
      order by x.is_primary desc nulls last, x.id
      limit 1
    );

    -- A department-only call for a contact with no buyer relation row used to
    -- land here, match nothing, and still report success. Create the row from
    -- the department's own company, the same inherit rule the flyout applies.
    -- (p_contact_type-only / p_scope-only calls on a relation-less contact stay
    -- intentional no-ops: there is no relation row to carry them.)
    if not found and p_crm_department_id is not null then
      insert into core.contact_company (
        contact_id,
        company_id,
        relationship_type,
        contact_type,
        scope,
        crm_department_id,
        is_primary
      )
      values (
        p_contact_id,
        v_dept_company,
        'buyer',
        case when p_clear_contact_type then null else p_contact_type end,
        case
          when p_clear_scope then null
          when p_scope is not null then p_scope
          else 'DEPARTMENT'
        end,
        case when p_clear_crm_department then null else p_crm_department_id end,
        not exists (
          select 1 from core.contact_company x
          where x.contact_id = p_contact_id
            and x.relationship_type = 'buyer'
            and x.is_primary
        )
      );
    end if;
  end if;

  return result;
end;
$function$;
