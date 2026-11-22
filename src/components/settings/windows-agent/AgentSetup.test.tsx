import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WindowsAgentSetup } from "./AgentSetup";

const { call, testStatusUpdate } = vi.hoisted(() => ({
  call: vi.fn(),
  testStatusUpdate: vi.fn(),
}));

vi.mock("@/hooks/useAdminApi", () => ({
  useAdminApi: () => ({ call }),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState<T>(initial: T) {
      const [value, setValue] = react.useState(initial);
      if (initial !== "idle") return [value, setValue];
      // React ignores state updates after unmount. Observe the attempted update.
      return [value, (next: T) => {
        testStatusUpdate(next);
        setValue(next);
      }];
    },
  };
});

function renderSetup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <WindowsAgentSetup onTokenGenerated={vi.fn()} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  call.mockReset();
  testStatusUpdate.mockClear();
});

it.each(["success", "error"])("ignores initial render request %s after unmount", async (outcome) => {
  let finish!: () => void;
  const request = new Promise((resolve, reject) => {
    finish = outcome === "success"
      ? () => resolve({ ok: true, job_id: "test-job" })
      : () => reject(new Error("Could not send test render"));
  });
  call.mockImplementation((action) => action === "send-test-render" ? request : Promise.resolve({}));

  const { unmount } = renderSetup();
  fireEvent.click(screen.getByRole("button", { name: "Send Test Job" }));
  expect(testStatusUpdate).toHaveBeenCalledWith("sending");
  unmount();
  testStatusUpdate.mockClear();
  await act(async () => { finish(); });

  expect(testStatusUpdate).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalledWith("check-render-job", expect.anything());
});

it("polls and displays success while mounted", async () => {
  call.mockImplementation(async (action) => {
    if (action === "send-test-render") return { ok: true, job_id: "test-job" };
    if (action === "check-render-job") return { status: "completed" };
    return {};
  });
  renderSetup();
  fireEvent.click(screen.getByRole("button", { name: "Send Test Job" }));

  expect(await screen.findByText(/Completed successfully/)).toBeVisible();
  expect(call).toHaveBeenCalledWith("check-render-job", { job_id: "test-job" });
});

it("displays the initial request error while mounted", async () => {
  call.mockImplementation(async (action) => {
    if (action === "send-test-render") throw new Error("Could not send test render");
    return {};
  });
  renderSetup();
  fireEvent.click(screen.getByRole("button", { name: "Send Test Job" }));

  expect(await screen.findByText(/Could not send test render/)).toBeVisible();
  expect(call).not.toHaveBeenCalledWith("check-render-job", expect.anything());
});
