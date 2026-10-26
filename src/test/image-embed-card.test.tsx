import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/usePersistentOperation", () => ({
  usePersistentOperation: () => ({
    state: {
      status: "completed",
      progress: {
        stale_found: 55,
        enqueued: 55,
        failed: 0,
        image_embed_status: { pending: 55, leased: 0, failed: 0, done: 44, workers_fresh: true },
      },
    },
    start: vi.fn(),
    stop: vi.fn(),
    isHydrating: false,
  }),
}));

import { ImageEmbedCard } from "@/components/settings/ImageEmbedCard";

describe("ImageEmbedCard", () => {
  it("reports backfill counts and the queue snapshot without claiming to embed", () => {
    render(<ImageEmbedCard />);
    expect(screen.getByText("55 stale found")).toBeInTheDocument();
    expect(screen.getByText("55 enqueued")).toBeInTheDocument();
    expect(screen.getByText(/queue 55 pending/)).toBeInTheDocument();
    expect(screen.getByText("GPU worker online")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enqueue stale vectors" })).toBeInTheDocument();
  });

  it("derives the drain estimate only from the measured one-GPU rate split across 2 GPUs", () => {
    render(<ImageEmbedCard />);
    // 55 images / (2 GPUs x 25 img/s) = 1.1 s … / (2 x 15) = 1.8 s -> "1 min"
    const estimate = screen.getByText(/est\. GPU drain/);
    expect(estimate.textContent).toContain("one-GPU measured rate ÷ 2 GPUs");
    const tooltip = document.querySelector('[title^="Drain-time estimate"]')?.getAttribute("title") ?? "";
    expect(tooltip).toContain("15–25 img/s");
    expect(tooltip).toContain("no extra batch or GPU speedup is claimed");
  });
});
