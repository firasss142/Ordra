import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpsTimeline } from "../FollowUpsTimeline";
import type { OrderFollowUpWithOrder } from "@/types/follow-up";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      overdueBucket: "En retard",
      dueTodayBucket: "Aujourd'hui",
      dueFutureBucket: "À venir",
      noScheduleBucket: "Non planifié",
      logAttempt: "Enregistrer tentative",
      "column.loadMore": "Afficher plus",
    };
    if (key === "footerCount") return `${params?.count ?? 0} suivi(s)`;
    return map[key] ?? key;
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/format", () => ({
  formatCurrency: (v: number) => `${v} TND`,
  classifyDueTime: () => ({ key: "noSchedule" }),
  formatExactTime: () => "10:00",
  minutesBetween: () => 0,
}));

vi.mock("../DueUrgencyBadge", () => ({
  DueUrgencyBadge: () => null,
}));

vi.mock("../FollowUpStatusBadge", () => ({
  FollowUpStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

function makeFollowUp(overrides: Partial<OrderFollowUpWithOrder> = {}): OrderFollowUpWithOrder {
  return {
    id: "fu-1",
    market_id: "mkt-1",
    order_id: "ord-1",
    status: "open",
    campaign_id: null,
    delivery_man_phone: null,
    description: null,
    confirming_agent_id: "agent-1",
    resolved_at: null,
    due_at: null,
    resolution_outcome: null,
    created_by: null,
    created_at: "2024-06-15T08:00:00Z",
    updated_at: "2024-06-15T08:00:00Z",
    order: {
      id: "ord-1",
      customer_name: "Alice Martin",
      customer_phone: "0612345678",
      customer_city: "Tunis",
      total_price: 120,
      status: "confirmed",
      assigned_to: null,
    },
    ...overrides,
  };
}

const NOW = new Date("2024-06-15T10:00:00Z").getTime();

describe("FollowUpsTimeline", () => {
  it("renders overdue section header before due today", () => {
    const overdueFu = makeFollowUp({
      id: "overdue-1",
      due_at: new Date(NOW - 60 * 60 * 1000).toISOString(),
    });
    const todayFu = makeFollowUp({
      id: "today-1",
      due_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    });

    render(
      <FollowUpsTimeline
        rows={[overdueFu, todayFu]}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
        marketCode="TN"
        locale="fr"
        nowMs={NOW}
        onLogAttempt={vi.fn()}
      />
    );

    const headers = screen.getAllByRole("heading");
    const headerTexts = headers.map((h) => h.textContent);
    const overdueIdx = headerTexts.findIndex((t) => t?.includes("En retard"));
    const todayIdx = headerTexts.findIndex((t) => t?.includes("Aujourd'hui"));
    expect(overdueIdx).toBeGreaterThanOrEqual(0);
    expect(todayIdx).toBeGreaterThan(overdueIdx);
  });

  it("does not render empty bucket headers", () => {
    const fu = makeFollowUp({ id: "fu-1", due_at: null });
    render(
      <FollowUpsTimeline
        rows={[fu]}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
        marketCode="TN"
        locale="fr"
        nowMs={NOW}
        onLogAttempt={vi.fn()}
      />
    );
    expect(screen.queryByText("En retard")).not.toBeInTheDocument();
    expect(screen.queryByText("Aujourd'hui")).not.toBeInTheDocument();
    expect(screen.queryByText("À venir")).not.toBeInTheDocument();
    expect(screen.getByText("Non planifié")).toBeInTheDocument();
  });

  it("renders log attempt button for each row", () => {
    const rows = [
      makeFollowUp({ id: "fu-1" }),
      makeFollowUp({ id: "fu-2", order: { id: "ord-2", customer_name: "Bob", customer_phone: "0600000000", customer_city: null, total_price: 80, status: "dispatched", assigned_to: null } }),
    ];
    render(
      <FollowUpsTimeline
        rows={rows}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
        marketCode="TN"
        locale="fr"
        nowMs={NOW}
        onLogAttempt={vi.fn()}
      />
    );
    const buttons = screen.getAllByText("Enregistrer tentative");
    expect(buttons).toHaveLength(2);
  });

  it("calls onLogAttempt with the correct follow-up when button clicked", () => {
    const onLogAttempt = vi.fn();
    const fu = makeFollowUp({ id: "fu-click" });
    render(
      <FollowUpsTimeline
        rows={[fu]}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
        marketCode="TN"
        locale="fr"
        nowMs={NOW}
        onLogAttempt={onLogAttempt}
      />
    );
    fireEvent.click(screen.getByText("Enregistrer tentative"));
    expect(onLogAttempt).toHaveBeenCalledWith(fu);
  });

  it("shows load more button when hasMore=true", () => {
    const fu = makeFollowUp();
    render(
      <FollowUpsTimeline
        rows={[fu]}
        hasMore={true}
        loadingMore={false}
        onLoadMore={vi.fn()}
        marketCode="TN"
        locale="fr"
        nowMs={NOW}
        onLogAttempt={vi.fn()}
      />
    );
    expect(screen.getByText("Afficher plus")).toBeInTheDocument();
  });
});
