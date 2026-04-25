import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Topbar } from "@/components/layout/Topbar";

// Capture the auth-state listener so tests can trigger it
let authListener: ((event: string, session: unknown) => void) | null = null;

const mockOnAuthStateChange = vi.fn((cb: (event: string, session: unknown) => void) => {
  authListener = cb;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: { onAuthStateChange: mockOnAuthStateChange },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const managerUser = {
  id: "user-1",
  email: "manager@oms.tn",
  full_name: "Sarah Ben Ali",
  avatar_url: null,
  role: "market_manager" as const,
  market_id: "00000000-0000-0000-0000-000000000001",
  locale: "fr" as const,
  direction: "ltr" as const,
};

beforeEach(() => {
  authListener = null;
  vi.clearAllMocks();
});

afterEach(() => {
  authListener = null;
});

describe("Topbar", () => {
  it("renders the user full name", () => {
    render(<Topbar user={managerUser} marketName="Tunisia" />);
    expect(screen.getByText("Sarah Ben Ali")).toBeInTheDocument();
  });

  it("renders the market name", () => {
    render(<Topbar user={managerUser} marketName="Tunisia" />);
    expect(screen.getByText("Tunisia")).toBeInTheDocument();
  });

  it("renders the localized user role label", () => {
    render(<Topbar user={managerUser} marketName="Tunisia" />);
    // managerUser locale is fr → market_manager → "Manager"
    expect(screen.getByText("Manager")).toBeInTheDocument();
  });

  it("shows no session-expiry banner initially", () => {
    render(<Topbar user={managerUser} marketName="Tunisia" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows session-expiry banner when TOKEN_REFRESHED fails (session null)", async () => {
    render(<Topbar user={managerUser} marketName="Tunisia" />);
    await act(async () => {
      authListener?.("TOKEN_REFRESHED", null);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/session expir/i)).toBeInTheDocument();
  });

  it("does not show banner when TOKEN_REFRESHED has a valid session", async () => {
    render(<Topbar user={managerUser} marketName="Tunisia" />);
    await act(async () => {
      authListener?.("TOKEN_REFRESHED", { access_token: "valid" });
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
