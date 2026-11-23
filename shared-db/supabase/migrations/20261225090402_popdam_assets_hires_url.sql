-- u2giants/popdam3#1272 item 2 (claim: popcre/shared-db#6978)
-- PopDAM AI tagging sends the 800px thumbnail to vision models, which destroys
-- detail on wide/tall artwork. The on-prem render agents now also upload a
-- larger rendition (longest edge up to 1500px); its public URL is stored here
-- and the taggers prefer it over thumbnail_url. Nullable: absent until an
-- asset is (re)rendered by an updated agent.
alter table public.assets
  add column if not exists hires_url text;

comment on column public.assets.hires_url is
  'Public URL of the agent-produced hi-res rendition (longest edge up to 1500px JPEG) used as AI tagging input; null when not yet rendered. Falls back to thumbnail_url.';
