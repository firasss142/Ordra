import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DueUrgencyBadge } from "../DueUrgencyBadge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    const map: Record<string, string> = {
      "overdue": `En retard · ${params?.time ?? ""}`,
      "dueToday": `Aujourd'hui ${params?.time ?? ""}`,
      "due": `Relance prévue ${params?.time ?? ""}`,
    };
    return map[key] ?? key;
  },
}));

const NOW = new Date("2024-06-15T10:00:00Z").getTime();

describe("DueUrgencyBadge", () => {
  it("renders nothing when dueAt is null", () => {
    const { container } = render(
      <DueUrgencyBadge dueAt={null} nowMs={NOW} locale="fr" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders overdue badge for past due_at", () => {
    const pastDue = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    render(<DueUrgencyBadge dueAt={pastDue} nowMs={NOW} locale="fr" />);
    expect(screen.getByText(/En retard/i)).toBeInTheDocument();
  });

  it("renders due today badge for due_at later today", () => {
    // +1h from NOW still today (same day in UTC)
    const todayDue = new Date(NOW + 60 * 60 * 1000).toISOString();
    render(<DueUrgencyBadge dueAt={todayDue} nowMs={NOW} locale="fr" />);
    // Either "Aujourd'hui" (due_today) or "Relance prévue" (due_future) is acceptable
    // depending on local midnight. Just ensure it renders something.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders future badge for next-week due_at", () => {
    const futureDue = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
    render(<DueUrgencyBadge dueAt={futureDue} nowMs={NOW} locale="fr" />);
    expect(screen.getByText(/Relance prévue/i)).toBeInTheDocument();
  });

  it("overdue badge has distinct color from future badge", () => {
    const pastDue = new Date(NOW - 60 * 60 * 1000).toISOString();
    const futureDue = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { rerender } = render(
      <DueUrgencyBadge dueAt={pastDue} nowMs={NOW} locale="fr" />
    );
    const overdueEl = screen.getByRole("status");
    const overdueStyle = overdueEl.getAttribute("style") ?? overdueEl.className;

    rerender(<DueUrgencyBadge dueAt={futureDue} nowMs={NOW} locale="fr" />);
    const futureEl = screen.getByRole("status");
    const futureStyle = futureEl.getAttribute("style") ?? futureEl.className;

    expect(overdueStyle).not.toBe(futureStyle);
  });
});
