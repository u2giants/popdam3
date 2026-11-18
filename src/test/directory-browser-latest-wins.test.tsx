import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callMock = vi.hoisted(() => vi.fn());
const realtimeHandlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());

vi.mock("@/hooks/useAdminApi", () => ({
  useAdminApi: () => ({ call: callMock }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => {
      let handler: ((payload: unknown) => void) | undefined;
      const channel = {
        on: (_event: string, _filter: unknown, cb: (payload: unknown) => void) => {
          handler = cb;
          return channel;
        },
        subscribe: () => {
          if (handler) realtimeHandlers.set(name, handler);
          return channel;
        },
        unsubscribe: vi.fn(),
      };
      return channel;
    },
  },
}));

import DirectoryBrowserTab from "@/components/settings/DirectoryBrowserTab";

const entry = (name: string, is_dir = true) => ({ name, is_dir });

// Agent answers arrive through Realtime; the test decides when each one lands.
function deliver(requestId: string, path: string, entries: ReturnType<typeof entry>[]) {
  const handler = realtimeHandlers.get(`dir-browse-${requestId}`);
  if (!handler) throw new Error(`no realtime listener for ${requestId}`);
  act(() => {
    handler({
      new: {
        value: { request_id: requestId, path, entries, listed_at: "2026-11-18T12:00:00Z" },
      },
    });
  });
}

function countRequests(path: string) {
  return callMock.mock.calls
    .filter(([action, payload]) => action === "request-dir-browse" && payload?.path === path)
    .length;
}

describe("DirectoryBrowserTab latest selection wins", () => {
  beforeEach(() => {
    callMock.mockReset();
    realtimeHandlers.clear();
    // jsdom lacks AbortSignal.timeout; the value itself is irrelevant here.
    if (typeof AbortSignal.timeout !== "function") {
      Object.assign(AbortSignal, { timeout: () => new AbortController().signal });
    }
    // Helper not reachable, so the agent path is used.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    callMock.mockImplementation(async (action: string, payload: { path?: string } = {}) => {
      if (action === "request-dir-browse") return { request_id: `req:${payload.path ?? ""}` };
      if (action === "get-dir-browse-result") return { result: null };
      throw new Error(`unexpected action ${action}`);
    });
  });

  it("drops a late response to an earlier folder selection", async () => {
    render(<DirectoryBrowserTab />);

    await waitFor(() => expect(countRequests("")).toBe(1));
    deliver("req:", "", [entry("alpha"), entry("bravo")]);
    await screen.findByText("alpha");

    // Two quick selections from the same listing.
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(countRequests("alpha")).toBe(1));
    fireEvent.click(screen.getByText("bravo"));
    await waitFor(() => expect(countRequests("bravo")).toBe(1));

    // The newer selection answers first.
    deliver("req:bravo", "bravo", [entry("bravo-child", false)]);
    await screen.findByText("bravo-child");

    // The older selection answers late and must not replace the view.
    deliver("req:alpha", "alpha", [entry("alpha-child", false)]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByText("bravo-child")).toBeInTheDocument();
    expect(screen.queryByText("alpha-child")).not.toBeInTheDocument();
  });
});
