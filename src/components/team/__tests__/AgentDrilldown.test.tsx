import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("swr", () => ({ default: vi.fn().mockReturnValue({ data: undefined }) }));

import { AgentDrilldown } from "../AgentDrilldown";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("AgentDrilldown", () => {
  test("renders queue orders on 200 response", async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse({
        data: [
          {
            id: "o-1",
            status: "assigned",
            customer_name: "Ahmed Gharbi",
            customer_phone: "+21620000001",
            customer_city: "Tunis",
            product_name: "Shampoo",
            variant_label: null,
            total_price: 60,
            currency: "TND",
            quantity: 1,
            callback_scheduled_at: null,
            created_at: new Date().toISOString(),
          },
        ],
      })
    );

    render(
      <AgentDrilldown agentId="a-1" agentName="Agent One" marketId="m-1" onClose={() => {}} />
    );

    expect(await screen.findByText("Ahmed Gharbi")).toBeInTheDocument();
    expect(screen.getByText(/File d'attente \(1\)/)).toBeInTheDocument();
  });

  test("surfaces the API error message on a 403 response (no silent fallback)", async () => {
    fetchMock.mockImplementation(() => jsonResponse({ error: "Forbidden" }, 403));

    render(
      <AgentDrilldown agentId="a-1" agentName="Agent One" marketId="m-1" onClose={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText("Forbidden")).toBeInTheDocument();
    });
  });

  test("shows a status-based message when the error body has no error field", async () => {
    fetchMock.mockImplementation(() => jsonResponse({}, 500));

    render(
      <AgentDrilldown agentId="a-1" agentName="Agent One" marketId="m-1" onClose={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
    });
  });

  test("falls back to a generic message on network rejection", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("net")));

    render(
      <AgentDrilldown agentId="a-1" agentName="Agent One" marketId="m-1" onClose={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText(/net|Erreur de chargement/)).toBeInTheDocument();
    });
  });

  test("passes market_id through to the metrics URL when provided", async () => {
    fetchMock.mockImplementation(() => jsonResponse({ data: [] }));

    render(
      <AgentDrilldown agentId="a-1" agentName="Agent One" marketId="m-tn" onClose={() => {}} />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const calledWith = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calledWith.some((u) => u.includes("/api/team/a-1/queue"))).toBe(true);
  });
});
