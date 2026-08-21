import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// SWR mock — return a fixed storefront list.
vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

// next-intl (ConnectionWizard / PlatformIcon may read it lazily; StorefrontsPanel itself doesn't).
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { StorefrontsPanel } from "../StorefrontsPanel";

const MK_TN = "00000000-0000-0000-0000-000000000001";

const STOREFRONTS = [
  {
    id: "sf-active",
    market_id: MK_TN,
    platform: "shopify",
    name: "Shopify Live",
    config: {},
    is_active: true,
    last_webhook_received_at: new Date().toISOString(),
    last_webhook_status: "processed",
    last_webhook_error: null,
    webhook_failure_count: 0,
  },
  {
    id: "sf-never",
    market_id: MK_TN,
    platform: "easy_orders",
    name: "TestSF",
    config: {},
    is_active: true,
    last_webhook_received_at: null,
    last_webhook_status: null,
    last_webhook_error: null,
    webhook_failure_count: 0,
  },
];

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (useSWR as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: STOREFRONTS },
    mutate,
    isLoading: false,
  });
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
});

function mount(readOnly = false) {
  return render(
    <StorefrontsPanel role="super_admin" marketId={MK_TN} marketName="Tunisie" readOnly={readOnly} />,
  );
}

describe("StorefrontsPanel", () => {
  it("lists storefronts with their health badge", () => {
    mount();
    expect(screen.getByText("Shopify Live")).toBeInTheDocument();
    expect(screen.getByText("TestSF")).toBeInTheDocument();
    // sf-active is 'ok' → "Actif" badge; sf-never → "Jamais utilisé".
    // "Actif" also appears as the column header + toggle label, so scope to the badge.
    const activeRow = screen.getByText("Shopify Live").closest("tr")!;
    expect(within(activeRow).getByText("Actif")).toBeInTheDocument();
    expect(screen.getByText("Jamais utilisé")).toBeInTheDocument();
  });

  it("filters to 'Jamais utilisés' when that pill is clicked", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Jamais utilisés/ }));
    expect(screen.queryByText("Shopify Live")).not.toBeInTheDocument();
    expect(screen.getByText("TestSF")).toBeInTheDocument();
  });

  it("archives a storefront via the ⋯ menu (DELETE without hard flag)", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Actions Shopify Live/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archiver" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/storefronts/sf-active", { method: "DELETE" });
  });

  it("opens a typed-name confirm before hard delete, and calls the hard endpoint", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Actions TestSF/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Supprimer définitivement" }));
    // confirm sheet appears; button disabled until the name is typed
    const confirmBtn = await screen.findByRole("button", { name: /Supprimer définitivement/ });
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("TestSF"), "TestSF");
    expect(confirmBtn).toBeEnabled();
    await userEvent.click(confirmBtn);
    expect(global.fetch).toHaveBeenCalledWith("/api/storefronts/sf-never?hard=true", { method: "DELETE" });
  });

  it("in read-only mode hides + Ajouter and disables the active toggle", () => {
    mount(true);
    expect(screen.queryByRole("button", { name: "+ Ajouter" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: /Actif Shopify Live/ });
    expect(toggle).toBeDisabled();
  });
});
