-- The tagging worker keeps its access and browser roles cannot execute
-- these routines, even after a later replacement or default grant change.
do $$
declare
  signature text;
  routine regprocedure;
begin
  foreach signature in array array[
    'public.get_style_guide_deterministic_tag_batch(uuid,integer,boolean)',
    'public.replace_style_guide_deterministic_tags(uuid,jsonb,text,text)',
    'public.replace_style_guide_folder_consensus_tags(uuid,jsonb,text)'
  ] loop
    routine := to_regprocedure(signature);
    if routine is null
      or not has_function_privilege('service_role', routine, 'execute')
      or has_function_privilege('authenticated', routine, 'execute')
      or has_function_privilege('anon', routine, 'execute')
      or has_function_privilege('public', routine, 'execute')
    then
      raise exception 'Expected PopSG worker-only execution on %', signature;
    end if;
  end loop;
end
$$;
