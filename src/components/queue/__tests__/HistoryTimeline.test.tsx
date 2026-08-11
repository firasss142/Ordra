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

describe("HistoryTimeline — reading the order's story at a glance", () => {
  test("gives every entry the status icon the rest of the app already uses", () => {
    // The log was text-only: twelve rows of near-identical French sentences,
    // scanned one word at a time. The icon is the thing the eye lands on, and
    // it has to be the SAME mark the queue pill and the console badge wear —
    // one status, one face, everywhere.
    renderTimeline([CONFIRMED, WEBHOOK]);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    // A mark per entry, keyed to the destination status, not a generic bullet.
    expect(within(items[0]).getByTestId("history-icon")).toHaveAttribute(
      "data-status",
      "confirmed",
    );
    expect(within(items[1]).getByTestId("history-icon")).toHaveAttribute(
      "data-status",
      "pending",
    );
  });

  test("colours the mark with the status's own hue, so phase is visible", () => {
    // Warm while the order is still the agent's problem, cool once it is with
    // the carrier. Reusing presentStatus() is what keeps that promise true here
    // without a second hue table to drift out of sync.
    renderTimeline([
      entry({ id: "d", to_status: "delivered", created_at: "2026-05-02T10:00:00Z" }),
      CONFIRMED,
    ]);

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByTestId("history-icon")).toHaveAttribute(
      "data-hue",
      "green",
    );
    expect(within(items[1]).getByTestId("history-icon")).toHaveAttribute(
      "data-hue",
      "violet",
    );
  });

  test("says who did it — agent, system or manager — which the log never showed", () => {
    // order_history has carried actor_type all along and the panel dropped it.
    // "Confirmée" with no author is the single most-asked question about a
    // disputed order, and the answer was already in the row.
    renderTimeline([CONFIRMED, WEBHOOK]);

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByTestId("history-actor")).toHaveTextContent(/agent/i);
    expect(within(items[1]).getByTestId("history-actor")).toHaveTextContent(
      /système|systeme/i,
    );
  });

  test("marks the newest entry as current, and shows relative age beside the date", () => {
    // Newest-first only tells you the order; it does not tell you the log is
    // live. The top entry is where the order stands right now, so it is the one
    // that gets the emphasis.
    renderTimeline([CONFIRMED, WEBHOOK]);

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-current", "true");
    expect(items[1]).not.toHaveAttribute("data-current", "true");
  });

  test("states the gap between two steps, so a stall is visible", () => {
    // Two timestamps 90 minutes apart require mental arithmetic on every pair.
    // The elapsed reading is the actual question being asked of this log:
    // where did this order sit, and for how long.
    renderTimeline([CONFIRMED, WEBHOOK]);

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByTestId("history-gap")).toHaveTextContent("1h30");
  });

  test("keeps the translated note and never leaks a raw status code", () => {
    renderTimeline([WEBHOOK]);

    expect(screen.getByText("Commande reçue via webhook")).toBeTruthy();
    expect(screen.getByText("En attente")).toBeTruthy();
    expect(screen.queryByText("pending")).toBeNull();
  });

  test("mirrors for Arabic, including the transition arrow direction", () => {
    // Libya orders render Arabic inside a French UI, so the list carries its own
    // dir — a French-direction arrow between two Arabic labels reads backwards.
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
