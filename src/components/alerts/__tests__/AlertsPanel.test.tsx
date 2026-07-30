import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import type { Alert } from "@/app/api/alerts/summary/route";

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
          val
        );
      return val;
    };
    return resolve;
  },
}));

vi.mock("@/context/market-scope", () => ({
  useMarketScope: () => ({ scope: "tn", marketId: "m-tn" }),
}));

const ALERTS: Alert[] = [
  {
    id: "alert-1",
    type: "overdue_callback",
    severity: "critical",
    entity_id: "order-1",
    primary: "Rappel en retard — Alice",
    secondary: "Tunis",
    href: "/orders?open=order-1",
    meta: { value: 90 },
  } as unknown as Alert,
  {
    id: "alert-2",
    type: "unassigned_overflow",
    severity: "high",
    entity_id: "order-2",
    primary: "Commande non assignée — Bob",
    secondary: "Sfax",
    href: "/orders?open=order-2",
    meta: { value: 45 },
  } as unknown as Alert,
];

const mutateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/useAlerts", () => ({
  useAlerts: () => ({
    alerts: ALERTS,
    summary: { total: 2 },
    totalCount: 2,
    bySeverity: { critical: 1, high: 1, medium: 0, low: 0 },
    byType: { overdue_callback: 1, unassigned_overflow: 1 },
    error: null,
    isLoading: false,
    mutate: mutateMock,
  }),
}));

vi.mock("swr", () => ({
  default: () => ({ data: { data: [{ id: "a1", full_name: "Agent One", market_id: "m-tn", role: "agent" }] } }),
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
});

describe("<AlertsPanel />", () => {
  it("renders as a dialog with severity counts and the alert list", () => {
    render(<AlertsPanel user={user} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Rappel en retard — Alice")).toBeInTheDocument();
    expect(screen.getByText("Commande non assignée — Bob")).toBeInTheDocument();
  });

  it("filters the list by severity tile", () => {
    render(<AlertsPanel user={user} onClose={vi.fn()} />);
    // Click the "critical" tile — only the critical alert remains
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
