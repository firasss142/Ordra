import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { DuplicateGroupCard } from "../DuplicateGroupCard";
import type { DuplicateGroup, DuplicateGroupMember } from "@/lib/duplicate-orders/groups";

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

function group(o: Partial<DuplicateGroup> = {}): DuplicateGroup {
  return {
    key: "g-1",
    members: [
      member({ id: "new", external_id: "EXT-NEW", is_anchor: true, created_at: "2026-09-17T10:20:00Z" }),
      member({ id: "old", external_id: "EXT-OLD", created_at: "2026-09-17T10:00:00Z" }),
    ],
    confidence: "high",
    address_matches: true,
    city_matches: true,
    span_minutes: 20,
    ...o,
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof DuplicateGroupCard>> = {}) {
  const defaults = {
    group: group(),
    selected: new Set<string>(),
    onToggle: vi.fn(),
    currencyCode: "LYD",
    locale: "fr",
    readOnly: false,
  };
  const merged = { ...defaults, ...props };
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <DuplicateGroupCard {...merged} />
    </NextIntlClientProvider>,
  );
  return merged;
}

describe("DuplicateGroupCard", () => {
  it("marks the newest order as the one being kept", () => {
    renderCard();
    expect(screen.getByText(fr.duplicateOrder.review.keep)).toBeInTheDocument();
  });

  it("offers a checkbox for the duplicate but never for the kept order", () => {
    renderCard();
    // One member is the anchor; only the other can be selected.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("reports the toggled member to the parent", async () => {
    const user = userEvent.setup();
    const { onToggle } = renderCard();
    await user.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith("old");
  });

  /**
   * The guard that matters most. 60 Libyan orders a naive rule would flag are
   * already uploaded/scanned/delivered — a real parcel exists. The screen shows
   * them for context but must make them impossible to select.
   */
  it("shows an already-shipped member but gives it no checkbox", () => {
    renderCard({
      group: group({
        confidence: "review",
        members: [
          member({ id: "new", is_anchor: true, created_at: "2026-09-17T10:20:00Z" }),
          member({
            id: "shipped",
            status: "delivered",
            already_shipped: true,
            deletable: false,
          }),
        ],
      }),
    });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText(fr.duplicateOrder.review.shippedMember)).toBeInTheDocument();
  });

  it("gives no checkbox to a member whose status forbids deletion", () => {
    renderCard({
      group: group({
        members: [
          member({ id: "new", is_anchor: true, created_at: "2026-09-17T10:20:00Z" }),
          member({ id: "locked", status: "uploaded", deletable: false }),
        ],
      }),
    });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  /**
   * Same phone is not the same destination — 96 of 187 measured pairs differed.
   * Deleting the wrong half of those throws away a genuinely different delivery.
   */
  it("warns in words when the members have different addresses", () => {
    renderCard({ group: group({ address_matches: false, confidence: "review" }) });
    expect(screen.getByText(fr.duplicateOrder.review.addressDiffers)).toBeInTheDocument();
  });

  it("warns when the cities differ", () => {
    renderCard({ group: group({ city_matches: false, confidence: "review" }) });
    expect(screen.getByText(fr.duplicateOrder.review.cityDiffers)).toBeInTheDocument();
  });

  it("labels confidence in text, not by colour alone", () => {
    renderCard({ group: group({ confidence: "high" }) });
    expect(screen.getByText(fr.duplicateOrder.review.chipHigh)).toBeInTheDocument();
  });

  it("labels a review group as needing a decision", () => {
    renderCard({ group: group({ confidence: "review" }) });
    expect(screen.getByText(fr.duplicateOrder.review.chipReview)).toBeInTheDocument();
  });

  it("offers no checkboxes at all in read-only mode", () => {
    renderCard({ readOnly: true });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("reflects the parent's selection state", () => {
    renderCard({ selected: new Set(["old"]) });
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
