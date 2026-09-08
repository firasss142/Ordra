import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PreparationConsole } from "../PreparationConsole";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

let page: Record<string, unknown> = { orders: [] };

vi.mock("swr", () => ({
  default: () => ({ data: page, error: undefined, isLoading: false, mutate: vi.fn() }),
}));

beforeEach(() => {
  page = { orders: [] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(cleanup);

/**
 * Préparation after the bench was cleared.
 *
 * Every Libyan order on the bench predated the cutoff, so clearing it empties
 * the queue completely. An empty screen with no explanation reads as a broken
 * page — and worse, it hides that 410 orders are sitting somewhere untouched.
 */
describe("PreparationConsole — a bench that was cleared", () => {
  it("explains an empty queue by naming what was set aside", () => {
    page = { orders: [], total: 0, setAside: 410 };
    render(<PreparationConsole market="ly" initialOrders={[]} dailyGoal={40} />);

    const note = screen.getByTestId("wh-prep-empty");
    expect(note.textContent).toContain("410");
    // The orders still exist at `uploaded`; saying so is the difference between
    // "set aside" and "deleted".
    expect(note.textContent).toMatch(/ni annulées ni supprimées/i);
  });

  it("says nothing about set-aside orders when there are none", () => {
    page = { orders: [], total: 0, setAside: 0 };
    render(<PreparationConsole market="ly" initialOrders={[]} dailyGoal={40} />);
    expect(screen.getByTestId("wh-prep-empty").textContent).toBe("Aucune commande à préparer.");
  });

  it("carries the set-aside count on the queue KPI while work remains", () => {
    page = { orders: [], total: 12, setAside: 410 };
    render(<PreparationConsole market="ly" initialOrders={[]} dailyGoal={40} />);
    expect(screen.getByTestId("wh-prep-set-aside").textContent).toContain("410");
  });
});

/**
 * An empty bench with a busy carrier.
 *
 * Libya, measured 2026-09-07: 78 live orders, 77 of them fulfilled from Darb's
 * own warehouse, one on our bench. The queue correctly showed one parcel, and
 * the agent read the screen as broken because nothing told them where the
 * other 77 went. `carrierWarehouse` was already counted server-side and shown
 * nowhere.
 */
describe("PreparationConsole — work that is not ours", () => {
  it("names the parcels the carrier ships from its own warehouse", () => {
    page = { orders: [], total: 0, carrierWarehouse: 77 };
    render(<PreparationConsole market="ly" initialOrders={[]} dailyGoal={40} />);

    const note = screen.getByTestId("wh-prep-carrier-warehouse");
    expect(note.textContent).toContain("77");
  });

  it("says so even when a parcel IS on the bench, so the total reconciles", () => {
    // One on the bench, 77 at the carrier: without the second figure the
    // agent cannot tell a working day from a broken screen.
    page = { orders: [], total: 1, carrierWarehouse: 77 };
    render(<PreparationConsole market="ly" initialOrders={[]} dailyGoal={40} />);

    expect(screen.getByTestId("wh-prep-carrier-warehouse").textContent).toContain("77");
  });

  it("stays quiet when the carrier holds nothing", () => {
    page = { orders: [], total: 0, carrierWarehouse: 0 };
    render(<PreparationConsole market="ly" initialOrders={[]} dailyGoal={40} />);

    expect(screen.queryByTestId("wh-prep-carrier-warehouse")).toBeNull();
  });
});

describe("PreparationConsole — the daily goal is a market setting, never a constant", () => {
  it("renders no objective when the market has not set one", () => {
    // Libya never set goal_daily_scanned; the old default of 40 turned every
    // morning into "0 / 40", a failure the market had not asked to measure.
    render(<PreparationConsole market="ly" initialOrders={[]} dailyGoal={null} />);
    expect(screen.queryByText(/objectif quotidien/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/ 40/)).not.toBeInTheDocument();
  });
});
