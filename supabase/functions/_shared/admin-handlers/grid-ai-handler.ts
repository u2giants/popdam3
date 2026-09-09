import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";

const MODEL = "gpt-5.6-luna";
type Field = { key: string; label: string };

function outputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of (Array.isArray(payload.output) ? payload.output : []) as Array<Record<string, unknown>>) {
    for (const part of (Array.isArray(item.content) ? item.content : []) as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") return part.text;
    }
  }
  return "";
}

export async function handlePlanGridBulkEdit(body: Record<string, unknown>) {
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const page = typeof body.page === "string" ? body.page.slice(0, 80) : "grid";
  const fields = (Array.isArray(body.fields) ? body.fields : [])
    .filter((field): field is Field => Boolean(field) && typeof field === "object" && typeof field.key === "string" && typeof field.label === "string")
    .slice(0, 120);
  if (!instruction || !fields.length) return err("Instruction and editable fields are required", 400);

  const { data, error } = await serviceClient().from("admin_config").select("value").eq("key", "OPENAI_API_KEY").maybeSingle();
  if (error) return err("Could not read OpenAI configuration", 500);
  const apiKey = typeof data?.value === "string" ? data.value : "";
  if (!apiKey) return err("OPENAI_API_KEY is not configured", 400);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: "medium" },
      input: [
        { role: "system", content: "Convert one bulk spreadsheet edit request into exactly one allowed field and one literal replacement value. Never broaden scope, calculate values, or return more than one edit." },
        { role: "user", content: JSON.stringify({ page, instruction, allowed_fields: fields }) },
      ],
      text: { format: { type: "json_schema", name: "grid_bulk_edit", strict: true, schema: {
        type: "object",
        properties: { field: { type: "string", enum: fields.map((field) => field.key) }, value: { type: ["string", "number", "boolean", "null"] }, summary: { type: "string" } },
        required: ["field", "value", "summary"], additionalProperties: false,
      } } },
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) return err(`OpenAI API error: ${response.status}`, 502);
  let plan: Record<string, unknown>;
  try { plan = JSON.parse(outputText(payload)); } catch { return err("AI returned an invalid edit plan", 502); }
  if (!fields.some((field) => field.key === plan.field)) return err("AI selected a field that is not editable", 400);
  return json({ ok: true, model: MODEL, reasoning_effort: "medium", plan });
}
