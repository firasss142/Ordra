import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { ReturnsConsole } from "../ReturnsConsole";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

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

const stats = {
  queueCount: 6, queueValue: 944, oldestDays: 14,
  doneToday: 1, doneTodayValue: 129, restockedToday: 1, depreciatedToday: 0,
  depreciatedUnits: 0, depreciatedValue: 0,
  rate28d: 21, ratePrev28d: 16.8,
  weekly: [
    { week: 4, rate: 12 }, { week: 3, rate: 15 },
    { week: 2, rate: 14 }, { week: 1, rate: 21 },
  ],
  currency: "LYD",
};

vi.mock("swr", () => ({
  default: (key: string) => ({
    data: key.includes("stats") ? stats : { orders: rows, nextCursor: null },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

const row = (id: string, name: string, days: number, price: number): WarehouseOrderRow => ({
  id,
  customer_name: name,
  customer_phone: "216...",
  customer_city: "طرابلس",
  customer_area: null,
  customer_address: null,
  // Routing facts the returns queue does not use, but the row type carries.
  uploaded_at: null,
  branch_group: null,
  tracking_number: null,
  carrier_sticker_ref: null,
  carrier_status_slug: null,
  has_carrier_ref: null,
  product_id: "p1",
  product_name: "Sac de frappe",
  variant_label: "petit",
  quantity: 1,
  total_price: price,
  status: "to_be_returned",
  created_at: new Date(Date.now() - days * 86_400_000).toISOString(),
  current_stock: null,
  low_stock_threshold: null,
});

let rows: WarehouseOrderRow[] = [];

beforeEach(() => {
  rows = [row("aaaa1111-0000-0000-0000-000000000001", "عبد السلام", 14, 179)];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup() {
  return render(<ReturnsConsole marketId="m-ly" />);
}

describe("Retours — the KPI row", () => {
  it("shows the four cards the prototype names", () => {
    setup();
    for (const id of ["queue", "done", "rate", "depreciated"]) {
      expect(screen.getByTestId(`wh-kpi-${id}`)).toBeInTheDocument();
    }
  });

  it("carries the queue value and the age of the oldest parcel", () => {
    setup();
    const card = screen.getByTestId("wh-kpi-queue");
    expect(within(card).getByText("6")).toBeInTheDocument();
    expect(within(card).getByText(/14 j/)).toBeInTheDocument();
    expect(within(card).getByText(/944/)).toBeInTheDocument();
  });

  it("shows the rate against the previous window, in points not percent", () => {
    setup();
    const card = screen.getByTestId("wh-kpi-rate");
    expect(within(card).getByText("21")).toBeInTheDocument();
    // 21 − 16,8 = +4,2 points. A rise in returns is bad news.
    expect(within(card).getByText(/\+4,2 pts/)).toBeInTheDocument();
  });

  it("dims the loss card when nothing was written off", () => {
    setup();
    expect(screen.getByTestId("wh-kpi-depreciated").dataset.dim).toBe("true");
  });

  it("draws a sparkline from the four weekly points", () => {
    setup();
    const spark = within(screen.getByTestId("wh-kpi-rate")).getByTestId("wh-spark");
    expect(spark.querySelectorAll("circle")).toHaveLength(4);
  });
});

describe("Retours — the decision flow", () => {
  it("locks the decision tiles until a parcel is in hand", () => {
    setup();
    expect(screen.getByTestId("wh-lock-note")).toBeInTheDocument();
    for (const d of ["restock", "damage", "redeliver"]) {
      expect(screen.getByTestId(`wh-tile-${d}`)).toBeDisabled();
    }
  });

  it("arms the tiles and advances the stepper once a parcel is taken", () => {
    setup();
    fireEvent.click(screen.getByTestId("wh-take-aaaa1111-0000-0000-0000-000000000001"));
    expect(screen.getByTestId("wh-tile-restock")).not.toBeDisabled();
    expect(screen.getByTestId("wh-step-2").dataset.on).toBe("true");
    expect(screen.getByTestId("wh-step-3").dataset.on).toBe("false");
  });

  it("keeps validation disabled until a decision is actually chosen", () => {
    setup();
    fireEvent.click(screen.getByTestId("wh-take-aaaa1111-0000-0000-0000-000000000001"));
    expect(screen.getByTestId("wh-validate")).toBeDisabled();
    fireEvent.click(screen.getByTestId("wh-tile-restock"));
    expect(screen.getByTestId("wh-validate")).not.toBeDisabled();
  });

  it("restocks through scan_return_in", async () => {
    setup();
    fireEvent.click(screen.getByTestId("wh-take-aaaa1111-0000-0000-0000-000000000001"));
    fireEvent.click(screen.getByTestId("wh-tile-restock"));
    fireEvent.click(screen.getByTestId("wh-validate"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/warehouse/scan-return");
    expect(JSON.parse(init.body).is_damaged).toBe(false);
  });

  it("sends a re-delivery to scan_received_in, never to the restock path", async () => {
    setup();
    fireEvent.click(screen.getByTestId("wh-take-aaaa1111-0000-0000-0000-000000000001"));
    fireEvent.click(screen.getByTestId("wh-tile-redeliver"));
    fireEvent.click(screen.getByTestId("wh-validate"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // The units never rejoin the shelf: crediting stock here would be a
    // phantom unit we are about to ship again.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toBe("/api/warehouse/scan-received");
  });

  it("will not write off a parcel without a cause", async () => {
    setup();
    fireEvent.click(screen.getByTestId("wh-take-aaaa1111-0000-0000-0000-000000000001"));
    fireEvent.click(screen.getByTestId("wh-tile-damage"));
    // The damage causes appear, and validation waits for one.
    expect(screen.getByTestId("wh-damage-reasons")).toBeInTheDocument();
    expect(screen.getByTestId("wh-validate")).toBeDisabled();
    fireEvent.click(screen.getByTestId("wh-reason-carrier_damage"));
    expect(screen.getByTestId("wh-validate")).not.toBeDisabled();
  });
});

describe("Retours — house rules", () => {
  it("styles through tokens, never raw hex", () => {
    const { container } = setup();
    const classes = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .map((el) => el.className)
      .filter((c): c is string => typeof c === "string")
      .join(" ");
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
