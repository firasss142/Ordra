import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { TN_MARKET_ID, LY_MARKET_ID } from "@/lib/markets";
import { resolveTranslation } from "@/test/helpers/mockNextIntl";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => {
    const messages = {
      nav: {
        markets: {
          label: "Marché",
          tn: "Tunisie",
          ly: "Libye",
          all: "Tous",
        },
      },
    };
    return resolveTranslation(messages, ns ?? "", key);
  },
}));

import { MarketScopeProvider } from "@/context/market-scope";
import { MarketScopeSwitcher } from "@/components/layout/MarketScopeSwitcher";
import type { AuthUser } from "@/types";

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

const tnManager: AuthUser = {
  ...superAdmin,
  id: "u2",
  role: "market_manager",
  market_id: TN_MARKET_ID,
};

const arSuperAdmin: AuthUser = {
  ...superAdmin,
  locale: "ar",
  direction: "rtl",
};

beforeEach(() => {
  document.cookie = "oms_scope_market=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

function renderWith(user: AuthUser, initialScope: "tn" | "ly" | "all" = "tn") {
  return render(
    <MarketScopeProvider initialScope={initialScope}>
      <MarketScopeSwitcher user={user} />
    </MarketScopeProvider>,
  );
}

describe("MarketScopeSwitcher", () => {
  it("renders nothing for non-super_admin users", () => {
    const { container } = renderWith(tnManager);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active scope label on the trigger and hides the menu by default", () => {
    renderWith(superAdmin, "tn");
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveTextContent("Tunisie");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Libye/ })).not.toBeInTheDocument();
  });

  it("opens the dropdown listing all three options when the trigger is clicked", () => {
    renderWith(superAdmin, "tn");
    act(() => {
      screen.getByRole("button").click();
    });
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Tunisie/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Libye/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: /Tous/ })).toHaveAttribute("aria-selected", "false");
  });

  it("selecting an option changes the scope and closes the menu", () => {
    renderWith(superAdmin, "tn");
    act(() => {
      screen.getByRole("button").click();
    });
    act(() => {
      screen.getByRole("option", { name: /Libye/ }).click();
    });
    expect(document.cookie).toContain("oms_scope_market=ly");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Libye");
  });

  it("closes the menu on Escape", () => {
    renderWith(superAdmin, "tn");
    act(() => {
      screen.getByRole("button").click();
    });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders for RTL super_admin without crashing", () => {
    renderWith(arSuperAdmin, "all");
    expect(screen.getByRole("button")).toHaveTextContent("Tous");
  });
});
