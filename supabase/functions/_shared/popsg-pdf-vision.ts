// PopSG owns this bounded, lease-bound transcription route. Provider credentials
// stay on the server; agents send only the rendered page of their claimed PDF.
export const POPSG_PDF_VISION_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const TRANSCRIPTION_PROMPT = "Transcribe only text that is visually legible. Preserve reading order where possible. Do not infer, complete, correct, or invent unclear text. Omit unreadable text. Return only the transcription.";

export interface PopSgPdfLease {
  status: string;
  claimed_by: string | null;
  claim_expires_at: string | null;
  content_identity: string;
}

export function assertPopSgPdfVisionLease(lease: PopSgPdfLease | null, agentId: string, identity: string, now = Date.now()): void {
  const expires = Date.parse(lease?.claim_expires_at ?? "");
  if (!lease || lease.status !== "claimed" || lease.claimed_by !== agentId ||
      lease.content_identity !== identity || !Number.isFinite(expires) || expires <= now) {
    throw new Error("PopSG PDF transcription requires this agent's current content lease");
  }
}

export function validatePopSgPdfPage(image: unknown): asserts image is string {
  if (typeof image !== "string" || !image || image.length > Math.ceil(POPSG_PDF_VISION_MAX_IMAGE_BYTES / 3) * 4 ||
      image.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    throw new Error("PopSG PDF transcription requires a bounded base64 PNG page");
  }
  const signature = atob(image.slice(0, 12)).slice(0, 8);
  if (signature !== "\x89PNG\r\n\x1a\n") throw new Error("PopSG PDF transcription requires a PNG page");
}

export async function transcribePopSgPdfPage(
  model: string,
  apiKey: string,
  image: string,
  dependencies: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<string> {
  validatePopSgPdfPage(image);
  if (!model.startsWith("meta-direct/") || !model.slice("meta-direct/".length).trim()) {
    throw new Error("PopSG PDF transcription requires the configured direct Meta model");
  }
  if (!apiKey) throw new Error("PopSG PDF transcription provider is not configured");
  const request = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const deadline = now() + 55_000;
  const delays = [1_000, 2_000, 4_000, 8_000];
  const body = JSON.stringify({
    model: model.slice("meta-direct/".length),
    input: [{ role: "user", content: [
      { type: "input_image", image_url: `data:image/png;base64,${image}` },
      { type: "input_text", text: TRANSCRIPTION_PROMPT },
    ] }],
    max_output_tokens: 4096 + 16_384,
  });
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("PopSG PDF transcription provider exceeded its bounded deadline");
    response = await request("https://api.meta.ai/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body, signal: AbortSignal.timeout(remaining),
    });
    if (response.ok) break;
    // Contributor capacity may appear as model_not_found/503. Retry the same
    // model and identical page, never switch provider or expose its raw error.
    const text = await response.text();
    const capacity = response.status === 503 || (response.status === 404 && /model_not_found|model not found/i.test(text));
    const delay = delays[attempt];
    if (!capacity || delay === undefined || now() + delay >= deadline) {
      throw new Error(`PopSG PDF transcription provider failed (HTTP ${response.status})`);
    }
    await sleep(delay);
  }
  const result = await response.json() as {
    status?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  if (result.status !== "completed" || !Array.isArray(result.output)) {
    throw new Error("PopSG PDF transcription provider returned an incomplete response");
  }
  const parts = result.output.filter((entry) => entry.type === "message").flatMap((entry) => entry.content ?? []);
  if (parts.some((part) => part.type === "refusal")) throw new Error("PopSG PDF transcription provider refused the page");
  const text = parts.filter((part) => part.type === "output_text" && typeof part.text === "string").map((part) => part.text).join("").trim();
  if (!text) throw new Error("PopSG PDF transcription provider returned no readable text");
  return text;
}
