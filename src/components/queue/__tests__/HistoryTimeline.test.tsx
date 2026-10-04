import { describe, test, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { HistoryTimeline } from "../OrderDetailPanel/HistoryTimeline";
import type { HistoryEntry } from "../OrderDetailPanel/types";

function entry(over: Partial<HistoryEntry> & { id: string }): HistoryEntry {
  return {
    from_status: null,
    to_status: "pending",
    note: null,
    actor_id: null,
    actor_type: null,
    created_at: "2026-05-01T10:00:00Z",
    ...over,
  };
}

function renderTimeline(
  entries: HistoryEntry[],
  historyLocale: "ar" | "fr" = "fr",
) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <HistoryTimeline entries={entries} historyLocale={historyLocale} />
    </NextIntlClientProvider>,
  );
}

const WEBHOOK = entry({
  id: "h1",
  to_status: "pending",
  note: "Order received via webhook",
  actor_type: "system",
  created_at: "2026-05-01T08:00:00Z",
});

const CONFIRMED = entry({
  id: "h2",
  from_status: "attempt_1",
  to_status: "confirmed",
  note: "Confirme par l'agent",
  actor_type: "agent",
  created_at: "2026-05-01T09:30:00Z",
});

describe("HistoryTimeline — the prototype's .tl", () => {
  test("reads the story the way it happened, oldest first", () => {
    renderTimeline([CONFIRMED, WEBHOOK]);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-status", "pending");
    expect(items[1]).toHaveAttribute("data-status", "confirmed");
  });

  test("colours each step's dot with the status's own hue", () => {
    renderTimeline([
      entry({ id: "d", to_status: "delivered", created_at: "2026-05-02T10:00:00Z" }),
      CONFIRMED,
    ]);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveClass("h-violet");
    expect(items[1]).toHaveClass("h-green");
  });

  test("says who did it — agent, system or manager", () => {
    renderTimeline([CONFIRMED, WEBHOOK]);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByTestId("history-actor")).toHaveTextContent(/système|systeme/i);
    expect(within(items[1]).getByTestId("history-actor")).toHaveTextContent(/agent/i);
  });

  test("marks where the order stands now — the last step", () => {
    renderTimeline([CONFIRMED, WEBHOOK]);
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("data-current", "true");
    expect(items[1]).toHaveClass("now");
    expect(items[0]).not.toHaveAttribute("data-current");
  });

  test("states the gap between two steps, so a stall is visible", () => {
    renderTimeline([CONFIRMED, WEBHOOK]);
    const items = screen.getAllByRole("listitem");
    expect(within(items[1]).getByTestId("history-gap")).toHaveTextContent("1h30");
  });

  test("keeps the translated note and never leaks a raw status code", () => {
    renderTimeline([WEBHOOK]);
    expect(screen.getByText("Commande reçue via webhook")).toBeTruthy();
    expect(screen.getByText(/En attente/)).toBeTruthy();
    expect(screen.queryByText("pending")).toBeNull();
  });

  test("mirrors for Arabic", () => {
    renderTimeline([CONFIRMED], "ar");
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("dir", "rtl");
    expect(list).toHaveAttribute("lang", "ar");
    expect(screen.getByText(/مؤكد/)).toBeTruthy();
  });

  test("still says so when there is nothing to show", () => {
    renderTimeline([]);
    expect(screen.getByText("Aucun historique")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
