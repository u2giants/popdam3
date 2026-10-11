import { describe, expect, it, vi } from "vitest";
import { assertPopSgPdfVisionLease, POPSG_PDF_VISION_MAX_IMAGE_BYTES, transcribePopSgPdfPage, validatePopSgPdfPage } from "./popsg-pdf-vision";

const image = btoa("\x89PNG\r\n\x1a\nfixture page");
const model = "meta-direct/muse-spark-1.3-contributor";
const lease = { status: "claimed", claimed_by: "agent-a", content_identity: "content-a", claim_expires_at: "2026-10-11T21:30:00Z" };
const now = Date.parse("2026-10-11T21:00:00Z");
const complete = (text = "legible fixture text") => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] }));

describe("PopSG direct PDF transcription", () => {
  it("rejects another agent, changed content, expired/malformed leases and non-claimed work", () => {
    expect(() => assertPopSgPdfVisionLease(lease, "agent-a", "content-a", now)).not.toThrow();
    for (const invalid of [null, { ...lease, claimed_by: "agent-b" }, { ...lease, status: "extracted" },
      { ...lease, content_identity: "content-b" }, { ...lease, claim_expires_at: "bad" }, { ...lease, claim_expires_at: new Date(now).toISOString() }]) {
      expect(() => assertPopSgPdfVisionLease(invalid, "agent-a", "content-a", now)).toThrow(/content lease/);
    }
  });

  it("accepts only bounded base64 PNG data, never URLs or other media", () => {
    expect(() => validatePopSgPdfPage(image)).not.toThrow();
    for (const invalid of ["https://example.invalid/page", "data:image/png;base64," + image, btoa("not a PNG"),
      "A".repeat(Math.ceil(POPSG_PDF_VISION_MAX_IMAGE_BYTES / 3) * 4 + 4), "not!base64", null]) {
      expect(() => validatePopSgPdfPage(invalid)).toThrow();
    }
  });

  it("uses Meta Responses with the selected model, server key and literal-transcription instructions", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(complete());
    expect(await transcribePopSgPdfPage(model, "fixture-key", image, { fetch: request })).toBe("legible fixture text");
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://api.meta.ai/v1/responses");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fixture-key");
    const sent = JSON.parse(String(init?.body));
    expect(sent.model).toBe("muse-spark-1.3-contributor");
    expect(sent.input[0].content[0]).toEqual({ type: "input_image", image_url: `data:image/png;base64,${image}` });
    expect(sent.input[0].content[1].text).toContain("Do not infer");
    expect(sent.max_output_tokens).toBe(20480);
  });

  it("retries Contributor capacity with the same request and never changes the model", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"error":{"code":"model_not_found"}}', { status: 404 })).mockResolvedValueOnce(complete());
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
    await transcribePopSgPdfPage(model, "fixture-key", image, { fetch: request, sleep });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]?.body).toBe(request.mock.calls[1][1]?.body);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry authentication failures or expose raw provider errors", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider response", { status: 401 }));
    await expect(transcribePopSgPdfPage(model, "fixture-key", image, { fetch: request })).rejects.toThrow("HTTP 401");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bounds capacity retries and refuses incomplete, empty and refused answers", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response("capacity", { status: 503 }));
    await expect(transcribePopSgPdfPage(model, "fixture-key", image, { fetch: request, sleep: async () => {} })).rejects.toThrow("HTTP 503");
    expect(request).toHaveBeenCalledTimes(5);
    for (const result of [{ status: "incomplete", output: [] }, { status: "completed", output: [] },
      { status: "completed", output: [{ type: "message", content: [{ type: "refusal", text: "denied" }] }] }]) {
      await expect(transcribePopSgPdfPage(model, "fixture-key", image, { fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result))) })).rejects.toThrow();
    }
  });

  it("refuses a missing key or wrong provider before dispatch", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(transcribePopSgPdfPage(model, "", image, { fetch: request })).rejects.toThrow("not configured");
    await expect(transcribePopSgPdfPage("openrouter/fixture", "fixture-key", image, { fetch: request })).rejects.toThrow("direct Meta");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not continue capacity retries beyond the total deadline", async () => {
    let clock = 0;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => { clock = 54_500; return new Response("capacity", { status: 503 }); });
    const sleep = vi.fn<(ms: number) => Promise<void>>();
    await expect(transcribePopSgPdfPage(model, "fixture-key", image, { fetch: request, sleep, now: () => clock })).rejects.toThrow("HTTP 503");
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
