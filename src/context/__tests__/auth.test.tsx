import { describe, test, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { AuthUser } from "@/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
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
