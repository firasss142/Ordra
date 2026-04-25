import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// next-intl mock
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Avoid rendering ReassignControls internals
vi.mock("@/components/team/ReassignControls", () => ({
  ReassignControls: () => null,
}));

import { AgentStrugglingTable } from "../AgentStrugglingTable";
import type { AgentMetrics } from "@/lib/confirmation-flow/aggregations";

function makeAgent(
  overrides: Partial<AgentMetrics> & { agent_id: string; full_name: string }
): AgentMetrics {
  return {
    avatar_url: null,
    in_attempt_3: 0,
    overdue_callbacks: 0,
    stuck_order_ids: [],
    ttfc_p50_minutes: null,
    ttfc_p90_minutes: null,
    ttfc_samples: [],
    ...overrides,
  };
}

describe("AgentStrugglingTable", () => {
  it("renders empty state when agents array is empty", () => {
    render(<AgentStrugglingTable agents={[]} marketId="m1" onReassignDone={vi.fn()} />);
    expect(screen.getByText("table.empty")).toBeTruthy();
  });

  it("renders one row per agent", () => {
    const agents = [
      makeAgent({ agent_id: "a1", full_name: "Alice" }),
      makeAgent({ agent_id: "a2", full_name: "Bob" }),
    ];
    render(<AgentStrugglingTable agents={agents} marketId="m1" onReassignDone={vi.fn()} />);
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
  });

  it("sorts by attempt_3 count descending by default (struggle score)", () => {
    const agents = [
      makeAgent({ agent_id: "a1", full_name: "Alice", in_attempt_3: 2, overdue_callbacks: 0 }),
      makeAgent({ agent_id: "a2", full_name: "Bob", in_attempt_3: 7, overdue_callbacks: 0 }),
    ];
    render(<AgentStrugglingTable agents={agents} marketId="m1" onReassignDone={vi.fn()} />);
    const rows = screen.getAllByRole("row");
    // rows[0] = header, rows[1] = Bob (higher score), rows[2] = Alice
    expect(rows[1].textContent).toContain("Bob");
    expect(rows[2].textContent).toContain("Alice");
  });

  it("reverses sort on second click of same column header", async () => {
    const user = userEvent.setup();
    const agents = [
      makeAgent({ agent_id: "a1", full_name: "Alice", in_attempt_3: 2, overdue_callbacks: 0 }),
      makeAgent({ agent_id: "a2", full_name: "Bob", in_attempt_3: 7, overdue_callbacks: 0 }),
    ];
    render(<AgentStrugglingTable agents={agents} marketId="m1" onReassignDone={vi.fn()} />);
    // Click "in_attempt_3" header twice to reverse
    const header = screen.getByText(/table.inAttempt3/);
    await user.click(header);
    await user.click(header);
    const rows = screen.getAllByRole("row");
    // Now ascending: Alice (2) first
    expect(rows[1].textContent).toContain("Alice");
  });
});
