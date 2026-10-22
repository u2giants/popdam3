import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModelPoolEditor, type ModelPoolOption } from "@/components/settings/ModelPoolEditor";
import { modelInPool, type AiModelPool } from "@/lib/ai-model-options";

const models: ModelPoolOption[] = [
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    supportsTools: true,
    supportsStructuredOutputs: true,
    supportsResponseFormat: true,
    toolChoiceModes: ["named", "required", "auto"],
    inputModalities: ["text", "image"],
    imageInput: true,
    pricing: { prompt: "0.000003", completion: "0.000015" },
  },
  {
    id: "openai/gpt-5",
    name: "GPT-5",
    supportsTools: true,
    supportsStructuredOutputs: true,
    supportsResponseFormat: true,
    toolChoiceModes: ["named", "required", "auto"],
    inputModalities: ["text"],
    imageInput: false,
    pricing: { prompt: "0.00000125", completion: "0.00001" },
  },
  {
    id: "meta-direct/muse-spark-1.3-contributor",
    name: "Meta Muse Spark 1.3 Contributor",
    supportsTools: true,
    supportsStructuredOutputs: true,
    supportsResponseFormat: true,
    toolChoiceModes: ["auto"],
    inputModalities: ["text", "image"],
    imageInput: true,
    pricing: { prompt: "0.0000001", completion: "0.0000002" },
  },
  {
    id: "google-direct/gemini-3.8-flash:batch",
    name: "Google Gemini 3.8 Flash Batch",
    supportsTools: false,
    supportsStructuredOutputs: true,
    supportsResponseFormat: true,
    toolChoiceModes: [],
    inputModalities: ["text", "image"],
    imageInput: true,
    pricing: null,
  },
];

function renderEditor(pool: AiModelPool, onChange = vi.fn<(pool: AiModelPool) => void>(), onSave = vi.fn()) {
  render(
    <ModelPoolEditor
      models={models}
      pool={pool}
      onChange={onChange}
      loading={false}
      hasChanges={true}
      saving={false}
      onSave={onSave}
    />,
  );
  return { onChange, onSave };
}

describe("ModelPoolEditor", () => {
  it("shows every model with capabilities and pricing", () => {
    renderEditor({});
    expect(screen.getByText("Claude Sonnet 4")).toBeInTheDocument();
    expect(screen.getByText("GPT-5")).toBeInTheDocument();
    expect(screen.getByText("Meta Muse Spark 1.3 Contributor")).toBeInTheDocument();
    expect(screen.getByText("Google Gemini 3.8 Flash Batch")).toBeInTheDocument();
    expect(screen.getAllByText("Vision").length).toBeGreaterThan(0);
    expect(screen.getAllByText("JSON schema").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$3/$15").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$1.25/$10").length).toBeGreaterThan(0);
  });

  it("disables one model without dropping other endpoint choices", () => {
    const futureValue = ["future/model"];
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
      "future-endpoint": futureValue,
    });

    fireEvent.click(screen.getByRole("switch", { name: "Disable Claude Sonnet 4" }));

    expect(onChange).toHaveBeenCalledWith({
      openrouter: ["openai/gpt-5"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
      "future-endpoint": futureValue,
    });
  });

  it("enables one model from a customized endpoint list", () => {
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4"],
      "meta-direct": [],
    });

    fireEvent.click(screen.getByRole("switch", { name: "Enable GPT-5" }));

    expect(onChange).toHaveBeenCalledWith({
      openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
      "meta-direct": [],
    });
  });

  it("turns off all shown models across endpoints that have rows", () => {
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Turn off shown" }));

    expect(onChange).toHaveBeenCalledWith({
      openrouter: [],
      "google-direct": [],
      "meta-direct": [],
      "scaledown-direct": [],
    });
  });

  it("turns on all shown models as explicit per-endpoint lists", () => {
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Turn on shown" }));

    expect(onChange).toHaveBeenCalledWith({
      openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
      "google-direct": ["google-direct/gemini-3.8-flash:batch"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
      "scaledown-direct": ["scaledown/summarize"],
    });
  });

  it("resets customized endpoints back to all models", () => {
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
      "future-endpoint": ["future/model"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset to all models" }));

    expect(onChange).toHaveBeenCalledWith({ "future-endpoint": ["future/model"] });
    expect(modelInPool("openai/new-model", { "future-endpoint": ["future/model"] })).toBe(true);
  });

  it("saves availability only when it has unsaved changes", () => {
    const onSave = vi.fn();
    render(
      <ModelPoolEditor
        models={models}
        pool={{}}
        onChange={vi.fn()}
        loading={false}
        hasChanges={false}
        saving={false}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("button", { name: "Save available models" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves from the dedicated action", () => {
    const onSave = vi.fn();
    render(
      <ModelPoolEditor
        models={models}
        pool={{}}
        onChange={vi.fn()}
        loading={false}
        hasChanges={true}
        saving={false}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save available models" }));

    expect(onSave).toHaveBeenCalledOnce();
  });
});
