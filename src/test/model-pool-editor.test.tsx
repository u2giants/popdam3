import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModelPoolEditor, type ModelPoolOption } from "@/components/settings/ModelPoolEditor";
import { modelInPool, type AiModelPool } from "@/lib/ai-model-options";

const models: ModelPoolOption[] = [
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "openai/gpt-5", name: "GPT-5" },
  { id: "meta-direct/muse-spark-1.3-contributor", name: "Meta Muse Spark 1.3 Contributor" },
  { id: "google-direct/gemini-3.8-flash:batch", name: "Google Gemini 3.8 Flash Batch" },
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
  it("adds a catalog model to the selected endpoint and preserves other endpoint choices", () => {
    const futureValue = ["future/model"];
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
      "future-endpoint": futureValue,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add GPT-5 to dropdowns" }));

    expect(onChange).toHaveBeenCalledWith({
      openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
      "future-endpoint": futureValue,
    });
  });

  it("removes a shown model from only its endpoint", () => {
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Claude Sonnet 4 from dropdowns" }));

    expect(onChange).toHaveBeenCalledWith({
      openrouter: ["openai/gpt-5"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
    });
  });

  it("includes future models automatically for one endpoint without changing another", () => {
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4"],
      "meta-direct": [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Include future models automatically" }));

    expect(onChange).toHaveBeenCalledWith({ "meta-direct": [] });
    expect(modelInPool("openai/new-model", { "meta-direct": [] })).toBe(true);
    expect(modelInPool("meta-direct/new-model", { "meta-direct": [] })).toBe(false);
  });

  it("adds or removes all available models independently for the selected endpoint", () => {
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove all models" }));
    expect(onChange).toHaveBeenCalledWith({
      openrouter: [],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
    });
  });

  it("adds every current catalog model without enabling future endpoints", () => {
    const { onChange } = renderEditor({
      openrouter: ["anthropic/claude-sonnet-4"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add all available models" }));

    expect(onChange).toHaveBeenCalledWith({
      openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
      "meta-direct": ["meta-direct/muse-spark-1.3-contributor"],
    });
  });

  it("saves the Model Pool only when it has unsaved changes", () => {
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
    expect(screen.getByRole("button", { name: "Save Model Pool" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the pool from the dedicated action", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Save Model Pool" }));

    expect(onSave).toHaveBeenCalledOnce();
  });
});
