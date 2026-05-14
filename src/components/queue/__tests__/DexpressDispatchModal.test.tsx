import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { DexpressDispatchModal } from "../DexpressDispatchModal";

/**
 * Currency formatting injects RTL marks / nbsp that break exact-text matching.
 * Match on the digit sequence instead — enough to prove the math.
 * "215000" matches the formatted "215,000.000"-style output.
 */
function byDigits(digits: string) {
  return (content: string) => content.replace(/\D/g, "") === digits;
}

vi.mock("swr", () => ({
  default: vi.fn(),
}));

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

import useSWR from "swr";

const BASE_PROPS = {
  orderId: "order-1",
  marketId: "m-ly",
  orderTotal: 200,
  market: "LY" as const,
  customerAddress: "Tripoli centre",
  presetStateId: 62,
  presetStateName: "Tripoli",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function mockCarrier(carrier: Record<string, unknown> | null) {
  (useSWR as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { carrier },
    isLoading: false,
  });
}

beforeEach(() => vi.clearAllMocks());

// orderTotal is 200, delivery_fee is 15 across these cases. LYD formats with
// 3 fraction digits, so the digit sequences are 200 → "200000", 215 → "215000".
const GOODS_DIGITS = "200000";
const TOTAL_WITH_DELIVERY_DIGITS = "215000";

describe("DexpressDispatchModal — price summary respects cost_type", () => {
  it("customer pays goods + delivery when cost_type is '1'", () => {
    mockCarrier({
      id: "carrier-1",
      delivery_fee: 15,
      is_active: true,
      cost_type: "1",
    });
    render(<DexpressDispatchModal {...BASE_PROPS} />);
    // goods 200 + delivery 15 = 215 due on delivery
    expect(
      screen.getByText(byDigits(TOTAL_WITH_DELIVERY_DIGITS)),
    ).toBeInTheDocument();
    // delivery fee shown as a charged amount, not seller-covered
    expect(screen.queryByText("À la charge du vendeur")).not.toBeInTheDocument();
  });

  it("customer pays goods only when cost_type is '0' (seller covers delivery)", () => {
    mockCarrier({
      id: "carrier-1",
      delivery_fee: 15,
      is_active: true,
      cost_type: "0",
    });
    render(<DexpressDispatchModal {...BASE_PROPS} />);
    // goods value AND customer total are both 200 (delivery not added).
    expect(screen.getAllByText(byDigits(GOODS_DIGITS))).toHaveLength(2);
    // delivery fee is NOT added to the customer total.
    expect(
      screen.queryByText(byDigits(TOTAL_WITH_DELIVERY_DIGITS)),
    ).not.toBeInTheDocument();
    // delivery fee line shows it is seller-covered, not a charged amount.
    expect(screen.getByText("À la charge du vendeur")).toBeInTheDocument();
  });

  it("defaults to customer-pays when cost_type is absent", () => {
    mockCarrier({ id: "carrier-1", delivery_fee: 15, is_active: true });
    render(<DexpressDispatchModal {...BASE_PROPS} />);
    // unset cost_type behaves as "1": 200 + 15 = 215
    expect(
      screen.getByText(byDigits(TOTAL_WITH_DELIVERY_DIGITS)),
    ).toBeInTheDocument();
  });
});
