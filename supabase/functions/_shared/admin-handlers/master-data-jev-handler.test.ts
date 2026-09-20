import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ apiKey: "test-openrouter-key" }));

vi.mock("../http.ts", () => ({
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  err: (error: string, status = 400) => new Response(JSON.stringify({ ok: false, error }), { status }),
}));

vi.mock("../service-client.ts", () => ({
  serviceClient: () => ({
    from: () => {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => ({ data: { value: fixture.apiKey }, error: null });
      return query;
    },
  }),
}));

import { handleRankMasterDataMatchCandidates, parseJevCandidateRanking } from "./master-data-jev-handler.ts";

const candidates = [
  { target_id: "first", target_label: "Disney" },
  { target_id: "second", target_label: "Disney Consumer Products" },
];

beforeEach(() => {
  fixture.apiKey = "test-openrouter-key";
  vi.unstubAllGlobals();
});

describe("parseJevCandidateRanking", () => {
  it("maps a typed Jev choice back to its candidate index", () => {
    expect(parseJevCandidateRanking({
      type: "choice",
      choice: "candidate_1",
      probabilities: { candidate_0: 0.15, candidate_1: 0.8, no_match: 0.05 },
      confidence: 0.75,
    }, 2)).toEqual({ choice_index: 1, probabilities: [0.15, 0.8], confidence: 0.75 });
  });

  it("preserves an explicit no-match decision", () => {
    expect(
      parseJevCandidateRanking({
        type: "choice",
        choice: "no_match",
        probabilities: { candidate_0: 0.1, candidate_1: 0.1, no_match: 0.8 },
        confidence: 0.7,
      }, 2).choice_index,
    ).toBeNull();
  });

  it("does not recommend a low-confidence choice", () => {
    expect(
      parseJevCandidateRanking({
        type: "choice",
        choice: "candidate_1",
        probabilities: { candidate_0: 0.2, candidate_1: 0.75, no_match: 0.05 },
        confidence: 0.4,
      }, 2).choice_index,
    ).toBeNull();

    expect(
      parseJevCandidateRanking({
        type: "choice",
        choice: "candidate_1",
        probabilities: { candidate_0: 0.3, candidate_1: 0.55, no_match: 0.15 },
        confidence: 0.9,
      }, 2).choice_index,
    ).toBeNull();
  });

  it("rejects missing or out-of-range candidate probabilities", () => {
    expect(() =>
      parseJevCandidateRanking({
        type: "choice",
        choice: "candidate_0",
        probabilities: { candidate_0: 1.2, candidate_1: 0, no_match: 0 },
        confidence: 1,
      }, 2)
    ).toThrow("omitted a candidate probability");
  });
});

describe("handleRankMasterDataMatchCandidates", () => {
  it("uses the decisions endpoint with a pinned model and privacy routing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "typesafe/jev-1.13-20260917",
          answers: {
            match: {
              type: "choice",
              choice: "candidate_1",
              probabilities: { candidate_0: 0.15, candidate_1: 0.8, no_match: 0.05 },
              confidence: 0.75,
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRankMasterDataMatchCandidates({
      field_key: "licensor",
      raw_value: "Disney Products",
      candidates,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      ranking: { choice_index: 1, probabilities: [0.15, 0.8], confidence: 0.75 },
    });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      model: "typesafe/jev-1.13",
      provider: { zdr: true, data_collection: "deny" },
    });
    expect(body.questions.match.criteria).toHaveProperty("no_match");
  });

  it("rejects unsupported fields before making a model call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleRankMasterDataMatchCandidates({
      field_key: "sku",
      raw_value: "ABC123",
      candidates,
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenRouter Decisions live contract", () => {
  it.skipIf(!process.env.OPENROUTER_API_KEY)(
    "accepts Jev choice questions with privacy routing",
    async () => {
      const apiKey = (process.env.OPENROUTER_API_KEY ?? "")
        .replace(/[\r\n"' ]/g, "")
        .replace(/^OPENROUTER_API_KEY=/, "");
      const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "typesafe/jev-1.13",
          state: { field: "customer", raw_value: "Acme Incorporated" },
          questions: {
            match: {
              type: "choice",
              instructions: "Choose the candidate that identifies the same company, or no_match.",
              criteria: {
                candidate_0: "ACME Inc",
                candidate_1: "Globex",
                no_match: "No credible match",
              },
            },
          },
          provider: { zdr: true, data_collection: "deny" },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.answers?.match).toMatchObject({
        type: "choice",
        choice: "candidate_0",
      });
      expect(payload.answers?.match?.confidence).toBeGreaterThanOrEqual(0);
    },
    20_000,
  );
});
