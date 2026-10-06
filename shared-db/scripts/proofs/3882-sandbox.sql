-- Fixed read-only sandbox acceptance; returns a count, never application rows.
select to_regclass('dflow.properties_and_characters') is not null and to_regclass('core.properties_and_characters') is null as shape_passed, (select count(*) from dflow.properties_and_characters) as row_count;
