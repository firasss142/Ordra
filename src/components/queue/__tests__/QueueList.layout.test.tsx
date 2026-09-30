import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { QueueList } from "../QueueList";
import { QUEUE_ROW_GRID } from "../row-grid";
import type { QueueOrder } from "@/types/queue";

const intlMockState = vi.hoisted(() => ({ locale: "fr" }));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => intlMockState.locale,
  };
});

afterEach(() => vi.restoreAllMocks());

const order = (over: Partial<QueueOrder> = {}): QueueOrder =>
  ({
    id: "o1",
    customer_name: "Ahmed Gharbi",
    customer_phone: "22123456",
    customer_address: null,
    customer_city: "Tunis",
    product_name: "T-Shirt",
    variant_label: "",
    quantity: 1,
    product_image_url: null,
    carrier_id: null,
    carrier_code: null,
    carrier_name: null,
    total_price: 89.9,
    currency: "TND",
    market_id: "m1",
    attempt_count: 0,
    callback_time: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    customer_note: null,
    customer_phone_2: null,
    status: "pending",
    created_at: "2026-04-10T10:00:00Z",
    assigned_at: "2026-04-10T10:00:00Z",
    last_action_at: null,
    repeat_kind: "none",
    prior_order_count: 0,
    prior_lead_count: 0,
    prior_rejected_count: 0,
    last_known_address: null,
    rejection_reason: null,
    rejection_subreason: null,
    rejection_note: null,
    is_potential_duplicate: false,
    duplicate_count: 0,
    duplicate_siblings: [],
    has_uploaded_sibling: false,
    is_duplicate_anchor: false,
    tracking_number: null,
    carrier_barcode_deleted_at: null,
    dexpress_status_slug: null,
    dexpress_status_synced_at: null,
    dexpress_status_accepted: null,
    carrier_status_slug: null,
    carrier_status_synced_at: null,
    ...over,
  }) as QueueOrder;

describe("QueueList — header and rows share one template", () => {
  it("gives the header strip the same grid as the rows", () => {
    const { container } = render(
      <QueueList
        orders={[order()]}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
        selectedBucket="nouveau"
      />,
    );
    const header = container.querySelector('[role="row"]');
    const row = container.querySelector("[data-order-id]");
    const cols = QUEUE_ROW_GRID.split(" ");
    cols.forEach((c) => {
      expect(header?.className).toContain(c);
      expect(row?.className).toContain(c);
    });
  });

  it("keeps the column header off phones, where the cards carry their own labels", () => {
    const { container } = render(
      <QueueList
        orders={[order()]}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
        selectedBucket="nouveau"
      />,
    );
    expect(container.querySelector('[role="row"]')?.className).toMatch(/hidden lg:grid/);
  });

  it("labels the four desktop columns the row actually fills", () => {
    render(
      <QueueList
        orders={[order()]}
        onOpenDetail={() => {}}
        onCallTerminated={() => {}}
        selectedBucket="nouveau"
      />,
    );
    expect(screen.getByText("Client")).toBeTruthy();
    expect(screen.getByText("Activité")).toBeTruthy();
    expect(screen.getByText("Âge")).toBeTruthy();
    expect(screen.getByText("Montant")).toBeTruthy();
    // The bucket chips above the list already name the status, and every row
    // under a chip shares it — the column repeated the filter on every row.
    expect(screen.queryByText("Statut")).toBeNull();
    expect(screen.queryByText("Dernière action")).toBeNull();
  });
});
