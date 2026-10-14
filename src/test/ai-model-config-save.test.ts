import { describe, expect, it, vi } from "vitest";
import { saveAiModelConfig, saveAiModelPool, type AiModelConfigDraft } from "@/lib/ai-model-config-save";

const draft: AiModelConfigDraft = {
  modelsJson: "[]",
  taskModels: {
    vision_tagging: "google/gemini-3.7-flash:batch",
    vision_tagging_fallback: "",
  },
  displayNames: {},
  modelPool: {},
  openRouterKey: "",
  googleKey: "",
  metaKey: "",
  scaleDownKey: "",
  anthropicKey: "",
  openaiKey: "",
};

describe("saveAiModelConfig", () => {
  it("writes the clicked task-model snapshot and verifies the stored value", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        config: { AI_TASK_MODELS: { value: draft.taskModels }, AI_MODEL_POOL: { value: {} } },
      });

    await expect(saveAiModelConfig(call, draft)).resolves.toBeTruthy();
    expect(call).toHaveBeenNthCalledWith(1, "set-config", {
      entries: expect.objectContaining({ AI_TASK_MODELS: draft.taskModels }),
    });
    expect(call).toHaveBeenNthCalledWith(2, "get-config", {
      keys: ["AI_TASK_MODELS", "AI_MODEL_POOL"],
    });
  });

  it("saves and reads back endpoint-specific Model Pool selections", async () => {
    const modelPool = { openrouter: ["a/model"], "meta-direct": [], "future-endpoint": ["future/model"] };
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: {
        AI_TASK_MODELS: { value: draft.taskModels },
        AI_MODEL_POOL: { value: { "future-endpoint": ["future/model"], "meta-direct": [], openrouter: ["a/model"] } },
      } });

    await expect(saveAiModelConfig(call, { ...draft, modelPool })).resolves.toBeTruthy();
    expect(call).toHaveBeenNthCalledWith(1, "set-config", {
      entries: expect.objectContaining({ AI_MODEL_POOL: { "future-endpoint": ["future/model"], "meta-direct": [], openrouter: ["a/model"] } }),
    });
  });

  it("does not report success when the Model Pool was not persisted", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: {
        AI_TASK_MODELS: { value: draft.taskModels },
        AI_MODEL_POOL: { value: {} },
      } });

    await expect(saveAiModelConfig(call, {
      ...draft,
      modelPool: { openrouter: ["a/model"] },
    })).rejects.toThrow("Model Pool was not persisted");
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
          AI_MODEL_POOL: { value: {} },
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
    })).rejects.toThrow("not supported for that task");
    expect(call).not.toHaveBeenCalled();
  });

  it("allows Meta Direct selections for supported PDF and text-classification routes when a key is configured", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: {
        AI_TASK_MODELS: { value: {
          ...draft.taskModels,
          pdf_extraction: "meta-direct/muse-spark-1.3-contributor",
          text_classification: "meta-direct/muse-spark-1.3-contributor",
        } },
        AI_MODEL_POOL: { value: {} },
      } });
    const taskModels = {
      ...draft.taskModels,
      pdf_extraction: "meta-direct/muse-spark-1.3-contributor",
      text_classification: "meta-direct/muse-spark-1.3-contributor",
    };
    await expect(saveAiModelConfig(call, {
      ...draft,
      taskModels,
      configuredKeys: { metaKey: true },
    })).resolves.toBeTruthy();
    expect(call.mock.calls[0][1].entries).toMatchObject({ AI_TASK_MODELS: taskModels });
  });

  it("allows a Model Pool save without rewriting an unchanged task selection", async () => {
    const taskModels = { ...draft.taskModels, text_classification: "meta-direct/muse-spark-1.3-contributor" };
    const modelPool = { "meta-direct": [] };
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: {
        AI_TASK_MODELS: { value: taskModels },
        AI_MODEL_POOL: { value: modelPool },
      } });

    await expect(saveAiModelConfig(call, {
      ...draft,
      taskModels,
      savedTaskModels: taskModels,
      modelPool,
      configuredKeys: { metaKey: true },
    })).resolves.toBeTruthy();
    expect(call.mock.calls[0][1].entries).toMatchObject({ AI_TASK_MODELS: taskModels, AI_MODEL_POOL: modelPool });
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

  it("requires a saved Meta API key before selecting a Meta Direct model", async () => {
    const call = vi.fn();
    await expect(saveAiModelConfig(call, {
      ...draft,
      taskModels: { ...draft.taskModels, vision_tagging: "meta-direct/muse-spark-1.3-contributor" },
    })).rejects.toThrow("Save a Meta Model API key");
    expect(call).not.toHaveBeenCalled();
  });

  it("saves and verifies Meta and ScaleDown endpoint keys without returning their values", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: {
        AI_TASK_MODELS: { value: draft.taskModels },
        AI_MODEL_POOL: { value: {} },
        META_API_KEY: { value: "", configured: true },
        SCALEDOWN_API_KEY: { value: "", configured: true },
      } });
    await expect(saveAiModelConfig(call, {
      ...draft,
      metaKey: "meta-replacement",
      scaleDownKey: "scaledown-replacement",
    })).resolves.toBeTruthy();
    const entries = call.mock.calls[0][1].entries as Record<string, unknown>;
    expect(entries.META_API_KEY).toBe("meta-replacement");
    expect(entries.SCALEDOWN_API_KEY).toBe("scaledown-replacement");
    expect(call).toHaveBeenNthCalledWith(2, "get-config", {
      keys: ["AI_TASK_MODELS", "AI_MODEL_POOL", "META_API_KEY", "SCALEDOWN_API_KEY"],
    });
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
    })).rejects.toThrow("not supported for that task");
    expect(call).not.toHaveBeenCalled();
  });
  it("does not return old keys to the form and supports an explicit clear action", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: { AI_TASK_MODELS: { value: draft.taskModels }, AI_MODEL_POOL: { value: {} }, OPENAI_API_KEY: { value: "", configured: false } } });
    await expect(saveAiModelConfig(call, {
      ...draft,
      configuredKeys: { openRouterKey: true, openaiKey: true },
      clearKeys: ["openaiKey"],
    })).resolves.toBeTruthy();
    const entries = call.mock.calls[0][1].entries as Record<string, unknown>;
    expect(entries.OPENAI_API_KEY).toBe("");
    expect(entries).not.toHaveProperty("OPENROUTER_API_KEY");
    expect(call).toHaveBeenNthCalledWith(2, "get-config", { keys: ["AI_TASK_MODELS", "AI_MODEL_POOL", "OPENAI_API_KEY"] });
  });

  it("does not report success when a cleared key is still stored", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: { AI_TASK_MODELS: { value: draft.taskModels }, AI_MODEL_POOL: { value: {} }, ANTHROPIC_API_KEY: { value: "", configured: true } } });
    await expect(saveAiModelConfig(call, {
      ...draft,
      clearKeys: ["anthropicKey"],
    })).rejects.toThrow("was not cleared");
  });

  it("saves a replacement without loading or echoing the previous key", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: { AI_TASK_MODELS: { value: draft.taskModels }, AI_MODEL_POOL: { value: {} }, OPENROUTER_API_KEY: { value: "", configured: true } } });
    await expect(saveAiModelConfig(call, { ...draft, openRouterKey: "replacement-key" })).resolves.toBeTruthy();
    expect(call.mock.calls[0][1].entries.OPENROUTER_API_KEY).toBe("replacement-key");
  });

  it("allows the existing direct Gemini selection when its saved key is masked", async () => {
    const taskModels = { ...draft.taskModels, vision_tagging: "google-direct/gemini-3.8-flash:batch" };
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: {
        AI_TASK_MODELS: { value: taskModels },
        AI_MODEL_POOL: { value: {} },
      } });
    await expect(saveAiModelConfig(call, { ...draft, taskModels, configuredKeys: { googleKey: true } })).resolves.toBeTruthy();
  });
  it("accepts the stored selection when the database returns keys in a different order", async () => {
    const taskModels = { vision_tagging: "a/model", vision_tagging_fallback: "b/model", pdf_extraction: "c/model" };
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: { AI_TASK_MODELS: { value: { pdf_extraction: "c/model", vision_tagging_fallback: "b/model", vision_tagging: "a/model" } }, AI_MODEL_POOL: { value: {} } } });
    await expect(saveAiModelConfig(call, { ...draft, taskModels })).resolves.toBeTruthy();
  });

  it("still rejects a stored selection with a different value or an extra key", async () => {
    const { sameTaskModels } = await import("@/lib/ai-model-config-save");
    expect(sameTaskModels({ a: "x", b: "y" }, { b: "y", a: "x" })).toBe(true);
    expect(sameTaskModels({ a: "x", b: "z" }, { a: "x", b: "y" })).toBe(false);
    expect(sameTaskModels({ a: "x", b: "y", c: "" }, { a: "x", b: "y" })).toBe(false);
    expect(sameTaskModels(null, {})).toBe(false);
  });
});

describe("saveAiModelPool", () => {
  it("saves and verifies only the endpoint pool", async () => {
    const modelPool = { openrouter: ["openai/gpt-5"], "meta-direct": [] };
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: { AI_MODEL_POOL: { value: { "meta-direct": [], openrouter: ["openai/gpt-5"] } } } });

    await expect(saveAiModelPool(call, modelPool)).resolves.toBeTruthy();
    expect(call).toHaveBeenNthCalledWith(1, "set-config", { entries: { AI_MODEL_POOL: modelPool } });
    expect(call).toHaveBeenNthCalledWith(2, "get-config", { keys: ["AI_MODEL_POOL"] });
  });

  it("does not report success when the endpoint pool was not persisted", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, config: { AI_MODEL_POOL: { value: {} } } });

    await expect(saveAiModelPool(call, { openrouter: ["openai/gpt-5"] })).rejects.toThrow("Model Pool was not persisted");
  });
});
