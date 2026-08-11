import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import type { Alert } from "@/lib/alerts/types";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
          val,
        );
      return val;
    };
    return resolve;
  },
}));

vi.mock("@/context/market-scope", () => ({
  useMarketScope: () => ({ scope: "tn", marketId: "m-tn" }),
}));

function makeAlert(over: Partial<Alert> & { id: string }): Alert {
  return {
    type: "overdue_callback",
    severity: "critical",
    entity_id: over.id,
    entity_kind: "order",
    href: `/orders/${over.id}`,
    primary: "Client",
    secondary: null,
    age_minutes: 90,
    meta: null,
    created_at: "2026-05-01T00:00:00Z",
    market_id: "m-tn",
    ...over,
  };
}

const CRITICAL = makeAlert({
  id: "alert-1",
  type: "overdue_callback",
  severity: "critical",
  primary: "Rappel en retard — Alice",
  secondary: "Tunis",
  age_minutes: 90,
});
const HIGH = makeAlert({
  id: "alert-2",
  type: "unassigned_overflow",
  severity: "high",
  primary: "Commande non assignée — Bob",
  secondary: "Sfax",
  age_minutes: 45,
});
const LOW = makeAlert({
  id: "alert-3",
  type: "order_reopened",
  severity: "low",
  primary: "Commande rouverte — Carol",
  age_minutes: 120,
});

let currentAlerts: Alert[] = [CRITICAL, HIGH];
let currentBySeverity = { critical: 1, high: 1, medium: 0, low: 0 };

const mutateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/useAlerts", () => ({
  useAlerts: () => ({
    alerts: currentAlerts,
    summary: { total: currentAlerts.length },
    totalCount: currentAlerts.length,
    bySeverity: currentBySeverity,
    byType: currentAlerts.reduce<Record<string, number>>((acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      return acc;
    }, {}),
    error: null,
    isLoading: false,
    mutate: mutateMock,
  }),
}));

vi.mock("swr", () => ({
  default: () => ({
    data: { data: [{ id: "a1", full_name: "Agent One", market_id: "m-tn", role: "agent" }] },
  }),
}));

import { AlertsPanel } from "@/components/alerts/AlertsPanel";

const user = {
  id: "u1",
  email: "manager@oms.tn",
  full_name: "Sarah",
  avatar_url: null,
  role: "market_manager" as const,
  market_id: "m-tn",
  locale: "fr" as const,
  direction: "ltr" as const,
};

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  currentAlerts = [CRITICAL, HIGH];
  currentBySeverity = { critical: 1, high: 1, medium: 0, low: 0 };
});

describe("<AlertsPanel />", () => {
  it("renders as a dialog with the alert list", () => {
    render(<AlertsPanel user={user} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Rappel en retard — Alice")).toBeInTheDocument();
    expect(screen.getByText("Commande non assignée — Bob")).toBeInTheDocument();
  });

  it("filters the list by severity tile", () => {
    render(<AlertsPanel user={user} onClose={vi.fn()} />);
    const tiles = screen.getAllByRole("button", { pressed: false });
    const criticalTile = tiles.find((b) => b.textContent?.match(/Critique/i));
    expect(criticalTile).toBeTruthy();
    fireEvent.click(criticalTile!);
    expect(screen.getByText("Rappel en retard — Alice")).toBeInTheDocument();
    expect(screen.queryByText("Commande non assignée — Bob")).not.toBeInTheDocument();
  });

  it("bulk acknowledges selected alerts via /api/alerts/acknowledge", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "" });
    render(<AlertsPanel user={user} onClose={vi.fn()} />);
    const checkboxes = screen
      .getAllByRole("checkbox")
      .filter((c) => (c.getAttribute("aria-label") ?? "").length > 0);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: /Acquitter/ }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/alerts/acknowledge",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.alert_keys).toEqual(["alert-1"]);
    expect(mutateMock).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<AlertsPanel user={user} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("<AlertsPanel /> — the list is banded by severity", () => {
  it("puts each alert under a labelled band carrying its own count", () => {
    // A flat list of nineteen rows gave the eye nothing to land on: a callback
    // 1 h 35 late and a dispatch blocked seven weeks had identical weight.
    currentAlerts = [CRITICAL, HIGH, LOW];
    currentBySeverity = { critical: 1, high: 1, medium: 0, low: 1 };

    render(<AlertsPanel user={user} onClose={vi.fn()} />);

    const critical = screen.getByTestId("alert-band-critical");
    expect(within(critical).getByText("Rappel en retard — Alice")).toBeInTheDocument();
    expect(within(critical).getByTestId("alert-band-count")).toHaveTextContent("1");

    const low = screen.getByTestId("alert-band-low");
    expect(within(low).getByText("Commande rouverte — Carol")).toBeInTheDocument();
  });

  it("orders the bands loudest first", () => {
    currentAlerts = [CRITICAL, HIGH, LOW];
    currentBySeverity = { critical: 1, high: 1, medium: 0, low: 1 };

    render(<AlertsPanel user={user} onClose={vi.fn()} />);

    const bands = screen.getAllByTestId(/^alert-band-(critical|high|medium|low)$/);
    expect(bands.map((b) => b.getAttribute("data-severity"))).toEqual([
      "critical",
      "high",
      "low",
    ]);
  });

  it("shows no band for a severity with nothing in it", () => {
    // The old panel spent a quarter of its summary grid on "BASSE 0".
    render(<AlertsPanel user={user} onClose={vi.fn()} />);
    expect(screen.queryByTestId("alert-band-medium")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alert-band-low")).not.toBeInTheDocument();
  });

  it("collapses a band so a long tail can be folded away", () => {
    render(<AlertsPanel user={user} onClose={vi.fn()} />);

    const high = screen.getByTestId("alert-band-high");
    expect(within(high).getByText("Commande non assignée — Bob")).toBeInTheDocument();

    fireEvent.click(within(high).getByRole("button", { name: /Réduire|Développer/ }));

    expect(screen.queryByText("Commande non assignée — Bob")).not.toBeInTheDocument();
    // The critical band is untouched — collapsing is per band, not global.
    expect(screen.getByText("Rappel en retard — Alice")).toBeInTheDocument();
  });

  it("reads the age on the new scale rather than in raw hours", () => {
    currentAlerts = [makeAlert({ id: "a", type: "dispatch_failure", severity: "critical", age_minutes: 1176 * 60 })];
    currentBySeverity = { critical: 1, high: 0, medium: 0, low: 0 };

    render(<AlertsPanel user={user} onClose={vi.fn()} />);

    expect(screen.getByText("bloquée 49 j")).toBeInTheDocument();
    expect(screen.queryByText(/1176/)).not.toBeInTheDocument();
  });
});
