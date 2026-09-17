import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { DuplicatesPageClient } from "../DuplicatesPageClient";
import type { DuplicateGroup, DuplicateGroupMember } from "@/lib/duplicate-orders/groups";

vi.mock("@/context/market-scope", () => ({
  useMarketScope: () => ({ marketId: "m-1" }),
}));

function member(o: Partial<DuplicateGroupMember> = {}): DuplicateGroupMember {
  return {
    id: "m-1",
    external_id: "EXT-1",
    status: "pending",
    created_at: "2026-09-17T10:00:00Z",
    product_id: "p-1",
    product_name: "Widget",
    product_image_url: null,
    quantity: 1,
    unit_price: 100,
    total_price: 129,
    customer_name: "Ahmed",
    customer_address: "12 Rue X",
    customer_city: "Tripoli",
    already_shipped: false,
    is_anchor: false,
    deletable: true,
    ...o,
  };
}

function highGroup(key = "g-high"): DuplicateGroup {
  return {
    key,
    members: [
      member({ id: `${key}-new`, is_anchor: true, created_at: "2026-09-17T10:20:00Z" }),
      member({ id: `${key}-old`, created_at: "2026-09-17T10:00:00Z" }),
    ],
    confidence: "high",
    address_matches: true,
    city_matches: true,
    span_minutes: 20,
  };
}

function reviewGroup(key = "g-review"): DuplicateGroup {
  return { ...highGroup(key), key, confidence: "review", span_minutes: 7000 };
}

function mockGroups(groups: DuplicateGroup[]) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes("/api/orders/duplicates")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { groups, window_hours: 24, autoselect_window_hours: 1 },
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: { succeeded: [], failed: [] } }),
    });
  }) as unknown as typeof fetch;
}

function renderPage(props: Partial<React.ComponentProps<typeof DuplicatesPageClient>> = {}) {
  render(
    // SWR's cache is module-level and would otherwise survive between tests:
    // the first test's empty list is then served to every later one, and the
    // failure reads as "the component rendered nothing" rather than "stale
    // cache". A fresh Map per render isolates them.
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr}>
        <DuplicatesPageClient
          role="market_manager"
          locale="fr"
          userMarketId="m-1"
          initialMarketId="m-1"
          currencyCode="LYD"
          {...props}
        />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("DuplicatesPageClient", () => {
  it("shows the empty state when there is nothing to review", async () => {
    mockGroups([]);
    renderPage();
    expect(await screen.findByText(fr.duplicateOrder.review.empty)).toBeInTheDocument();
  });

  /**
   * The core promise of the screen: a high-confidence duplicate is already
   * ticked, so clearing a screenful is one click rather than twenty.
   */
  it("pre-ticks the duplicate in a high-confidence group", async () => {
    mockGroups([highGroup()]);
    renderPage();
    const box = await screen.findByRole("checkbox");
    await waitFor(() => expect(box).toBeChecked());
  });

  /**
   * Tunisia's "duplicates" are one consumable re-bought days apart, both
   * delivered. Pre-ticking those would delete real revenue.
   */
  it("leaves a review-confidence group untouched", async () => {
    mockGroups([reviewGroup()]);
    renderPage();
    const box = await screen.findByRole("checkbox");
    expect(box).not.toBeChecked();
  });

  it("sends the anchor and sibling ids when deleting", async () => {
    const user = userEvent.setup();
    mockGroups([highGroup()]);
    renderPage();

    await screen.findByRole("checkbox");
    await user.click(await screen.findByRole("button", { name: fr.duplicateOrder.review.deleteSelected }));
    // Confirm step — deletion is never one click away.
    await user.click(await screen.findByRole("button", { name: fr.duplicateOrder.review.confirmCta }));

    await waitFor(() => {
      const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
        String(c[0]).includes("bulk-delete-duplicates"),
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.pairs).toEqual([
        { anchor_id: "g-high-new", sibling_id: "g-high-old" },
      ]);
    });
  });

  it("asks for confirmation before deleting anything", async () => {
    const user = userEvent.setup();
    mockGroups([highGroup()]);
    renderPage();

    await screen.findByRole("checkbox");
    await user.click(await screen.findByRole("button", { name: fr.duplicateOrder.review.deleteSelected }));

    expect(screen.getByText(fr.duplicateOrder.review.confirmTitle)).toBeInTheDocument();
    const deleteCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes("bulk-delete-duplicates"),
    );
    expect(deleteCalls).toHaveLength(0);
  });

  /**
   * Agents get the screen so they can spot a duplicate before calling, but the
   * delete affordances are not theirs. The route rejects them regardless.
   */
  it("gives an agent no way to select or delete", async () => {
    mockGroups([highGroup()]);
    renderPage({ role: "agent" });
    await screen.findByText(fr.duplicateOrder.review.readOnly);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: fr.duplicateOrder.review.deleteSelected }),
    ).not.toBeInTheDocument();
  });

  it("filters to high-confidence groups on demand", async () => {
    const user = userEvent.setup();
    mockGroups([highGroup("g-a"), reviewGroup("g-b")]);
    renderPage();

    await waitFor(() =>
      expect(document.querySelectorAll("[data-duplicate-group]")).toHaveLength(2),
    );
    await user.click(screen.getByRole("button", { name: fr.duplicateOrder.review.confidenceHigh }));
    await waitFor(() =>
      expect(document.querySelectorAll("[data-duplicate-group]")).toHaveLength(1),
    );
  });

  it("reports what was deleted, and what failed, after the run", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/api/orders/duplicates")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { groups: [highGroup()], window_hours: 24, autoselect_window_hours: 1 },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              succeeded: [{ order_id: "g-high-old" }],
              failed: [{ order_id: "x", reason: "status_not_deletable", error: "no" }],
            },
          }),
      });
    }) as unknown as typeof fetch;

    renderPage();
    await screen.findByRole("checkbox");
    await user.click(await screen.findByRole("button", { name: fr.duplicateOrder.review.deleteSelected }));
    await user.click(await screen.findByRole("button", { name: fr.duplicateOrder.review.confirmCta }));

    expect(await screen.findByText(fr.duplicateOrder.review.summaryTitle)).toBeInTheDocument();
    // The failure is named, not swallowed.
    expect(
      screen.getByText(new RegExp(fr.duplicateOrder.review.reasonStatus)),
    ).toBeInTheDocument();
  });

  it("surfaces a load failure instead of pretending there are no duplicates", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "boom" }),
    }) as unknown as typeof fetch;
    renderPage();
    expect(await screen.findByText(fr.duplicateOrder.review.loadError)).toBeInTheDocument();
  });
});
