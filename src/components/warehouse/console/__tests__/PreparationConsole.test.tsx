import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PreparationConsole } from "../PreparationConsole";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
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
