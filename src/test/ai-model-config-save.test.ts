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
});
