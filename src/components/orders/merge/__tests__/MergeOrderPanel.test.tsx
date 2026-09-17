import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { MergeOrderPanel } from "../MergeOrderPanel";

const SURVIVOR = {
  id: "surv-1",
  external_id: "EXT-SURV",
  customer_address: "12 Rue X",
  customer_city: "Tripoli",
  delivery_fee: 7,
  card_payment: false,
  dexpress_state_id: null,
  market_code: "ly",
  items: [{ quantity: 1, unit_price: 249 }],
};

function candidate(o: Record<string, unknown> = {}) {
  return {
    id: "abs-1",
    external_id: "EXT-ABS",
    status: "pending",
    created_at: "2026-09-17T11:15:00Z",
    product_id: "p-2",
    product_name: "مصحف الحفظ الميسر",
    product_image_url: null,
    quantity: 1,
    unit_price: 249,
    total_price: 249,
    delivery_fee: 0,
    customer_name: "محمود السنوسي",
    customer_address: "12 Rue X",
    customer_city: "Tripoli",
    address_matches: true,
    city_matches: true,
    ...o,
  };
}

function mockApi(payload: Record<string, unknown>, mergeOk = true) {
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes("merge-candidates")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: payload }) });
    }
    if (init?.method === "POST") {
      return Promise.resolve({
        ok: mergeOk,
        status: mergeOk ? 200 : 400,
        json: () =>
          Promise.resolve(
            mergeOk
              ? { data: { new_total: 505, items_moved: 1 } }
              : { error: "x", reason: "address_choice_required" },
          ),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as unknown as typeof fetch;
}

function renderPanel(props: Partial<React.ComponentProps<typeof MergeOrderPanel>> = {}) {
  const onMerged = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr}>
        <MergeOrderPanel
          open
          onClose={vi.fn()}
          survivor={SURVIVOR}
          locale="fr"
          currencyCode="LYD"
          onMerged={onMerged}
          {...props}
        />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
  return { onMerged };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("MergeOrderPanel", () => {
  it("tells the agent when merging is off for this market", async () => {
    mockApi({ enabled: false, window_hours: 0, candidates: [] });
    renderPanel();
    expect(await screen.findByText(fr.orderMerge.disabled)).toBeInTheDocument();
  });

  it("says so when there is nothing to merge", async () => {
    mockApi({ enabled: true, window_hours: 24, candidates: [] });
    renderPanel();
    expect(
      await screen.findByText(fr.orderMerge.noCandidates.replace("{hours}", "24")),
    ).toBeInTheDocument();
  });

  it("lists a candidate and merges it when the addresses agree", async () => {
    const user = userEvent.setup();
    mockApi({ enabled: true, window_hours: 24, candidates: [candidate()] });
    const { onMerged } = renderPanel();

    await user.click(await screen.findByRole("button", { name: fr.orderMerge.mergeCta }));
    await user.click(await screen.findByRole("button", { name: fr.orderMerge.confirm }));

    await waitFor(() => expect(onMerged).toHaveBeenCalled());
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[1] as RequestInit)?.method === "POST",
    );
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.absorbed_id).toBe("abs-1");
  });

  /**
   * The heart of the feature. When the two orders disagree on where the parcel
   * goes, the agent must say which address wins — no default, and the confirm
   * button stays disabled until they choose.
   */
  it("blocks the merge until an address is chosen when they differ", async () => {
    const user = userEvent.setup();
    mockApi({
      enabled: true,
      window_hours: 24,
      candidates: [
        candidate({
          address_matches: false,
          customer_address: "99 Avenue Y",
          customer_city: "Benghazi",
        }),
      ],
    });
    renderPanel();

    await user.click(await screen.findByRole("button", { name: fr.orderMerge.mergeCta }));

    expect(screen.getByText(fr.orderMerge.addressDiffer)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: fr.orderMerge.confirm })).toBeDisabled();
  });

  it("shows both addresses in full so the choice is informed", async () => {
    const user = userEvent.setup();
    mockApi({
      enabled: true,
      window_hours: 24,
      candidates: [
        candidate({
          address_matches: false,
          customer_address: "99 Avenue Y",
          customer_city: "Benghazi",
        }),
      ],
    });
    renderPanel();
    await user.click(await screen.findByRole("button", { name: fr.orderMerge.mergeCta }));

    expect(screen.getByText(/12 Rue X/)).toBeInTheDocument();
    expect(screen.getByText(/99 Avenue Y/)).toBeInTheDocument();
  });

  it("enables the merge once an address is picked", async () => {
    const user = userEvent.setup();
    mockApi({
      enabled: true,
      window_hours: 24,
      candidates: [
        candidate({
          address_matches: false,
          customer_address: "99 Avenue Y",
          customer_city: "Benghazi",
        }),
      ],
    });
    renderPanel();
    await user.click(await screen.findByRole("button", { name: fr.orderMerge.mergeCta }));
    await user.click(screen.getByLabelText(fr.orderMerge.addressUseAbsorbed));

    expect(screen.getByRole("button", { name: fr.orderMerge.confirm })).toBeEnabled();
  });

  it("sends the chosen address to the server", async () => {
    const user = userEvent.setup();
    mockApi({
      enabled: true,
      window_hours: 24,
      candidates: [
        candidate({
          address_matches: false,
          customer_address: "99 Avenue Y",
          customer_city: "Benghazi",
        }),
      ],
    });
    renderPanel();
    await user.click(await screen.findByRole("button", { name: fr.orderMerge.mergeCta }));
    await user.click(screen.getByLabelText(fr.orderMerge.addressUseAbsorbed));
    await user.click(screen.getByRole("button", { name: fr.orderMerge.confirm }));

    await waitFor(() => {
      const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => (c[1] as RequestInit)?.method === "POST",
      );
      expect(JSON.parse((call![1] as RequestInit).body as string).address_choice).toBe(
        "absorbed",
      );
    });
  });

  /** One parcel, one delivery fee — shown before the agent commits. */
  it("previews a single delivery fee, not one per order", async () => {
    const user = userEvent.setup();
    mockApi({ enabled: true, window_hours: 24, candidates: [candidate()] });
    renderPanel();
    await user.click(await screen.findByRole("button", { name: fr.orderMerge.mergeCta }));

    expect(screen.getByText(fr.orderMerge.deliveryFee)).toBeInTheDocument();
    // 249 + 249 + 7 = 505
    expect(screen.getByText(/505/)).toBeInTheDocument();
  });

  it("states plainly what happens to the absorbed order", async () => {
    const user = userEvent.setup();
    mockApi({ enabled: true, window_hours: 24, candidates: [candidate()] });
    renderPanel();
    await user.click(await screen.findByRole("button", { name: fr.orderMerge.mergeCta }));

    expect(
      screen.getByText(fr.orderMerge.consequence.replace("{externalId}", "EXT-ABS")),
    ).toBeInTheDocument();
  });
});
