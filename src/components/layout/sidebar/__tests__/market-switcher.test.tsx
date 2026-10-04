import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { TN_MARKET_ID, LY_MARKET_ID } from "@/lib/markets";
import { MarketScopeProvider } from "@/context/market-scope";
import { MarketSwitcher } from "../MarketSwitcher";
import type { AuthUser } from "@/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("swr", async () => {
  const actual = await vi.importActual<typeof import("swr")>("swr");
  return { ...actual, useSWRConfig: () => ({ mutate: vi.fn() }) };
});
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

const superAdmin: AuthUser = {
  id: "u1",
  email: "admin@oms.local",
  full_name: "Admin",
  avatar_url: null,
  role: "super_admin",
  market_id: null,
  locale: "fr",
  direction: "ltr",
};
const tnManager: AuthUser = { ...superAdmin, id: "u2", role: "market_manager", market_id: TN_MARKET_ID };

beforeEach(() => {
  document.cookie = "oms_scope_market=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const count = url.includes(TN_MARKET_ID) ? 12 : url.includes(LY_MARKET_ID) ? 117 : 0;
    return { ok: true, json: async () => ({ count }) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => cleanup());

function renderWith(user: AuthUser, variant: "card" | "rail" | "chip" = "card", scope: "tn" | "ly" | "all" = "tn") {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MarketScopeProvider initialScope={scope}>
        <MarketSwitcher user={user} variant={variant} />
        <button type="button">outside</button>
      </MarketScopeProvider>
    </SWRConfig>,
  );
}

const trigger = () => screen.getByRole("button", { name: /Marché actuel/ });

describe("MarketSwitcher — card", () => {
  it("names the market, its currency, and shows nothing else until asked", () => {
    renderWith(superAdmin);
    expect(trigger()).toHaveTextContent("Tunisie");
    expect(trigger()).toHaveTextContent("TND");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists every market with what waits to be assigned there — where the work is, before switching", async () => {
    renderWith(superAdmin);
    fireEvent.click(trigger());
    const tn = screen.getByRole("option", { name: /Tunisie/ });
    const ly = screen.getByRole("option", { name: /Libye/ });
    const all = screen.getByRole("option", { name: /Tous les marchés/ });
    expect(tn).toHaveAttribute("aria-selected", "true");
    expect(ly).toHaveAttribute("aria-selected", "false");
    expect(await within(tn).findByText("12")).toBeInTheDocument();
    expect(await within(ly).findByText("117")).toBeInTheDocument();
    expect(await within(all).findByText("129")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(`/api/orders/unassigned/count?market_id=${TN_MARKET_ID}`);
    expect(global.fetch).toHaveBeenCalledWith(`/api/orders/unassigned/count?market_id=${LY_MARKET_ID}`);
  });

  it("switches market, closes, and says so", async () => {
    renderWith(superAdmin);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: /Libye/ }));
    expect(document.cookie).toContain("oms_scope_market=ly");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Libye");
    expect(screen.getByRole("status")).toHaveTextContent("Marché : Libye");
  });

  it("switches with 1 · 2 · 3 while the list is open", () => {
    renderWith(superAdmin);
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "3" });
    expect(document.cookie).toContain("oms_scope_market=all");
    expect(trigger()).toHaveTextContent("Tous les marchés");
  });

  it("ignores 1 · 2 · 3 when the list is closed — they are ordinary keys then", () => {
    renderWith(superAdmin);
    fireEvent.keyDown(document, { key: "2" });
    expect(document.cookie).not.toContain("oms_scope_market=ly");
  });

  it("closes on Escape and hands focus back to the card", async () => {
    renderWith(superAdmin);
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("closes on a click elsewhere", () => {
    renderWith(superAdmin);
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("gives a market manager the same card, read-only — one market, nothing to choose", () => {
    renderWith(tnManager);
    expect(screen.queryByRole("button", { name: /Marché actuel/ })).not.toBeInTheDocument();
    const card = screen.getByLabelText(/Marché actuel : Tunisie/);
    expect(card).toHaveTextContent("Tunisie");
    expect(card).toHaveTextContent("TND");
  });
});

describe("MarketSwitcher — phone chip", () => {
  it("opens the list as a sheet from the bottom", () => {
    renderWith(superAdmin, "chip");
    fireEvent.click(trigger());
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("option", { name: /Libye/ }));
    expect(document.cookie).toContain("oms_scope_market=ly");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a plain label for a manager", () => {
    renderWith(tnManager, "chip");
    expect(screen.queryByRole("button", { name: /Marché actuel/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Marché actuel : Tunisie/)).toBeInTheDocument();
  });
});

describe("MarketSwitcher — rail", () => {
  it("is a flag button that opens the same list", () => {
    renderWith(superAdmin, "rail", "ly");
    fireEvent.click(trigger());
    expect(screen.getByRole("option", { name: /Libye/ })).toHaveAttribute("aria-selected", "true");
  });
});
