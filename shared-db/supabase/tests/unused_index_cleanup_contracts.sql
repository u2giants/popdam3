-- Plain PostgreSQL assertions for the ephemeral contract runner.
do $index_cleanup$
begin
  if to_regclass('public.idx_assets_full_text_search') is not null then
    raise exception 'Expected: idx_assets_full_text_search removed';
  end if;
  if to_regclass('public.idx_sgf_directory_path_trgm') is not null then
    raise exception 'Expected: idx_sgf_directory_path_trgm removed';
  end if;
  if to_regclass('public.idx_style_guide_files_tag_search_trgm') is not null then
    raise exception 'Expected: idx_style_guide_files_tag_search_trgm removed';
  end if;
  if to_regclass('public.idx_assets_tags') is null then
    raise exception 'Expected: assets tag index retained';
  end if;
  if to_regclass('public.idx_style_guide_file_tags_tag_status') is null then
    raise exception 'Expected: style guide tag-status index retained';
  end if;
  if to_regclass('public.idx_assets_ai_tag_untagged_candidates') is null then
    raise exception 'Expected: AI tag candidate index retained';
  end if;
  if to_regclass('public.dam_search_embedding_claim_idx') is null then
    raise exception 'Expected: DAM claim index retained';
  end if;
end;
$index_cleanup$;
