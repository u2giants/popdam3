import { describe, expect, it, vi } from "vitest";
import { saveAiModelConfig, type AiModelConfigDraft } from "@/lib/ai-model-config-save";

const draft: AiModelConfigDraft = {
  modelsJson: "[]",
  taskModels: {
    vision_tagging: "google/gemini-3.7-flash:batch",
    vision_tagging_fallback: "",
  },
  displayNames: {},
  openRouterKey: "",
  googleKey: "",
  anthropicKey: "",
  openaiKey: "",
};

describe("saveAiModelConfig", () => {
  it("writes the clicked task-model snapshot and verifies the stored value", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        config: { AI_TASK_MODELS: { value: draft.taskModels } },
      });

    await expect(saveAiModelConfig(call, draft)).resolves.toBeTruthy();
    expect(call).toHaveBeenNthCalledWith(1, "set-config", {
      entries: expect.objectContaining({ AI_TASK_MODELS: draft.taskModels }),
    });
    expect(call).toHaveBeenNthCalledWith(2, "get-config", {
      keys: ["AI_TASK_MODELS"],
    });
  });

  it("does not report success when production still has the previous model", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        config: {
          AI_TASK_MODELS: {
            value: { vision_tagging: "meta-direct/muse-spark-1.3-contributor" },
          },
        },
      });

    await expect(saveAiModelConfig(call, draft)).rejects.toThrow(
      "AI model selection was not persisted",
    );
  });

  it("rejects direct Gemini Batch outside the Image Tagging primary field", async () => {
    const call = vi.fn();
    await expect(saveAiModelConfig(call, {
      ...draft,
      taskModels: { ...draft.taskModels, pdf_extraction: "google-direct/gemini-3.8-flash:batch" },
    })).rejects.toThrow("only be selected as the primary Image Tagging model");
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects direct Gemini Batch until a Google key is present", async () => {
    const call = vi.fn();
    await expect(saveAiModelConfig(call, {
      ...draft,
      taskModels: { ...draft.taskModels, vision_tagging: "google-direct/gemini-3.8-flash:batch" },
      googleKey: "",
    })).rejects.toThrow("Save a Google AI API key");
    expect(call).not.toHaveBeenCalled();
  });

  it("does not let whitespace padding bypass the Google key check", async () => {
    const call = vi.fn();
    await expect(saveAiModelConfig(call, {
      ...draft,
      taskModels: { ...draft.taskModels, vision_tagging: "  google-direct/gemini-3.8-flash:batch " },
      googleKey: "",
    })).rejects.toThrow("Save a Google AI API key");
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects an OpenRouter :batch variant as a fallback", async () => {
    const call = vi.fn();
    await expect(saveAiModelConfig(call, {
      ...draft,
      taskModels: { ...draft.taskModels, vision_tagging_fallback: "google/gemini-3.7-flash:batch" },
    })).rejects.toThrow("only be selected as the primary Image Tagging model");
    expect(call).not.toHaveBeenCalled();
  });
  it("writes a cleared key as blank and verifies it was actually cleared", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: { AI_TASK_MODELS: { value: draft.taskModels }, OPENAI_API_KEY: { value: "" } } });
    await expect(saveAiModelConfig(call, {
      ...draft,
      openRouterKey: "or-saved",
      openaiKey: "",
      savedKeys: { openRouterKey: "or-saved", googleKey: "", anthropicKey: "", openaiKey: "old-openai" },
    })).resolves.toBeTruthy();
    const entries = call.mock.calls[0][1].entries as Record<string, unknown>;
    expect(entries.OPENAI_API_KEY).toBe("");
    expect(entries).not.toHaveProperty("OPENROUTER_API_KEY");
    expect(call).toHaveBeenNthCalledWith(2, "get-config", { keys: ["AI_TASK_MODELS", "OPENAI_API_KEY"] });
  });

  it("does not report success when a cleared key is still stored", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: { AI_TASK_MODELS: { value: draft.taskModels }, ANTHROPIC_API_KEY: { value: "old-anthropic" } } });
    await expect(saveAiModelConfig(call, {
      ...draft,
      savedKeys: { anthropicKey: "old-anthropic" },
    })).rejects.toThrow("was not cleared");
  });
});
