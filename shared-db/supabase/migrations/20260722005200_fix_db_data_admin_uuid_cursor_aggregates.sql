-- Correct Step 6 cursor extraction for PostgreSQL, which has no max(uuid)
-- aggregate. The preceding migration is already applied to preview, so keep
-- history immutable and replace only the four affected function definitions.

do $$
declare
  v_function regprocedure;
  v_definition text;
  v_invalid text := 'max(n.id) filter (where n.rn = v_page_size)';
  v_valid text := '(max(n.id::text) filter (where n.rn = v_page_size))::uuid';
begin
  foreach v_function in array array[
    'api.db_data_admin_customer_list(text,text,text,text,boolean,text,text,text,integer)'::regprocedure,
    'api.db_data_admin_vendor_list(text,text,text,text,boolean,text,text,text,integer)'::regprocedure,
    'api.db_data_admin_licensor_property_list(text,boolean,text,integer)'::regprocedure,
    'api.db_data_admin_audit_list(text,uuid,text,uuid,timestamptz,timestamptz,text,integer)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    if position(v_invalid in v_definition) = 0 then
      raise exception 'expected UUID cursor aggregate not found in %', v_function;
    end if;
    execute replace(v_definition, v_invalid, v_valid);
  end loop;
end $$;

