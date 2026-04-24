import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopPerformers } from "./TopPerformers";
import type { PresenceAgent } from "@/lib/dashboard/summary";

function makeAgent(overrides: Partial<PresenceAgent> = {}): PresenceAgent {
  return {
    agent_id: "a1",
    full_name: "Sara",
    avatar_url: null,
    market_id: "m1",
    state: "online",
    queue_size: 0,
    confirmed_today: 10,
    actioned_today: 10,
    confirmation_rate: 90,
    last_seen_at: null,
    ...overrides,
  };
}

const labels = {
  title: "Top performers",
  confirmedLabel: "confirmées",
  onlineCountTemplate: (online: number, total: number) => `${online}/${total} en ligne`,
  viewAllHref: "/fr/team",
  viewAllLabel: "Voir l'équipe",
  emptyLabel: "Aucun agent actif",
};

describe("TopPerformers", () => {
  it("renders empty label when agents array is empty", () => {
    render(<TopPerformers agents={[]} {...labels} />);
    expect(screen.getByText("Aucun agent actif")).toBeInTheDocument();
  });

  it("renders top 3 sorted by confirmation_rate desc", () => {
    const agents = [
      makeAgent({ agent_id: "a1", full_name: "Ahmed", confirmation_rate: 80, actioned_today: 5 }),
      makeAgent({ agent_id: "a2", full_name: "Sara", confirmation_rate: 92, actioned_today: 10 }),
      makeAgent({ agent_id: "a3", full_name: "Leila", confirmation_rate: 85, actioned_today: 8 }),
    ];
    render(<TopPerformers agents={agents} {...labels} />);
    const items = screen.getAllByTestId("top-performer-row");
    expect(items[0]).toHaveTextContent("Sara");
    expect(items[1]).toHaveTextContent("Leila");
    expect(items[2]).toHaveTextContent("Ahmed");
  });

  it("renders only 3 agents even when given more", () => {
    const agents = Array.from({ length: 6 }, (_, i) =>
      makeAgent({ agent_id: `a${i}`, full_name: `Agent${i}`, confirmation_rate: 90 - i }),
    );
    render(<TopPerformers agents={agents} {...labels} />);
    expect(screen.getAllByTestId("top-performer-row")).toHaveLength(3);
  });

  it("tiebreaks by confirmed_today desc when rates are equal", () => {
    const agents = [
      makeAgent({ agent_id: "a1", full_name: "Ahmed", confirmation_rate: 90, confirmed_today: 20 }),
      makeAgent({ agent_id: "a2", full_name: "Sara", confirmation_rate: 90, confirmed_today: 30 }),
    ];
    render(<TopPerformers agents={agents} {...labels} />);
    const items = screen.getAllByTestId("top-performer-row");
    expect(items[0]).toHaveTextContent("Sara");
  });

  it("shows online count footer", () => {
    const agents = [
      makeAgent({ agent_id: "a1", state: "online", full_name: "Sara" }),
      makeAgent({ agent_id: "a2", state: "offline", full_name: "Ahmed" }),
    ];
    render(<TopPerformers agents={agents} {...labels} />);
    expect(screen.getByText("1/2 en ligne")).toBeInTheDocument();
  });

  it("renders view-all link", () => {
    render(<TopPerformers agents={[makeAgent()]} {...labels} />);
    expect(screen.getByRole("link", { name: "Voir l'équipe" })).toHaveAttribute("href", "/fr/team");
  });
});
