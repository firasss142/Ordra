import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: toast }) }));
const swr = vi.hoisted(() => ({ byPath: {} as Record<string, unknown>, keys: [] as string[], mutate: vi.fn() }));
vi.mock("swr", () => ({
  default: (key: string | null) => {
    if (key) swr.keys.push(key);
    const path = key ? key.split("?")[0] : "";
    return { data: key ? swr.byPath[path] : undefined, isLoading: false, mutate: swr.mutate };
  },
}));

import { JournauxWorkspace } from "../JournauxWorkspace";

const LY = "00000000-0000-0000-0000-000000000002";
const fetchMock = vi.fn();
beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  swr.keys = [];
  swr.byPath = {
    "/api/admin/logs/counts": { received: { total: 58, failed: 0 }, carrier: { total: 412, failed: 3 }, sync: { failed: 1 } },
    "/api/admin/webhook-logs": {
      data: [{ id: "w1", source: "shopify", event: "orders/create", storefront_id: "s-bard", external_id: "#1003", order_id: null, status: "error", error_message: "Invalid webhook signature", created_at: "2026-05-14T11:02:00Z" }],
      pagination: { page: 1, limit: 50, total: 1 },
    },
    "/api/admin/webhook-logs/w1": { data: { id: "w1", external_id: "#1003", status: "error", error_message: "Invalid webhook signature", order_id: null, payload: { id: 1003 }, created_at: "2026-05-14T11:02:00Z" } },
    "/api/storefronts": { data: [{ id: "s-bard", name: "bard", platform: "shopify", market_id: LY }] },
    "/api/admin/carrier-events": { data: [], pagination: { page: 1, limit: 50, total: 0 } },
    "/api/admin/sync-runs": { data: [{ id: "r1", source: "Darb Assabil", started_at: "2026-10-02T13:00:00Z", finished_at: "2026-10-02T13:00:30Z", status: "failed", trigger: "cron", error: "timeout" }] },
    "/api/admin/audit": {
      data: [
        { id: "h1", kind: "settings", at: "2026-05-22T10:00:00Z", actor: "Super Admin", summary: "", meta: { key: "max_call_attempts", old: 5, new: 8, market_id: LY } },
        { id: "u1", kind: "user", at: "2026-05-21T10:00:00Z", actor: "Admin", summary: "", meta: { event_type: "user_created", target: "adel", market_id: LY } },
      ],
    },
  };
  toast.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ replayed_log_id: "w2", result: {} }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("Journaux", () => {
  it("shows the four tabs with what came in over 24 h, errors first", () => {
    render(<JournauxWorkspace />);
    expect(screen.getByRole("heading", { name: "Journaux" })).toBeInTheDocument();
    const tabs = screen.getByRole("tablist");
    expect(within(tabs).getByRole("tab", { name: /Commandes reçues\s*58/ })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: /Transporteurs\s*3 erreurs/ })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: /Synchronisations\s*1 erreur/ })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: "Modifications" })).toBeInTheDocument();
  });

  it("starts on errors only, names the shop, and narrows to a market", async () => {
    render(<JournauxWorkspace />);
    expect(screen.getByRole("button", { name: "Erreurs seulement" })).toHaveAttribute("aria-pressed", "true");
    expect(swr.keys.some((k) => k.startsWith("/api/admin/webhook-logs?") && k.includes("failures_only=true"))).toBe(true);
    expect(screen.getByRole("row", { name: /bard/ })).toHaveTextContent("Erreur");
    await userEvent.selectOptions(screen.getByLabelText("Marché"), LY);
    expect(swr.keys.some((k) => k.startsWith("/api/admin/webhook-logs?") && k.includes(`market_id=${LY}`))).toBe(true);
  });

  it("opens what was received and relaunches a failed one", async () => {
    render(<JournauxWorkspace />);
    await userEvent.click(screen.getByRole("button", { name: "Voir les données" }));
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveTextContent("Données reçues · #1003");
    expect(panel).toHaveTextContent("Invalid webhook signature");
    await userEvent.click(within(panel).getByRole("button", { name: "Relancer le traitement" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/webhook-logs/w1/replay", expect.objectContaining({ method: "POST" })));
  });

  it("Modifications reads in words: the setting, the market, before and after", async () => {
    render(<JournauxWorkspace />);
    await userEvent.click(screen.getByRole("tab", { name: "Modifications" }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Nombre maximum d’appels");
    expect(rows[0]).toHaveTextContent("Libye");
    expect(rows[0]).toHaveTextContent("5");
    expect(rows[0]).toHaveTextContent("8");
    expect(rows[1]).toHaveTextContent("Utilisateur créé · adel");
  });

  it("Synchronisations says what ran, how, and how it ended", async () => {
    render(<JournauxWorkspace />);
    await userEvent.click(screen.getByRole("tab", { name: /Synchronisations/ }));
    const row = screen.getAllByRole("row")[1];
    expect(row).toHaveTextContent("Darb Assabil");
    expect(row).toHaveTextContent("Automatique");
    expect(row).toHaveTextContent("Échec");
    expect(row).toHaveTextContent("timeout");
  });
});
