import { describe, test, expect, vi, beforeEach } from "vitest";

const LY_MARKET = "00000000-0000-0000-0000-000000000002";
const TRIPOLI = "0dfa8255-0c13-478f-b24d-0fb037c7e09a";
const BENGHAZI = "6639af0c-be36-4cca-aed8-67e0c60ebee9";

const mockOrderRow = {
  id: "o-1",
  status: "confirmed",
  market_id: LY_MARKET,
  tracking_number: null,
  customer_name: "Ahmed",
  customer_phone: "912345678",
  customer_phone_2: null,
  customer_whatsapp: null,
  customer_address: "Tripoli St",
  customer_city: "Tripoli",
  customer_note: null,
  product_id: "p-1",
  product_name: "T-Shirt",
  variant_label: null,
  quantity: 1,
  total_price: 100,
};

// The Tripoli Darb account. Its warehouse_id is what ties a dispatch to a site.
const mockCarrierRow = {
  id: "c-darb-tripoli",
  code: "darb_assabil",
  api_endpoint: "https://api.darbassabil.com",
  api_credentials: "encrypted",
  delivery_fee: 10,
  return_fee: 5,
  market_id: LY_MARKET,
  is_active: true,
  warehouse_id: TRIPOLI,
};

let orderResult: { data: unknown; error: unknown };
let carrierResult: { data: unknown; error: unknown };
let orderItemsResult: { data: unknown; error: unknown };
/** settings rows keyed by the `key` column, to serve the per-site lookup. */
let settingsRows: Record<string, unknown>;

const rpcMock = vi.fn();
const dispatchToCarrierMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "settings") {
        // .select().eq("market_id",…).eq("key",…).maybeSingle()
        return {
          select: () => ({
            eq: () => ({
              eq: (_col: string, key: string) => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: key in settingsRows ? { value: settingsRows[key] } : null,
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "carrier_product_mappings") {
        // Chained .eq().eq().in() — the carrier-warehouse resolution path.
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.in = () => Promise.resolve({ data: [], error: null });
        return { select: () => chain };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve(table === "orders" ? orderResult : carrierResult),
            order: () => Promise.resolve(orderItemsResult),
          }),
        }),
      };
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  })),
}));

vi.mock("../dispatch", () => ({
  dispatchToCarrier: (...args: unknown[]) => dispatchToCarrierMock(...args),
  buildConfig: vi.fn(() => ({})),
}));

import { performDispatch } from "../perform-dispatch";
import { pickupSettingKey } from "../pickup-window";

/** The `extra` the adapter actually received. */
function extraSeenByAdapter(): Record<string, unknown> {
  const call = dispatchToCarrierMock.mock.calls.at(-1);
  return (call?.[2] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  orderResult = { data: mockOrderRow, error: null };
  carrierResult = { data: mockCarrierRow, error: null };
  orderItemsResult = { data: [], error: null };
  settingsRows = {};
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  dispatchToCarrierMock.mockResolvedValue({
    success: true,
    trackingNumber: "SH1",
  });
});

/** A press made "now", i.e. on the current Libyan day. */
function pressedToday() {
  return { disabled_at: new Date().toISOString(), by: "u-1" };
}
function pressedYesterday() {
  return {
    disabled_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
    by: "u-1",
  };
}

describe("the per-site pickup switch, enforced server-side", () => {
  test("switch untouched → is_pickup is left alone (default stays ON)", async () => {
    await performDispatch({
      orderId: "o-1",
      carrierId: "c-darb-tripoli",
      actorId: "a-1",
      extra: { city: "Tripoli", customer_area: "Area" },
    });
    expect(extraSeenByAdapter().is_pickup).not.toBe(false);
  });

  test("switch pressed today for this site → is_pickup forced false", async () => {
    settingsRows[pickupSettingKey(TRIPOLI)] = pressedToday();

    await performDispatch({
      orderId: "o-1",
      carrierId: "c-darb-tripoli",
      actorId: "a-1",
      extra: { city: "Tripoli", customer_area: "Area" },
    });

    expect(extraSeenByAdapter().is_pickup).toBe(false);
  });

  test("a client forging is_pickup:true cannot re-summon the driver", async () => {
    settingsRows[pickupSettingKey(TRIPOLI)] = pressedToday();

    await performDispatch({
      orderId: "o-1",
      carrierId: "c-darb-tripoli",
      actorId: "a-1",
      extra: { city: "Tripoli", customer_area: "Area", is_pickup: true },
    });

    // The route copies body.extra from the client verbatim; the server decides.
    expect(extraSeenByAdapter().is_pickup).toBe(false);
  });

  test("yesterday's press does not carry into today (midnight default)", async () => {
    settingsRows[pickupSettingKey(TRIPOLI)] = pressedYesterday();

    await performDispatch({
      orderId: "o-1",
      carrierId: "c-darb-tripoli",
      actorId: "a-1",
      extra: { city: "Tripoli", customer_area: "Area" },
    });

    expect(extraSeenByAdapter().is_pickup).not.toBe(false);
  });

  test("Benghazi's press leaves Tripoli's uploads alone", async () => {
    settingsRows[pickupSettingKey(BENGHAZI)] = pressedToday();

    await performDispatch({
      orderId: "o-1",
      carrierId: "c-darb-tripoli",
      actorId: "a-1",
      extra: { city: "Tripoli", customer_area: "Area" },
    });

    expect(extraSeenByAdapter().is_pickup).not.toBe(false);
  });

  test("carrier-warehouse fulfilment is untouched — Darb picks from their own building", async () => {
    settingsRows[pickupSettingKey(TRIPOLI)] = pressedToday();

    await performDispatch({
      orderId: "o-1",
      carrierId: "c-darb-tripoli",
      actorId: "a-1",
      extra: {
        city: "Tripoli",
        customer_area: "Area",
        fulfil_from_carrier_warehouse: true,
      },
    });

    // Whatever happens downstream, we must not have forced is_pickup:false here.
    expect(extraSeenByAdapter().is_pickup).not.toBe(false);
  });

  test("a carrier with no site (null warehouse_id) is never switched off", async () => {
    carrierResult = { data: { ...mockCarrierRow, warehouse_id: null }, error: null };
    settingsRows[pickupSettingKey(TRIPOLI)] = pressedToday();

    await performDispatch({
      orderId: "o-1",
      carrierId: "c-darb-tripoli",
      actorId: "a-1",
      extra: { city: "Tripoli", customer_area: "Area" },
    });

    expect(extraSeenByAdapter().is_pickup).not.toBe(false);
  });

  test("non-Darb carriers ignore the switch entirely", async () => {
    carrierResult = {
      data: { ...mockCarrierRow, code: "cosmos" },
      error: null,
    };
    settingsRows[pickupSettingKey(TRIPOLI)] = pressedToday();

    await performDispatch({
      orderId: "o-1",
      carrierId: "c-darb-tripoli",
      actorId: "a-1",
      extra: {},
    });

    expect(extraSeenByAdapter().is_pickup).toBeUndefined();
  });
});
