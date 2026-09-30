import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentCapacityRow } from "@/hooks/useAgentCapacity";

const mockUseAgentCapacity = vi.fn();
vi.mock("@/hooks/useAgentCapacity", () => ({
  useAgentCapacity: (...a: unknown[]) => mockUseAgentCapacity(...a),
}));

vi.mock("@/components/ui/Avatar", () => ({
  Avatar: () => <span data-testid="avatar" />,
}));

import { AgentReadinessPanel } from "../AgentReadinessPanel";

function agent(over: Partial<AgentCapacityRow> & { id: string }): AgentCapacityRow {
  return {
    full_name: over.id,
    avatar_url: null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
    last_action_at: null,
    queue_size: 0,
    confirmation_rate: 0,
    actioned_count: 0,
    is_available: true,
    available_since: null,
    assigned_today: 0,
    share_pct: null,
    receiving_orders: true,
    ...over,
  };
}

function setAgents(agents: AgentCapacityRow[], mutate = vi.fn()) {
  mockUseAgentCapacity.mockReturnValue({ agents, isLoading: false, mutate, error: null });
  return mutate;
}

beforeEach(() => {
  mockUseAgentCapacity.mockReset();
  vi.restoreAllMocks();
});

describe("the outage nobody would otherwise notice", () => {
  test("says so loudly when no one can receive orders", () => {
    setAgents([
      agent({ id: "a", is_available: false, receiving_orders: false }),
      agent({ id: "b", is_available: false, receiving_orders: false }),
    ]);
    render(<AgentReadinessPanel marketId="m-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Personne n'est disponible/i);
  });

  test("stays quiet while at least one agent is ready", () => {
    setAgents([agent({ id: "a" }), agent({ id: "b", is_available: false, receiving_orders: false })]);
    render(<AgentReadinessPanel marketId="m-1" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("warns when the percentage split does not total 100", () => {
    setAgents([agent({ id: "a", share_pct: 40 }), agent({ id: "b", share_pct: 30 })]);
    render(<AgentReadinessPanel marketId="m-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/ne totalise pas 100/i);
  });
});

describe("telling paused apart from gone quiet", () => {
  test("an agent who declared ready but stopped beating reads as session inactive", () => {
    setAgents([agent({ id: "a", is_available: true, receiving_orders: false })]);
    render(<AgentReadinessPanel marketId="m-1" />);
    expect(screen.getByText("Session inactive")).toBeInTheDocument();
  });

  test("an agent who paused themselves reads as paused", () => {
    setAgents([agent({ id: "a", is_available: false, receiving_orders: false })]);
    render(<AgentReadinessPanel marketId="m-1" />);
    expect(screen.getByText("En pause")).toBeInTheDocument();
  });
});

describe("progress against the configured share", () => {
  test("shows today's count against the target", () => {
    setAgents([
      agent({ id: "ahmed", share_pct: 40, assigned_today: 30 }),
      agent({ id: "sara", share_pct: 60, assigned_today: 70 }),
    ]);
    render(<AgentReadinessPanel marketId="m-1" />);
    expect(screen.getByText(/30\/40/)).toBeInTheDocument();
    expect(screen.getByText(/70\/60/)).toBeInTheDocument();
  });
});

describe("forcing an agent off", () => {
  test("a manager can stand down an agent whose laptop died", async () => {
    const mutate = setAgents([agent({ id: "a", full_name: "Ahmed" })]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { released: 4 } })));

    render(<AgentReadinessPanel marketId="m-1" canForceOff />);
    await userEvent.click(screen.getByRole("button", { name: /Mettre en pause/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/agent/availability");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      is_available: false,
      agent_id: "a",
    });
    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });

  test("the control is absent without the permission", () => {
    setAgents([agent({ id: "a" })]);
    render(<AgentReadinessPanel marketId="m-1" />);
    expect(screen.queryByRole("button", { name: /Mettre en pause/i })).toBeNull();
  });

  test("there is nothing to stand down for an already paused agent", () => {
    setAgents([agent({ id: "a", is_available: false, receiving_orders: false })]);
    render(<AgentReadinessPanel marketId="m-1" canForceOff />);
    expect(screen.queryByRole("button", { name: /Mettre en pause/i })).toBeNull();
  });
});
