import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ModelPoolEditor, type ModelPoolOption } from "@/components/settings/ModelPoolEditor";
import { modelInPool, type AiModelPool } from "@/lib/ai-model-options";

const models: ModelPoolOption[] = [
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "openai/gpt-5", name: "GPT-5" },
];

describe("ModelPoolEditor", () => {
  it("makes Show all unrestricted for future catalog additions and preserves unknown config", () => {
    const onChange = vi.fn<(pool: AiModelPool) => void>();
    const futureValue = { enabled: true };
    render(
      <ModelPoolEditor
        models={models}
        pool={{ openrouter: ["anthropic/claude-sonnet-4"], "future-endpoint": futureValue }}
        onChange={onChange}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByText("OpenRouter"));
    const openRouterGroup = screen.getByText("OpenRouter").closest("details");
    expect(openRouterGroup).not.toBeNull();
    fireEvent.click(within(openRouterGroup as HTMLElement).getByRole("button", { name: "Show all" }));

    const nextPool = onChange.mock.calls[0][0];
    expect(nextPool).toEqual({ "future-endpoint": futureValue });
    expect(modelInPool("new-provider/new-model", nextPool)).toBe(true);
  });

  it("changes only the chosen endpoint and keeps unknown config entries", () => {
    const onChange = vi.fn<(pool: AiModelPool) => void>();
    const futureValue = ["future/model"];
    render(
      <ModelPoolEditor
        models={models}
        pool={{ openrouter: ["anthropic/claude-sonnet-4"], "future-endpoint": futureValue }}
        onChange={onChange}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByText("OpenRouter"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show GPT-5 in dropdowns" }));

    expect(onChange).toHaveBeenCalledWith({
      openrouter: ["anthropic/claude-sonnet-4", "openai/gpt-5"],
      "future-endpoint": futureValue,
    });
  });
});
