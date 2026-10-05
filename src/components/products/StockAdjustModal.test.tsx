import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, test, expect, vi } from "vitest";
import { StockAdjustModal, type StockAdjustState } from "./StockAdjustModal";
import frMessages from "@/messages/fr.json";

// The focus trap is loaded lazily (client only); render its children straight away.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Passthrough({ children }: { children: React.ReactNode }) {
      return <>{children}</>;
    },
}));

const t = frMessages.products.stockModal;

const BASE: StockAdjustState = {
  productId: "p-1",
  productName: "Doudoune",
  change: "",
  reason: "manual_adjustment",
  note: "",
  loading: false,
  error: null,
  variantId: null,
  variants: [
    { id: "v-g", label: "Grand", current_stock: 60 },
    { id: "v-p", label: "Petit", current_stock: 0 },
  ],
  hint: null,
};

function renderModal(patch: Partial<StockAdjustState> = {}, handlers: Partial<React.ComponentProps<typeof StockAdjustModal>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <StockAdjustModal state={{ ...BASE, ...patch }} onChange={onChange} onSubmit={vi.fn()} onClose={vi.fn()} {...handlers} />
    </NextIntlClientProvider>,
  );
  return { onChange, ...utils };
}

describe("StockAdjustModal", () => {
  test("is a labelled modal dialog, so a screen reader and Escape treat it as one", () => {
    renderModal();
    expect(screen.getByRole("dialog", { name: /Doudoune/ })).toHaveAttribute("aria-modal", "true");
  });

  test("names the size being corrected, with what it holds, and offers the whole product too", async () => {
    const { onChange } = renderModal();
    const select = screen.getByLabelText(t.variantLabel);
    expect(screen.getByRole("option", { name: t.variantWhole })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Grand/ })).toBeInTheDocument();
    await userEvent.selectOptions(select, "v-g");
    expect(onChange).toHaveBeenCalledWith({ variantId: "v-g" });
  });

  test("shows the figure before and after for the chosen size", () => {
    renderModal({ variantId: "v-g", change: "-10" });
    expect(screen.getByText("60 → 50")).toBeInTheDocument();
  });

  test("« Solder à zéro » fills the quantity with minus what the size holds", async () => {
    const { onChange } = renderModal({ variantId: "v-g" });
    await userEvent.click(screen.getByRole("button", { name: t.zeroOut }));
    expect(onChange).toHaveBeenCalledWith({ change: "-60" });
  });

  test("offers no zero-out for a size that holds nothing", () => {
    renderModal({ variantId: "v-p" });
    expect(screen.queryByRole("button", { name: t.zeroOut })).not.toBeInTheDocument();
  });

  test("a product with no sizes shows no size picker at all", () => {
    renderModal({ variants: [] });
    expect(screen.queryByLabelText(t.variantLabel)).not.toBeInTheDocument();
  });

  test("a locked size cannot be switched — the caller asked for this one", () => {
    renderModal({ variantId: "v-g", lockVariant: true });
    expect(screen.getByLabelText(t.variantLabel)).toBeDisabled();
  });

  test("says why the dialog opened when it was opened to clear a size", () => {
    renderModal({ hint: "« Grand » porte encore 60 unités." });
    expect(screen.getByText("« Grand » porte encore 60 unités.")).toBeInTheDocument();
  });

  test("shows the error under the form", () => {
    renderModal({ error: "stock cannot go below zero" });
    expect(screen.getByRole("alert")).toHaveTextContent("stock cannot go below zero");
  });

  test("Escape closes it unless a write is in flight", async () => {
    const onClose = vi.fn();
    const { rerender } = renderModal({}, { onClose });
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <StockAdjustModal state={{ ...BASE, loading: true }} onChange={vi.fn()} onSubmit={vi.fn()} onClose={onClose} />
      </NextIntlClientProvider>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
