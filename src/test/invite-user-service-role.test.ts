import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Issue #565: service-role callers authenticate with the sentinel userId
// "system" (_shared/admin-auth.ts). handleInviteUser inserted that string into
// invitations.invited_by (uuid) and Postgres rejected the insert:
// `invalid input syntax for type uuid: "system"`. invited_by is nullable
// (docs/SCHEMA.md §2.12), so service-role callers must store NULL instead.
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

it("invite-user stores NULL invited_by for the service-role sentinel, uuid for JWT callers", () => {
  const index = read("supabase/functions/admin-api/index.ts");
  const fnStart = index.indexOf("async function handleInviteUser");
  const fnEnd = index.indexOf("async function", fnStart + 10);
  const fn = index.slice(fnStart, fnEnd);
  // The service-role sentinel must never reach the uuid column directly.
  expect(fn).toContain("invited_by: userId === \"system\" ? null : userId");
  expect(fn).not.toContain("invited_by: userId,");
});

it("set-user-apps stores NULL granted_by for the service-role sentinel, uuid for JWT callers", () => {
  const index = read("supabase/functions/admin-api/index.ts");
  const fnStart = index.indexOf("async function handleSetUserApps");
  const fnEnd = index.indexOf("async function", fnStart + 10);
  const fn = index.slice(fnStart, fnEnd);
  expect(fn).toContain("granted_by: _userId === \"system\" ? null : _userId");
  expect(fn).not.toMatch(/granted_by:\s*_userId\s*[,}]/);
});
