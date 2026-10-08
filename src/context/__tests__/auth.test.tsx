import { describe, test, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { AuthUser } from "@/types";

const sb = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: { user: { id: string; email: string } } | null) => void),
  row: null as null | Record<string, unknown>,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: typeof sb.listener) => {
        sb.listener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: sb.row }) }) }) }),
  }),
}));

import { AuthProvider, useAuth } from "../auth";

const ME: AuthUser = { id: "u1", email: "a@b.c", full_name: "Amel", avatar_url: null, role: "market_manager", market_id: "m", locale: "fr", direction: "ltr" };

function Probe() {
  const { user, patchUser } = useAuth();
  return (
    <>
      <span data-testid="url">{user?.avatar_url ?? "none"}</span>
      <button onClick={() => patchUser({ avatar_url: "https://cdn/a.png" })}>go</button>
    </>
  );
}

describe("AuthProvider.patchUser", () => {
  test("updates the signed-in user in place, so a new photo shows without a reload", () => {
    render(<AuthProvider initialUser={ME}><Probe /></AuthProvider>);
    expect(screen.getByTestId("url")).toHaveTextContent("none");
    act(() => screen.getByRole("button").click());
    expect(screen.getByTestId("url")).toHaveTextContent("https://cdn/a.png");
  });
});

/*
 * Supabase fires a second event after the page loads (SIGNED_IN, TOKEN_REFRESHED) for the same
 * person. Rebuilding the user then handed every reader a NEW object with the same fields; on a
 * hard load the warehouse layout re-rendered while the page was still hydrating, and React threw
 * the page away and showed its loading skeleton again (2026-10-08, the agent's Sortir).
 */
describe("AuthProvider — a repeated event for the same person", () => {
  test("keeps the same user object when nothing about them changed", async () => {
    const seen: Array<AuthUser | null> = [];
    function Spy() {
      seen.push(useAuth().user);
      return null;
    }
    render(<AuthProvider initialUser={ME}><Spy /></AuthProvider>);
    sb.row = { full_name: "Amel", avatar_url: null, role: "market_manager", market_id: "m" };
    const session = { user: { id: "u1", email: "a@b.c" } };
    await act(async () => sb.listener?.("INITIAL_SESSION", session));
    await act(async () => sb.listener?.("SIGNED_IN", session));
    await act(async () => {});
    expect(seen.every((u) => u === seen[0])).toBe(true);
  });

  test("still takes in a real change — a new role", async () => {
    function Role() {
      return <span data-testid="role">{useAuth().user?.role}</span>;
    }
    render(<AuthProvider initialUser={ME}><Role /></AuthProvider>);
    sb.row = { full_name: "Amel", avatar_url: null, role: "super_admin", market_id: "m" };
    const session = { user: { id: "u1", email: "a@b.c" } };
    await act(async () => sb.listener?.("INITIAL_SESSION", session));
    await act(async () => sb.listener?.("SIGNED_IN", session));
    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("super_admin"));
  });
});
