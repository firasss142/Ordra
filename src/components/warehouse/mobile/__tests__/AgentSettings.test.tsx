import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AgentSettings } from "../AgentSettings";
import type { AuthUser } from "@/types";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("swr", () => ({
  default: (key: string) => ({
    data: key.includes("operator") ? { orders_scanned_today: 7 } : { day: { returnsToday: 2 } },
    error: undefined,
    isLoading: false,
  }),
}));
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

/**
 * Réglages exists because the mockups have no header.
 *
 * Removing the Topbar took the agent's only route to their own identity and,
 * more importantly, to signing out. Everything the Topbar carried that an
 * agent can actually act on has to land here or it is simply gone.
 */
const user = (over: Partial<AuthUser> = {}) =>
  ({
    id: "u1",
    email: "warehouse.ly@oms.local",
    full_name: "Warehouse LY",
    role: "warehouse_agent",
    market_id: "m1",
    avatar_url: null,
    locale: "fr",
    direction: "ltr",
    ...over,
  }) as AuthUser;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentSettings", () => {
  it("names who is signed in, their building, and their role on which market", () => {
    // Prototype R.settings: eyebrow « Agent d'entrepôt · Libye », then a card
    // with the initial, the name and the building.
    render(<AgentSettings user={user()} marketName="Libya" marketCode="ly" siteName="Benghazi" locale="fr" />);
    expect(screen.getByText("Warehouse LY")).toBeInTheDocument();
    expect(screen.getByText("Benghazi")).toBeInTheDocument();
    expect(screen.getByText("Agent d'entrepôt · Libye")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Réglages");
  });

  it("goes back to Aujourd'hui, where the avatar opened it", () => {
    render(<AgentSettings user={user()} marketName="Libye" locale="fr" />);
    expect(screen.getByRole("link", { name: "Retour" })).toHaveAttribute("href", "/fr/warehouse");
  });

  it("signs out through the logout route, then leaves for login", async () => {
    render(<AgentSettings user={user()} marketName="Libye" />);
    fireEvent.click(screen.getByRole("button", { name: /déconnecter/i }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
      expect(replace).toHaveBeenCalledWith("/fr/login");
    });
  });

  it("still leaves for login when the logout call fails", async () => {
    // A network error must not strand the agent on a screen showing a session
    // that may already be dead.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<AgentSettings user={user()} marketName="Libye" />);
    fireEvent.click(screen.getByRole("button", { name: /déconnecter/i }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fr/login"));
  });

  it("cannot be double-fired into two logouts", async () => {
    render(<AgentSettings user={user()} marketName="Libye" />);
    const btn = screen.getByRole("button", { name: /déconnecter/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it("shows only what the prototype shows: no e-mail, no language control", () => {
    // middleware.ts derives the locale from the market, so a language switch
    // would flip straight back; the prototype has no language row either.
    render(<AgentSettings user={user()} marketName="Libye" />);
    expect(screen.queryByText("warehouse.ly@oms.local")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("switch", { name: /langue/i })).toBeNull();
  });

  it("gives the initials when there is no avatar", () => {
    render(<AgentSettings user={user({ avatar_url: null })} marketName="Libye" />);
    expect(screen.getByTestId("wm-avatar").textContent).toBe("W");
  });
});

describe("AgentSettings — the agent's own day and scanner", () => {
  beforeEach(() => localStorage.clear());

  it("translates the market instead of printing the database name", () => {
    render(<AgentSettings user={user()} marketName="Libya" marketCode="ly" />);
    expect(screen.getByText("Agent d'entrepôt · Libye")).toBeInTheDocument();
    expect(screen.queryByText(/Libya/)).toBeNull();
  });

  it("shows today's scans and returns handled", () => {
    render(<AgentSettings user={user()} marketName="Libye" marketCode="ly" />);
    expect(screen.getByTestId("wh-my-scans")).toHaveTextContent("7");
    expect(screen.getByTestId("wh-my-returns")).toHaveTextContent("2");
  });

  it("remembers the scanner preferences on the device", () => {
    render(<AgentSettings user={user()} marketName="Libye" marketCode="ly" />);
    const vibrate = screen.getByRole("switch", { name: /Vibration/ });
    expect(vibrate).toHaveAttribute("aria-checked", "true");
    fireEvent.click(vibrate);
    expect(vibrate).toHaveAttribute("aria-checked", "false");
    expect(JSON.parse(localStorage.getItem("wh.scanner")!)).toMatchObject({ vibrate: false });
  });
});
