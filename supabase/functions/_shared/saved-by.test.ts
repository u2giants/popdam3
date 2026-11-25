import { describe, expect, it } from "vitest";
import { lookupSavedBy, matchVersion, parseLibraries, toSeafile } from "./saved-by.ts";

const A = "11111111-1111-4111-8111-111111111111";
const LIBS = [{ libraryId: "lib-char", pathPrefix: "Decor/Character Licensed", displayName: "x", rootId: "Decor", seaDriveFolder: "x" }];
const MTIME = "2026-11-25T00:07:39.000Z"; // 1795565259
const T = 1795565259;

function fakeDb(relative = "Decor/Character Licensed/New/a.ai", cands = ["Decor/Character Licensed/Old/a.ai"]) {
  const config: Record<string, unknown> = { HELPER_SEAFILE_LIBRARIES: JSON.stringify(LIBS), HELPER_SEAFILE_SERVER_URL: "https://sf.test/" };
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () =>
            table === "assets" ? { data: v === A ? { id: A, relative_path: relative } : null } : { data: v in config ? { value: config[v] } : null },
        }),
      }),
    }),
    rpc: async () => ({ data: cands, error: null }),
  };
}

function fakeFetch(commitsByPath: Record<string, unknown[]>) {
  const seen: string[] = [];
  const fn = async (url: string) => {
    const u = new URL(url);
    const p = u.searchParams.get("p")!;
    seen.push(`${u.pathname}|${p}`);
    return new Response(JSON.stringify({ commits: commitsByPath[p] ?? [], next_start_commit: null }), { status: 200 });
  };
  return { fn, seen };
}

const commit = (ctime: number, size: number, name: string, email = `${name}@auth.local`) => ({ ctime, rev_file_size: size, user_info: { name, email } });

const rev = (ctime: number, size: number, name: string, email = `${name}@auth.local`) => ({ ctime, size, name, email });

describe("saved-by helpers (popdam3#1342)", () => {
  it("maps NAS paths into Seafile libraries", () => {
    const libs = parseLibraries(JSON.stringify(LIBS));
    expect(toSeafile("Decor/Character Licensed/x/a.ai", libs)).toEqual({ libraryId: "lib-char", path: "/x/a.ai" });
    expect(toSeafile("Decor/Character Licensed Extra/a.ai", libs)).toBeNull();
    expect(toSeafile("Art Library/a.ai", libs)).toBeNull();
  });

  it("matches on size and a commit within two minutes of the saved time", () => {
    const v = { source_path: "p", size: 100, mtime: MTIME };
    expect(matchVersion(v, [rev(T + 2, 100, "João Melhorance")], [])).toEqual({ via: "seafile", name: "João Melhorance" });
    expect(matchVersion(v, [rev(T + 2, 101, "João Melhorance")], [])).toEqual({ via: null, name: null });
    expect(matchVersion(v, [rev(T + 600, 100, "João Melhorance")], [])).toEqual({ via: null, name: null });
  });

  it("a save uploaded by the NAS sync account is reported as a NAS save", () => {
    const v = { source_path: "p", size: 100, mtime: MTIME };
    expect(matchVersion(v, [rev(T + 1, 100, "nas-sync", "sync@auth.local")], [])).toEqual({ via: "nas", name: null });
    expect(matchVersion(v, [rev(T + 1, 100, "Someone", "sync@auth.local")], ["sync@auth.local"])).toEqual({ via: "nas", name: null });
  });
});

describe("lookupSavedBy", () => {
  it("looks up the current and old paths, never a path the asset never had", async () => {
    const { fn, seen } = fakeFetch({ "/New/a.ai": [commit(T + 2, 100, "João Melhorance")] });
    const r = await lookupSavedBy(
      fakeDb(),
      {
        asset_id: A,
        versions: [
          { source_path: "Decor/Character Licensed/Old/a.ai", size: 100, mtime: MTIME },
          { source_path: "Decor/Character Licensed/../../etc/passwd", size: 1, mtime: MTIME },
        ],
      },
      { token: "t", syncEmails: [] },
      fn,
    );
    expect(r.status).toBe(200);
    expect(seen.every((s) => s.startsWith("/api2/repos/lib-char/file/history/"))).toBe(true);
    expect(seen.map((s) => s.split("|")[1])).toEqual(["/New/a.ai", "/Old/a.ai"]);
    expect((r.body.versions as Array<{ name: string }>)[0].name).toBe("João Melhorance");
  });

  it("reports not configured without a token", async () => {
    const r = await lookupSavedBy(fakeDb(), { asset_id: A, versions: [] }, { token: null, syncEmails: [] }, fakeFetch({}).fn);
    expect(r.body.configured).toBe(false);
  });
});
