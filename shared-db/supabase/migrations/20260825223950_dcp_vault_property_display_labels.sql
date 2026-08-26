-- Issue #1546: derive presentation-only DCP Vault labels from the terminal
-- source-id slug when the source does not provide a display name. Source IDs,
-- landing rows, provenance, and all non-target source fallbacks remain unchanged.

create or replace function api.db_data_admin_scraped_properties(
  p_search text default null::text,
  p_cursor text default null::text,
  p_page_size integer default null::integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app', 'public'
as $function$
declare
  v_page_size integer;
  v_cursor_key text;
  v_rows jsonb;
  v_fetched integer;
  v_last_key text;
  v_next_cursor text;
begin
  -- Authorization and licensed-source reads remain one server-side operation.
  perform app.require_licensing_manager_access();

  v_page_size := least(greatest(coalesce(p_page_size, 500), 1), 1000);

  if p_cursor is not null then
    begin
      v_cursor_key := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    exception when others then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_key is null or v_cursor_key = '' then
      raise exception 'db_data_admin: invalid cursor'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with pmt_ranked as (
    select p.*,
           row_number() over (
             partition by p.property_source_id
             order by c.completed_at desc nulls last,
                      p.imported_at desc,
                      p.capture_id::text desc
           ) as capture_rank
    from plm.pmt_property p
    join plm.pmt_capture c on c.capture_id = p.capture_id
    where c.status = 'complete'
      and c.capture_kind = 'full'
  ), nbcu_ranked as (
    select p.*,
           row_number() over (
             partition by p.property_key
             order by c.source_captured_at desc,
                      p.source_captured_at desc,
                      p.capture_id::text desc
           ) as capture_rank
    from plm.nbcu_property p
    join plm.nbcu_capture c on c.id = p.capture_id
    where c.status = 'complete'
  ), sega_ranked as (
    select
      p.*,
      l.licensor_label,
      l.normalized_licensor_label,
      row_number() over (
        partition by p.property_source_id, l.normalized_licensor_label
        order by c.source_captured_at desc, p.capture_id::text desc, l.licensor_ordinal
      ) as capture_rank
    from plm.sega_property p
    join plm.sega_capture c on c.id = p.capture_id
    left join plm.sega_property_licensor l
      on l.capture_id = p.capture_id
     and l.property_source_id = p.property_source_id
    where c.status = 'complete'
  ), source_rows as (
    select
      'disney-opa-unsplit'::text as presentation_licensor_key,
      'Disney OPA (unsplit)'::text as presentation_licensor_name,
      'disney_opa'::text as source_system,
      'plm.opa_property'::text as source_table,
      p.licensed_property_id::text as source_property_id,
      p.property_name::text as source_property_name,
      null::text as source_status,
      'portal_property_vocabulary'::text as provenance_kind,
      p.last_seen_at::timestamptz as latest_seen_at,
      null::text as capture_marker
    from plm.opa_property p

    union all
    select 'disney', 'Disney', p.source_system, 'plm.dcp_property',
           p.source_id, p.display_name, null,
           'metadata_properties_array', null::timestamptz,
           p.last_seen_metadata_run_id::text
    from plm.dcp_property p

    union all
    select 'marvel', 'Marvel', p.source_system, 'plm.marvel_dcp_property',
           p.source_id, p.display_name, null,
           'metadata_properties_array', null::timestamptz,
           p.last_seen_metadata_run_id::text
    from plm.marvel_dcp_property p

    union all
    -- The authorized capture workstream scopes this portal section to Star Wars;
    -- the source system remains Lucasfilm so presentation never erases provenance.
    select 'star-wars', 'Star Wars', p.source_system, 'plm.lucasfilm_dcp_property',
           p.source_id, p.display_name, null,
           'metadata_properties_array', null::timestamptz,
           p.last_seen_metadata_run_id::text
    from plm.lucasfilm_dcp_property p

    union all
    select '20th-century', '20th Century', p.source_system,
           'plm.twentieth_century_dcp_property', p.source_id, p.display_name,
           null, 'metadata_properties_array', null::timestamptz,
           p.last_seen_metadata_run_id::text
    from plm.twentieth_century_dcp_property p

    union all
    select 'paramount', 'Paramount', 'paramount_creative_library',
           'plm.pmt_property', p.property_source_id::text, p.property_name,
           case when p.is_licensed_selection then 'licensed_selection'
                else 'asset_metadata' end,
           case when p.is_licensed_selection then 'portal_property_selection'
                else 'asset_metadata_property' end,
           p.imported_at, p.capture_id::text
    from pmt_ranked p
    where p.capture_rank = 1

    union all
    select 'warner-bros', 'Warner Bros.', 'warner_starlabs',
           'plm.wb_property',
           p.source_namespace || ':' || p.identity_method || ':' ||
             coalesce(p.source_id, p.fallback_key),
           p.label, null,
           'normalized_' || p.identity_method,
           p.last_seen_at, p.capture_id::text
    from plm.wb_property p

    union all
    select 'nbcuniversal', 'NBCUniversal', 'nbcu_creative_asset_factory',
           'plm.nbcu_property', p.property_key, p.property_label, null,
           p.source_kind, p.source_captured_at, p.capture_id::text
    from nbcu_ranked p
    where p.capture_rank = 1

    union all
    select
      'sega:' || coalesce(p.normalized_licensor_label, 'unlabeled'),
      coalesce(p.licensor_label, 'Sega (licensor not supplied)'),
      'sega_dsi', 'plm.sega_property', p.property_source_id,
      p.property_label, p.source_status, 'portal_ip_registry',
      null::timestamptz, p.capture_id::text
    from sega_ranked p
    where p.capture_rank = 1
  ), keyed as (
    select
      jsonb_build_array(
        s.presentation_licensor_key,
        s.source_system,
        s.source_table,
        s.source_property_id
      )::text as row_key,
      s.*
    from source_rows s
  ), labeled as (
    select
      k.*,
      case
        when k.source_table in (
          'plm.dcp_property',
          'plm.marvel_dcp_property',
          'plm.lucasfilm_dcp_property'
        )
          and nullif(btrim(k.source_property_name), '') is null
          and position('/' in k.source_property_id) > 0
          and btrim(regexp_replace(
                regexp_replace(k.source_property_id, '^.*/', ''),
                '[-_]+', ' ', 'g'
              )) ~ '[[:alnum:]]'
        then replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(
                              replace(
                                replace(
                                  initcap(btrim(regexp_replace(
                                    regexp_replace(k.source_property_id, '^.*/', ''),
                                    '[-_]+', ' ', 'g'
                                  ))),
                                  ' And ', ' and '
                                ),
                                ' Or ', ' or '
                              ),
                              ' Of ', ' of '
                            ),
                            ' The ', ' the '
                          ),
                          ' A ', ' a '
                        ),
                        ' An ', ' an '
                      ),
                      ' To ', ' to '
                    ),
                    ' For ', ' for '
                  ),
                  ' In ', ' in '
                ),
                ' On ', ' on '
              ),
              ' At ', ' at '
            ),
            ' By ', ' by '
          ),
                    '''S', '''s'
                  ),
                  '''T', '''t'
                ),
                '''Re', '''re'
              ),
              '''Ve', '''ve'
            ),
            '''Ll', '''ll'
          ),
          '''D', '''d'
        ),
        '''M', '''m'
        )
        else null
      end as derived_display_label
    from keyed k
  ), filtered as (
    select l.*
    from labeled l
    where (
      p_search is null
      or l.presentation_licensor_name ilike '%' || p_search || '%'
      or l.source_system ilike '%' || p_search || '%'
      or l.source_property_id ilike '%' || p_search || '%'
      or l.source_property_name ilike '%' || p_search || '%'
      or l.derived_display_label ilike '%' || p_search || '%'
    )
      and (p_cursor is null or l.row_key collate "C" > v_cursor_key collate "C")
  ), ordered as (
    select f.*
    from filtered f
    order by f.row_key collate "C"
    limit v_page_size + 1
  ), numbered as (
    select o.*, row_number() over (order by o.row_key collate "C") as rn
    from ordered o
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'row_key', n.row_key,
        'presentation_licensor_key', n.presentation_licensor_key,
        'presentation_licensor_name', n.presentation_licensor_name,
        'source_system', n.source_system,
        'source_table', n.source_table,
        'source_property_id', n.source_property_id,
        'source_property_name', n.source_property_name,
        'display_label', coalesce(
          nullif(btrim(n.source_property_name), ''),
          n.derived_display_label,
          '[Unlabeled source ID: ' || n.source_property_id || ']'
        ),
        'source_status', n.source_status,
        'provenance_kind', n.provenance_kind,
        'latest_seen_at', n.latest_seen_at,
        'capture_marker', n.capture_marker
      ) order by n.rn
    ) filter (where n.rn <= v_page_size), '[]'::jsonb),
    count(*)::integer,
    max(n.row_key) filter (where n.rn = v_page_size)
  into v_rows, v_fetched, v_last_key
  from numbered n;

  if v_fetched > v_page_size and v_last_key is not null then
    v_next_cursor := encode(convert_to(v_last_key, 'UTF8'), 'base64');
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'next_cursor', v_next_cursor,
    'page_size', v_page_size
  );
end;
$function$;

comment on function api.db_data_admin_scraped_properties(text, text, integer) is
  'Read-only, licensing-manager-gated union of retained source-declared Property vocabularies. Preserves source identity and provenance, derives presentation-only labels from terminal DCP Vault source-id slugs for Disney, Marvel, and Lucasfilm when source names are absent, keeps capture-scoped repeats collapsed by stable source identity, and exposes no raw payload or source URL.';

revoke all on function api.db_data_admin_scraped_properties(text, text, integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text, text, integer)
  to authenticated;
