import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { DuplicateOrderBadge } from "./DuplicateOrderBadge";
import type { SiblingOrder } from "@/lib/duplicate-orders/detect";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params) {
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val,
        );
      }
      return val;
    };
    return resolve;
  },
  useLocale: () => "fr",
}));

function sibling(o: Partial<SiblingOrder> = {}): SiblingOrder {
  return {
    id: "sib-1",
    external_id: "EXT-9",
    status: "pending",
    created_at: "2026-05-21T10:00:00Z",
    product_name: "T-Shirt",
    product_image_url: null,
    quantity: 1,
    total_price: 129,
    customer_name: "Sibling Customer",
    customer_address: "9 Sibling St",
    customer_city: "Benghazi",
    already_shipped: false,
    ...o,
  };
}

/** Shared anchor props every render needs now that the popover shows the group. */
const ANCHOR_PROPS = {
  anchorStatus: "pending",
  anchorCreatedAt: "2026-05-22T10:00:00Z",
  anchorTotalPrice: 129,
  anchorProductName: "T-Shirt",
  anchorProductImageUrl: null,
  anchorCustomerName: "Anchor Customer",
  anchorCustomerAddress: "1 Anchor Rd",
  anchorCustomerCity: "Tripoli",
  currencyCode: "LBY",
} as const;

function openDialog(container: HTMLElement) {
  // Hover (not click) now opens the popover.
  const trigger = container.querySelector("[data-duplicate='true']") as HTMLElement;
  fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DuplicateOrderBadge", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={0}
        siblings={[]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an icon-only trigger with NO 'Doublon' text", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={2}
        siblings={[sibling({ id: "a" }), sibling({ id: "b" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
      />,
    );
    expect(container.querySelector("[data-duplicate='true']")).not.toBeNull();
    expect(screen.queryByText(/Doublon ·/)).toBeNull();
  });

  it("shows an inline count label when count > 1", () => {
    render(
      <DuplicateOrderBadge
        count={3}
        siblings={[sibling({ id: "a" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
      />,
    );
    expect(screen.getByText("3×")).toBeDefined();
  });

  it("shows no count label when count is 1", () => {
    render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ id: "a" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
      />,
    );
    expect(screen.queryByText(/×/)).toBeNull();
  });

  it("opens a popover listing siblings on hover", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ customer_name: "Mariam K" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    openDialog(container);
    expect(screen.getByRole("dialog")).toBeDefined();
    // The card headline is now the customer name (not the order reference).
    expect(screen.getByText("Mariam K")).toBeDefined();
  });

  it("sorts the merged list by date — newest first, regardless of anchor position", () => {
    // Anchor is created earlier than the sibling, so the sibling must come first.
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[
          sibling({
            customer_name: "Newer Sibling",
            created_at: "2026-05-23T10:00:00Z", // newer than anchor (2026-05-22)
          }),
        ]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
      />,
    );
    openDialog(container);
    // Popover is portaled to document.body; query from there.
    const cards = document.body.querySelectorAll("[data-related-order]");
    expect(cards).toHaveLength(2);
    // Newer sibling renders first; the anchor (older) is second and still shows the violet accent.
    expect(cards[0].textContent).toContain("Newer Sibling");
    expect(cards[1].getAttribute("data-anchor")).toBe("true");
  });

  it("renders the 'already shipped' chip for a shipped sibling", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ already_shipped: true, status: "uploaded" })]}
        hasUploadedSibling
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
      />,
    );
    openDialog(container);
    expect(screen.getByText(/Déjà envoyé au transporteur/)).toBeDefined();
  });

  it("shows a delete button when canDelete and status is deletable", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ status: "pending" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
        canDelete
      />,
    );
    openDialog(container);
    expect(screen.getByLabelText(/Supprimer la commande/)).toBeDefined();
  });

  it("hides the delete button when canDelete is false", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ status: "pending" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
        canDelete={false}
      />,
    );
    openDialog(container);
    expect(screen.queryByLabelText(/Supprimer la commande/)).toBeNull();
  });

  it("hides the delete button for a non-deletable status", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ status: "dispatched" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
        canDelete
      />,
    );
    openDialog(container);
    expect(screen.queryByLabelText(/Supprimer la commande/)).toBeNull();
  });

  it("hides the delete button for an UPLOADED sibling (committed to carrier)", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ status: "uploaded", already_shipped: true })]}
        hasUploadedSibling
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
        canDelete
      />,
    );
    openDialog(container);
    expect(screen.queryByLabelText(/Supprimer la commande/)).toBeNull();
  });

  it("hides the delete button for a SCANNED sibling (stock deducted)", () => {
    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ status: "scanned" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
        canDelete
      />,
    );
    openDialog(container);
    expect(screen.queryByLabelText(/Supprimer la commande/)).toBeNull();
  });

  it("posts the delete, drops the sibling, and calls onChange on success", async () => {
    const onChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { deleted_id: "sib-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ id: "sib-1", customer_name: "Mariam K", status: "pending" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
        canDelete
        onChange={onChange}
      />,
    );
    openDialog(container);
    fireEvent.click(screen.getByLabelText(/Supprimer la commande/));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/orders/anchor-1/delete-duplicate",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ sibling_id: "sib-1" });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Mariam K")).toBeNull());
  });

  it("does not call fetch when the confirm prompt is declined", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));

    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ status: "pending" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
        canDelete
      />,
    );
    openDialog(container);
    fireEvent.click(screen.getByLabelText(/Supprimer la commande/));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an error message when the delete fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "boom" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    const { container } = render(
      <DuplicateOrderBadge
        count={1}
        siblings={[sibling({ status: "pending" })]}
        hasUploadedSibling={false}
        anchorOrderId="anchor-1"
        {...ANCHOR_PROPS}
        canDelete
      />,
    );
    openDialog(container);
    fireEvent.click(screen.getByLabelText(/Supprimer la commande/));

    await waitFor(() =>
      expect(screen.getByText(/Échec de la suppression/)).toBeDefined(),
    );
  });
});
