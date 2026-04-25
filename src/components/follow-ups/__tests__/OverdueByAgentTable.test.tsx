import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OverdueByAgentTable } from "../OverdueByAgentTable";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      "managerView.title": "Relances en retard par agent",
      "managerView.agentColumn": "Agent",
      "managerView.overdueCount": `${params?.count ?? 0} en retard`,
    };
    return map[key] ?? key;
  },
}));

vi.mock("swr", () => ({
  default: (_key: unknown, _fetcher: unknown) => ({
    data: {
      data: [
        { confirming_agent_id: "agent-1", full_name: "Alice Martin", overdue_count: 3 },
        { confirming_agent_id: "agent-2", full_name: "Bob Dupont", overdue_count: 7 },
      ],
    },
    error: null,
    isLoading: false,
  }),
}));

describe("OverdueByAgentTable", () => {
  it("renders agent rows with overdue counts", () => {
    render(
      <OverdueByAgentTable
        marketId="mkt-1"
        locale="fr"
        onSelectAgent={vi.fn()}
      />
    );
    expect(screen.getByText("Alice Martin")).toBeInTheDocument();
    expect(screen.getByText("Bob Dupont")).toBeInTheDocument();
    expect(screen.getByText("3 en retard")).toBeInTheDocument();
    expect(screen.getByText("7 en retard")).toBeInTheDocument();
  });

  it("highlights agents with more than 5 overdue", () => {
    render(
      <OverdueByAgentTable
        marketId="mkt-1"
        locale="fr"
        onSelectAgent={vi.fn()}
      />
    );
    const bobRow = screen.getByText("Bob Dupont").closest("[data-overdue-warning]");
    expect(bobRow).not.toBeNull();
    const aliceRow = screen.getByText("Alice Martin").closest("[data-overdue-warning]");
    expect(aliceRow).toBeNull();
  });

  it("calls onSelectAgent with agent id when row clicked", () => {
    const onSelectAgent = vi.fn();
    render(
      <OverdueByAgentTable
        marketId="mkt-1"
        locale="fr"
        onSelectAgent={onSelectAgent}
      />
    );
    fireEvent.click(screen.getByText("Alice Martin"));
    expect(onSelectAgent).toHaveBeenCalledWith("agent-1");
  });
});
