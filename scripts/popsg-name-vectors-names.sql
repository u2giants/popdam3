-- Active PopSG licensor and property names, one per line (input to popsg-name-vectors.mjs).
select distinct n from (
  select licensor_name n from public.style_guide_search_documents where is_active
  union select property_folder from public.style_guide_search_documents where is_active
) t where n is not null order by n;
