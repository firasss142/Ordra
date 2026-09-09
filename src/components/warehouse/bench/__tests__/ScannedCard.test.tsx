import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScannedCard } from "../ScannedCard";
import { Intl, RED } from "./fixtures";
import type { ScannedRow } from "@/app/api/warehouse/scanned/route";

/**
 * The card that closes the loop after a scan.
 *
 * On 2026-09-08 seven of nineteen parcels had their sticker replaced by Darb's
 * reception and one was never registered at all — every one of them invisible.
 * These tests pin the three things the card must never blur: which number the
 * carrier holds, that it is NOT ours when it isn't, and whether the parcel is
 * still ours to take back.
 */
function scanned(over: Partial<ScannedRow> = {}): ScannedRow {
  return {
    id: "o1",
    customer_name: "سعاد المبروك",
    customer_phone: "+218",
    customer_city: "بنغازي",
    customer_area: null,
    product_id: "p1",
    product_name: "كتاب الحفظ الميسر",
    variant_label: null,
    quantity: 1,
    total_price: 90,
    status: "scanned",
    created_at: new Date().toISOString(),
    scanned_at: new Date().toISOString(),
    scanned_by_name: "adel",
    tracking_number: "1272026",
    carrier_sticker_ref: "1272026",
    carrier_status_slug: "pending",
    sticker_bind_state: "confirmed",
    carrier_reference_actual: null,
    branch_group: "BN",
    warehouse_id: "w-bn",
    carrier_name: "Darb Assabil — Benghazi",
    current_stock: 10,
    low_stock_threshold: 2,
    zone: RED,
    ...over,
  };
}

const noop = () => {};

describe("ScannedCard", () => {
  test("a confirmed parcel shows the sticker and says nothing is wrong", () => {
    render(
      <Intl locale="fr">
        <ScannedCard row={scanned()} isLy busy={false} onRecheck={noop} onRebind={noop} onUnscan={noop} />
      </Intl>,
    );
    expect(screen.getByTestId("wh-scanned-sticker")).toHaveTextContent("1272026");
    expect(screen.getByTestId("wh-bind-state")).toHaveAttribute("data-state", "confirmed");
  });

  test("a re-stickered parcel NAMES the number Darb is holding", () => {
    // "It failed" is not actionable. "Darb is holding 11865431" is.
    render(
      <Intl locale="fr">
        <ScannedCard
          row={scanned({ sticker_bind_state: "restickered", carrier_reference_actual: "11865431" })}
          isLy
          busy={false}
          onRecheck={noop}
          onRebind={noop}
          onUnscan={noop}
        />
      </Intl>,
    );
    const pill = screen.getByTestId("wh-bind-state");
    expect(pill).toHaveAttribute("data-state", "restickered");
    expect(pill).toHaveTextContent("11865431");
  });

  test("a parcel the carrier has taken cannot be un-scanned, and says so", () => {
    render(
      <Intl locale="fr">
        <ScannedCard
          row={scanned({ status: "at_carrier", carrier_status_slug: "booked" })}
          isLy
          busy={false}
          onRecheck={noop}
          onRebind={noop}
          onUnscan={noop}
        />
      </Intl>,
    );
    expect(screen.queryByTestId("wh-unscan")).not.toBeInTheDocument();
    // A missing button with no explanation sends the agent hunting for it.
    expect(screen.getByText(/Darb a pris ce colis/i)).toBeInTheDocument();
  });

  test("a parcel still on the bench can be taken back", async () => {
    const onUnscan = vi.fn();
    render(
      <Intl locale="fr">
        <ScannedCard row={scanned()} isLy busy={false} onRecheck={noop} onRebind={noop} onUnscan={onUnscan} />
      </Intl>,
    );
    await userEvent.click(screen.getByTestId("wh-unscan"));
    expect(onUnscan).toHaveBeenCalledOnce();
  });

  test("re-binding asks for the new number before sending anything", async () => {
    const onRebind = vi.fn();
    render(
      <Intl locale="fr">
        <ScannedCard row={scanned()} isLy busy={false} onRecheck={noop} onRebind={onRebind} onUnscan={noop} />
      </Intl>,
    );
    await userEvent.click(screen.getByRole("button", { name: /re-lier/i }));
    expect(onRebind).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/sticker/i), "1633019");
    await userEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    expect(onRebind).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }), "1633019");
  });
});
