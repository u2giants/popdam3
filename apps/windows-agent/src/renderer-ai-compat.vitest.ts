import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { calls } = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => { throw new Error("not installed in fixture"); }),
  execFile: vi.fn((exe: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: string, stderr?: string) => void) => {
    calls.push([exe, ...args]);
    if (exe !== "fixture-ghostscript") return callback(new Error("not installed in fixture"));
    const output = args.find((arg) => arg.startsWith("-sOutputFile="))!.slice("-sOutputFile=".length).replace("%d", "1");
    // A real image goes through the production resize/decode path after the
    // engine call. The fixture only substitutes the external GS executable.
    import("sharp").then(({ default: sharp }) => sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toFile(output))
      .then(() => callback(null, "", ""), (error) => callback(error));
  }),
}));

let directory: string;
let renderFile: typeof import("./renderer")["renderFile"];
const previousGs = process.env.GS_PATH;
beforeAll(async () => {
  process.env.GS_PATH = "fixture-ghostscript";
  directory = await mkdtemp(path.join(tmpdir(), "popdam-ai-header-test-"));
  // The production Function-based ESM loader runs outside Vitest's resolver.
  // Supply the real MuPDF module while retaining production parsing/draw probes.
  const mupdfModule = "mupdf";
  const mupdf = await import(mupdfModule);
  const NativeFunction = globalThis.Function;
  vi.stubGlobal("Function", new Proxy(NativeFunction, {
    construct(target, args) {
      if (args[0] === "m" && args[1] === "return import(m)") return () => Promise.resolve(mupdf);
      return Reflect.construct(target, args);
    },
  }));
  try { ({ renderFile } = await import("./renderer")); }
  finally { vi.unstubAllGlobals(); }
});
beforeEach(() => { calls.length = 0; });
afterAll(async () => {
  if (previousGs === undefined) delete process.env.GS_PATH;
  else process.env.GS_PATH = previousGs;
  await rm(directory, { recursive: true, force: true });
});

// Minimal valid PDF: the same text-only warning that the production preflight
// detects, with optional actual drawing so a marker alone never hides artwork.
function pdf(withArtwork: boolean): string {
  const content = `BT /F1 12 Tf 20 20 Td (saved without PDF Content) Tj ET${withArtwork ? " 10 10 20 20 re f 40 10 20 20 re f 70 10 20 20 re f 100 10 20 20 re f" : ""}`;
  return `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 1000] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF`;
}

describe("AI compatibility routing", () => {
  it("recovers the source's embedded original preview after its PDF notice and native render fail", async () => {
    const source = path.join(directory, "embedded-preview.ai");
    const { default: sharp } = await import("sharp");
    const pixels = Buffer.alloc(32 * 24 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + Math.floor(i / 97)) % 256;
    const jpeg = await sharp(pixels, { raw: { width: 32, height: 24, channels: 3 } }).jpeg().toBuffer();
    const body = pdf(false) + `<xmpGImg:image>${jpeg.toString("base64")}</xmpGImg:image>`;
    await writeFile(source, body);
    const result = await renderFile(source, "ai");
    expect(result.width).toBe(32); expect(result.height).toBe(24);
    expect(calls.some(([exe]) => exe === "fixture-ghostscript")).toBe(false);
    expect(await readFile(source, "utf8")).toBe(body);
  });

  it("routes PDF content named PSD through the existing PDF preview path", async () => {
    const source = path.join(directory, "pdf-content.psd");
    await writeFile(source, pdf(true));
    const result = await renderFile(source, "psd");
    const gs = calls.find(([exe]) => exe === "fixture-ghostscript")!;
    expect(gs).toContain("-dLastPage=2");
    expect(gs).toContain("-r200");
    expect(result).toHaveProperty("hiresPage1Buffer");
    expect(await readFile(source, "utf8")).toBe(pdf(true));
  });

  it("keeps actual PSD content on its normal renderer path", async () => {
    const source = path.join(directory, "actual.psd");
    const header = Buffer.alloc(26);
    header.write("8BPS"); header.writeUInt16BE(1, 4);
    header.writeUInt16BE(3, 12); header.writeUInt32BE(1, 14); header.writeUInt32BE(1, 18);
    header.writeUInt16BE(8, 22); header.writeUInt16BE(3, 24);
    const content = Buffer.concat([header, Buffer.alloc(14), Buffer.from([20, 40, 60])]);
    await writeFile(source, content);
    // This fixture has no Photoshop decoder installed; its ordinary fallback
    // failure must remain a PSD failure, without invoking the PDF engine.
    await expect(renderFile(source, "psd")).rejects.toThrow("render_failed: sharp:");
    expect(calls.some(([exe]) => exe === "fixture-ghostscript")).toBe(false);
    expect(await readFile(source)).toEqual(content);
  });

  it.each(["", "%PD"])("keeps empty or short PSD files on the normal failure path (%j)", async (content) => {
    const source = path.join(directory, "short.psd");
    await writeFile(source, content);
    await expect(renderFile(source, "psd")).rejects.toThrow("render_failed: sharp:");
    expect(calls.some(([exe]) => exe === "fixture-ghostscript")).toBe(false);
  });

  it.each(["%!PS-Adobe-3.0", "%!PS-Adobe-2.0 EPSF-1.2"])("lets Ghostscript render native AI headed %s", async (header) => {
    const source = path.join(directory, "native.ai");
    await writeFile(source, `${header}\n%%BoundingBox: 0 0 8 8\n0 0 8 8 rectfill\nshowpage\n`);
    const result = await renderFile(source, "ai");
    expect(calls.some(([exe]) => exe === "fixture-ghostscript")).toBe(true);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(await readFile(source, "utf8")).toContain(header);
  });

  it("renders negative-origin PostScript artwork within its own bounded page", async () => {
    const source = path.join(directory, "negative-origin.ai");
    await writeFile(source, "%!PS-Adobe-3.0\n%%BoundingBox: 0 -7200 5760 0\nshowpage\n");
    await renderFile(source, "ai");
    const gs = calls.find(([exe]) => exe === "fixture-ghostscript")!;
    expect(gs).toContain("<</PageSize [5760 7200]>> setpagedevice 0 7200 translate");
    expect(gs).toContain("-r8"); // Largest side is 800 pixels, not a 150-DPI mural.
  });

  it("ignores malformed or unbounded page declarations", async () => {
    const source = path.join(directory, "invalid-bounds.ai");
    await writeFile(source, "%!PS-Adobe-3.0\n%%BoundingBox: 0 0 999999999 80\nshowpage\n");
    await renderFile(source, "ai");
    const gs = calls.find(([exe]) => exe === "fixture-ghostscript")!;
    expect(gs).not.toContain("-c");
    expect(gs).toContain("-r150");
  });

  it("still skips PDF engines for the text-only compatibility notice", async () => {
    const source = path.join(directory, "notice.ai");
    await writeFile(source, pdf(false));
    await expect(renderFile(source, "ai")).rejects.toThrow("ghostscript: skipped (no pdf compat)");
    expect(calls.some(([exe]) => exe === "fixture-ghostscript")).toBe(false);
  });

  it("does not reject a PDF artwork page just because the warning text exists", async () => {
    const source = path.join(directory, "artwork.ai");
    await writeFile(source, pdf(true));
    await renderFile(source, "ai");
    expect(calls.some(([exe]) => exe === "fixture-ghostscript")).toBe(true);
  });
});
