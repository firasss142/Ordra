import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { OutcomeFlow } from "../useOutcomeFlow";

/**
 * The agent's « Envoyer » with X-Delivery chosen opens X-Delivery's own form, fed from
 * the order the step already holds — mounted to the body, like Darb's.
 */

vi.mock("next/dynamic", () => ({
  default: () =>
    function Modal(props: Record<string, unknown>) {
      return (
        <div data-testid="xd-modal" data-props={JSON.stringify(props)}>
          <button type="button" onClick={() => (props.onSuccess as (t: string) => void)("611")}>
            ok
          </button>
        </div>
      );
    },
}));
vi.mock("@/components/queue/DarbAssabilDispatchModal", () => ({ DarbAssabilDispatchModal: () => null }));
vi.mock("@/components/agent/shared", () => ({ Ic: () => null, Thumb: () => null }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { XDeliveryStep } from "../OutcomeSheet";

function flow(over: { xdOpen?: boolean; code?: string } = {}) {
  const onXdSuccess = vi.fn();
  const f = {
    order: { id: "o-1" },
    send: {
      xdOpen: over.xdOpen ?? true,
      closeXd: vi.fn(),
      onXdSuccess,
      carriers: {
        selectedCard: { id: "xd-1", name: "X-Delivery", code: over.code ?? "xdelivery" },
        order: { customer_name: "Client T.", customer_city: "Sousse", total_price: 89.9 },
      },
    },
  } as unknown as OutcomeFlow;
  return { f, onXdSuccess };
}

afterEach(cleanup);

describe("XDeliveryStep", () => {
  it("opens the form with the order's name, city, total and the chosen account", () => {
    render(<XDeliveryStep flow={flow().f} />);
    const props = JSON.parse(screen.getByTestId("xd-modal").dataset.props!);
    expect(props).toMatchObject({
      orderId: "o-1",
      carrierId: "xd-1",
      customerName: "Client T.",
      customerCity: "Sousse",
      totalPrice: 89.9,
    });
  });

  it("a successful upload goes back through the flow's « sent »", () => {
    const { f, onXdSuccess } = flow();
    render(<XDeliveryStep flow={f} />);
    fireEvent.click(screen.getByText("ok"));
    expect(onXdSuccess).toHaveBeenCalledWith("611");
  });

  it("closed, nothing renders", () => {
    render(<XDeliveryStep flow={flow({ xdOpen: false }).f} />);
    expect(screen.queryByTestId("xd-modal")).toBeNull();
  });
});
