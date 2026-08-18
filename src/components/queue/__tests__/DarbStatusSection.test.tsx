import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Same pattern as DexpressStatusSection.test.tsx: mock next-intl per file rather
// than wrapping in NextIntlClientProvider. The provider resolves through shared
// module state that is not deterministic once the suite runs files in parallel
// workers — this file passed alone but failed in a full run because of it.
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

const mockHook = vi.fn();
vi.mock("@/hooks/useDarbShipment", () => ({
  useDarbShipment: (...args: unknown[]) => mockHook(...args),
}));

import { DarbStatusSection } from "../DarbStatusSection";

const shipment = {
  darb_id: "d1",
  reference: "1511544",
  original_reference: "SH2043390",
  status_slug: "delayed",
  handler_name: "ايوب مندوب البيضاء",
  handler_phone: "+218915094841",
  handler_account_name: "مكتب البيضاء",
  handler_account_phone: "+218918446655",
  latest_remark: "يسكن في مراوه سيتم تحويلها إلى مندوب المناطق",
  latest_remark_at: "2026-08-16T20:37:09.101Z",
  latest_comment: null,
  comment_count: 0,
  cancellation_cause: null,
  delayed_until: "2026-08-17T20:37:11.092Z",
  cancel_count: null,
  resend_count: null,
  billed_shipping_amount: 35,
  billed_currency: "lyd",
  shipping_breakdown: { branchToBranch: 30, pickFromDoor: 0, dropToDoor: 5 },
  cod_outstanding: 179,
  delivery_withdrawal_at: null,
  completed_at: null,
  to_city: "البيضاء",
  to_area: "البيضاء",
  to_address: "مراوة",
  to_branch_group: "BYD",
  service_title: "توصيل رجالي",
  priority: 4,
  notes: null,
  attachments: [],
  last_synced_at: "2026-08-17T13:00:00.000Z",
  carrier_updated_at: "2026-08-16T20:37:09.101Z",
};

const timeline = [
  {
    event_id: "e4",
    type: "delayed",
    description_ar: null,
    description_en: "The order is delayed.",
    remarks: "يسكن في مراوه سيتم تحويلها إلى مندوب المناطق",
    actor_name: "ايوب مندوب البيضاء",
    actor_phone: "+218915094841",
    occurred_at: "2026-08-16T20:37:09.101Z",
  },
  {
    event_id: "e2",
    type: "referenced",
    description_ar: "تم إحالة الطلب بالرقم 1511544",
    description_en: "Reference the order by 1511544",
    remarks: null,
    actor_name: null,
    actor_phone: null,
    occurred_at: "2026-08-13T14:41:00.000Z",
  },
];

const refresh = vi.fn();

/** Default: loaded, with a shipment. Override per test. */
function useDarb(over: Record<string, unknown> = {}) {
  mockHook.mockReturnValue({
    shipment,
    timeline,
    comments: [],
    hasLoaded: true,
    isLoading: false,
    error: undefined,
    refresh,
    ...over,
  });
}

beforeEach(() => {
  mockHook.mockReset();
  refresh.mockReset();
});

describe("DarbStatusSection", () => {
  test("renders nothing when the order is not a Darb order", () => {
    useDarb();
    const { container } = render(<DarbStatusSection orderId="o1" enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("shows the courier holding the parcel and a callable phone number", () => {
    useDarb();
    render(<DarbStatusSection orderId="o1" enabled />);

    // The name appears twice by design — in the courier card, and as the
    // attribution on the history entry they wrote.
    expect(screen.getAllByText("ايوب مندوب البيضاء")).toHaveLength(2);
    const call = screen.getByRole("link", { name: /\+218915094841/ });
    expect(call).toHaveAttribute("href", "tel:+218915094841");
  });

  test("shows the courier's own note about why it is stalled", () => {
    useDarb();
    render(<DarbStatusSection orderId="o1" enabled />);
    expect(
      screen.getAllByText("يسكن في مراوه سيتم تحويلها إلى مندوب المناطق").length,
    ).toBeGreaterThan(0);
  });

  test("shows the real billed cost with the carrier's own breakdown", () => {
    useDarb();
    render(<DarbStatusSection orderId="o1" enabled />);

    // Amount and currency are separate nodes (the unit is smaller and muted).
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "SPAN" &&
          el.textContent?.replace(/\s+/g, " ").trim() === "35 LYD",
      ),
    ).toBeInTheDocument();

    // Zero legs are not itemised — pickFromDoor: 0 means unused, not free.
    expect(screen.getByText(/Agence à agence 30/)).toBeInTheDocument();
    expect(screen.queryByText(/Collecte à domicile/)).not.toBeInTheDocument();
  });

  test("colours the panel by the shipment's own status", () => {
    useDarb();
    const { container } = render(<DarbStatusSection orderId="o1" enabled />);
    // `delayed` is amber, so the courier card carries the warn tint rather than
    // the default carrier teal. Colour encodes state here, so it is behaviour.
    expect(container.querySelector(".bg-oms-warn-bg")).not.toBeNull();
    expect(container.querySelector(".bg-oms-info-bg")).toBeNull();
  });

  test("labels the branch as an office, not a person, when no courier is assigned", () => {
    useDarb({
      shipment: { ...shipment, handler_name: null, handler_phone: null },
      timeline: [],
    });
    render(<DarbStatusSection orderId="o1" enabled />);
    expect(screen.getByText(/livreur pas encore assigné/i)).toBeInTheDocument();
    expect(screen.getByText("مكتب البيضاء")).toBeInTheDocument();
  });

  test("explains a missing shipment instead of showing an empty timeline", () => {
    useDarb({ shipment: null, timeline: [], comments: [] });
    render(<DarbStatusSection orderId="o1" enabled />);
    expect(screen.getByText(/n'a aucune trace de cette expédition/i)).toBeInTheDocument();
  });

  test("renders the carrier comment thread when present", () => {
    useDarb({
      comments: [
        {
          message_id: "m1",
          message: "مقفل اوخارج نطاق التغطية",
          author_name: null,
          posted_at: "2026-08-15T09:00:00.000Z",
        },
      ],
    });
    render(<DarbStatusSection orderId="o1" enabled />);
    expect(screen.getByText("مقفل اوخارج نطاق التغطية")).toBeInTheDocument();
  });

  test("hides carrier bookkeeping events from the history", () => {
    useDarb();
    render(<DarbStatusSection orderId="o1" enabled />);
    // 'referenced' is untranslated internal noise — stored, but not shown.
    expect(screen.queryByText(/تم إحالة الطلب بالرقم/)).not.toBeInTheDocument();
  });

  test("surfaces an error with a retry affordance", async () => {
    useDarb({ error: new Error("boom"), shipment: null, hasLoaded: false });
    render(<DarbStatusSection orderId="o1" enabled />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /réessayer/i }));
    expect(refresh).toHaveBeenCalled();
  });

  test("refetches when the agent asks for a refresh", async () => {
    useDarb();
    render(<DarbStatusSection orderId="o1" enabled />);
    await userEvent.click(screen.getByRole("button", { name: /actualiser/i }));
    expect(refresh).toHaveBeenCalled();
  });

  test("asks the hook only for the order it was given, and only when enabled", () => {
    useDarb();
    render(<DarbStatusSection orderId="order-42" enabled />);
    expect(mockHook).toHaveBeenCalledWith("order-42", true);
  });
});
