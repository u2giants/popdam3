-- Version: 20261031232334
-- Live proof for popcre/ai-devops#2172 stage C2: the first migration merged
-- through the native merge queue on the core checks only, then promoted to
-- production automatically. It re-asserts the existing core schema comment
-- unchanged, so it alters no data, privilege, or object definition.
comment on schema core is 'Canonical shared business objects used by DAM, CRM, PM, and PLM.';
