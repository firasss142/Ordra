import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AgentSettings } from "../AgentSettings";
import type { AuthUser } from "@/types";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
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
  it("names who is signed in and on which market", () => {
    render(<AgentSettings user={user()} marketName="Libye" />);
    expect(screen.getByText("Warehouse LY")).toBeInTheDocument();
    expect(screen.getByText("warehouse.ly@oms.local")).toBeInTheDocument();
    expect(screen.getByText("Libye")).toBeInTheDocument();
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

  it("offers no language switch, because locale follows the market", () => {
    // middleware.ts rewrites the locale from the user's market on every
    // request; a switch here would flip back and read as broken.
    render(<AgentSettings user={user()} marketName="Libye" />);
    expect(screen.queryByText(/العربية|langue|language/i)).toBeNull();
  });

  it("gives the initials when there is no avatar", () => {
    render(<AgentSettings user={user({ avatar_url: null })} marketName="Libye" />);
    expect(screen.getByTestId("wm-avatar").textContent).toBe("W");
  });
});
