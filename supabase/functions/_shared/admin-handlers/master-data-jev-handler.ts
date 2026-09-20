import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";

const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = "typesafe/jev-1.13";
const MAX_CANDIDATES = 8;
const MIN_SUGGESTION_CONFIDENCE = 0.7;
const MIN_SUGGESTION_PROBABILITY = 0.6;

const FIELD_GUIDANCE: Record<string, string> = {
  customer: "Decide whether the raw customer name and a candidate identify the same customer business.",
  licensor:
    "Decide whether the raw licensor name and a candidate identify the same licensor or rights holder. Do not confuse a licensor with one of its properties.",
  designer: "Decide whether the raw designer name and a candidate identify the same person.",
  factory: "Decide whether the raw factory or vendor name and a candidate identify the same business.",
};

type Candidate = {
  target_id: string;
  target_label: string;
};

type ChoiceAnswer = {
  type?: unknown;
  choice?: unknown;
  probabilities?: unknown;
  confidence?: unknown;
};

function finiteProbability(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function parseJevCandidateRanking(
  answer: ChoiceAnswer,
  candidateCount: number,
): { choice_index: number | null; probabilities: number[]; confidence: number } {
  if (answer.type !== "choice" || typeof answer.choice !== "string") {
    throw new Error("Jev returned an invalid match decision");
  }
  if (!answer.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities)) {
    throw new Error("Jev returned invalid match probabilities");
  }

  const rawProbabilities = answer.probabilities as Record<string, unknown>;
  const probabilities = Array.from({ length: candidateCount }, (_, index) => {
    const probability = finiteProbability(rawProbabilities[`candidate_${index}`]);
    if (probability === null) throw new Error("Jev omitted a candidate probability");
    return probability;
  });
  const noMatchProbability = finiteProbability(rawProbabilities.no_match);
  const confidence = finiteProbability(answer.confidence);
  if (noMatchProbability === null || confidence === null) {
    throw new Error("Jev returned an incomplete match decision");
  }

  if (answer.choice === "no_match") return { choice_index: null, probabilities, confidence };
  const match = /^candidate_(\d+)$/.exec(answer.choice);
  const choiceIndex = match ? Number(match[1]) : -1;
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= candidateCount) {
    throw new Error("Jev selected an unknown candidate");
  }
  if (
    confidence < MIN_SUGGESTION_CONFIDENCE ||
    probabilities[choiceIndex] < MIN_SUGGESTION_PROBABILITY
  ) {
    return { choice_index: null, probabilities, confidence };
  }
  return { choice_index: choiceIndex, probabilities, confidence };
}

export async function handleRankMasterDataMatchCandidates(body: Record<string, unknown>) {
  const fieldKey = typeof body.field_key === "string" ? body.field_key : "";
  const rawValue = typeof body.raw_value === "string" ? body.raw_value.trim().slice(0, 500) : "";
  const rawCandidates = Array.isArray(body.candidates) ? body.candidates : [];
  const candidates = rawCandidates
    .filter((candidate): candidate is Candidate =>
      Boolean(candidate) && typeof candidate === "object" &&
      typeof (candidate as Candidate).target_id === "string" && typeof (candidate as Candidate).target_label === "string"
    )
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => ({
      target_id: candidate.target_id.slice(0, 200),
      target_label: candidate.target_label.trim().slice(0, 300),
    }));

  if (!FIELD_GUIDANCE[fieldKey]) return err("This Master Data field does not support Jev ranking", 400);
  if (!rawValue || candidates.length < 1) return err("A raw value and at least one candidate are required", 400);
  if (candidates.some((candidate) => !candidate.target_id || !candidate.target_label)) {
    return err("Every candidate needs an id and label", 400);
  }

  const { data, error } = await serviceClient()
    .from("admin_config")
    .select("value")
    .eq("key", "OPENROUTER_API_KEY")
    .maybeSingle();
  if (error) return err("Could not read OpenRouter configuration", 500);
  const apiKey = typeof data?.value === "string" ? data.value : "";
  if (!apiKey) return err("OPENROUTER_API_KEY is not configured", 400);

  const criteria = Object.fromEntries([
    ...candidates.map((candidate, index) => [
      `candidate_${index}`,
      candidate.target_label,
    ]),
    ["no_match", "None of the candidates is clearly the same entity as the raw value."],
  ]);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://dam.designflow.app",
        "X-Title": "PopDAM Master Data Matching",
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: {
          field: fieldKey,
          raw_value: rawValue,
        },
        questions: {
          match: {
            type: "choice",
            instructions: `${
              FIELD_GUIDANCE[fieldKey]
            } Choose no_match when the evidence is insufficient. This is an advisory ranking for a human reviewer, not permission to create or merge records.`,
            criteria,
          },
        },
        provider: { zdr: true, data_collection: "deny" },
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return err("Jev ranking request failed", 502);
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) return err(`Jev ranking API error: ${response.status}`, 502);
  const answers = payload?.answers as Record<string, ChoiceAnswer> | undefined;
  try {
    const ranking = parseJevCandidateRanking(answers?.match ?? {}, candidates.length);
    return json({ ok: true, model: payload?.model ?? JEV_MODEL, ranking });
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : "Jev returned an invalid match decision", 502);
  }
}
