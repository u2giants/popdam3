import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/hooks/useAdminApi", () => ({ useAdminApi: () => ({ call }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() } }));

import { AiModelsConfigSection } from "@/components/settings/ApisTab";

const metaModelId = "meta-direct/muse-spark-1.3-contributor";

function renderSettings() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AiModelsConfigSection />
    </QueryClientProvider>,
  );
}

describe("AI Model Pool settings integration", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    call.mockReset();
    call.mockImplementation(async (action: string) => {
      if (action === "get-config") {
        return { config: {
          AI_MODELS: { value: [] },
          AI_TASK_MODELS: { value: {
            vision_tagging: metaModelId,
            text_classification: metaModelId,
            pdf_extraction: metaModelId,
          } },
          AI_MODEL_DISPLAY_NAMES: { value: {} },
          AI_MODEL_POOL: { value: { "meta-direct": [metaModelId], openrouter: [] } },
          OPENROUTER_API_KEY: { value: "", configured: false },
          GOOGLE_AI_API_KEY: { value: "", configured: false },
          META_API_KEY: { value: "", configured: true },
          SCALEDOWN_API_KEY: { value: "", configured: false },
          ANTHROPIC_API_KEY: { value: "", configured: false },
          OPENAI_API_KEY: { value: "", configured: false },
        } };
      }
      if (action === "get-openrouter-vision-models") {
        return { models: [
          {
            id: metaModelId,
            name: "Muse Spark Contributor",
            supports_tools: true,
            supports_structured_outputs: true,
            supports_response_format: true,
            input_modalities: ["image"],
            tool_choice_modes: ["named"],
          },
          {
            id: "google-direct/gemini-3.8-flash:batch",
            name: "Google Gemini 3.8 Flash Batch",
            supports_tools: false,
            supports_structured_outputs: true,
            supports_response_format: true,
            input_modalities: ["image"],
            tool_choice_modes: [],
            pricing: null,
          },
          {
            id: "openai/hidden-model",
            name: "Hidden by pool",
            supports_tools: true,
            supports_structured_outputs: true,
            supports_response_format: true,
            input_modalities: ["image"],
            tool_choice_modes: ["named"],
            pricing: { prompt: "0.000001", completion: "0.000001" },
          },
        ] };
      }
      return { ok: true };
    });
  });

  it("loads direct models without an OpenRouter key and keeps supported Meta task choices selectable", async () => {
    renderSettings();

    expect(await screen.findByLabelText("Google AI API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Meta Model API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("ScaleDown API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Anthropic API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("OpenAI API Key")).toBeInTheDocument();
    expect(screen.getByText("Saved in Settings")).toBeInTheDocument();
    await waitFor(() => expect(call).toHaveBeenCalledWith("get-openrouter-vision-models"));
    fireEvent.click(await screen.findByRole("button", { name: /Meta AI \(direct\)/ }));
    expect(await screen.findByText("Muse Spark Contributor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Google AI \(direct\)/ }));
    expect(await screen.findByText("Google Gemini 3.8 Flash Batch")).toBeInTheDocument();
    expect(screen.queryByText("This saved model is not supported by this task selector.")).not.toBeInTheDocument();

    const taskSelectors = screen.getAllByRole("combobox");
    fireEvent.click(taskSelectors[1]);
    expect(await screen.findByRole("option", { name: new RegExp(metaModelId) })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /openai\/hidden-model/ })).not.toBeInTheDocument();
  });
});
