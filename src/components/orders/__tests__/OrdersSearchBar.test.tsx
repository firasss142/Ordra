import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { OrdersSearchBar } from "../OrdersSearchBar";

vi.mock("@/hooks/useIsMobile", () => ({ useIsMobile: () => false }));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

function renderBar(props: Partial<ComponentProps<typeof OrdersSearchBar>> = {}) {
  const onChange = vi.fn();
  render(<OrdersSearchBar value="" onChange={onChange} {...props} />);
  return { onChange, input: screen.getByLabelText(/rechercher une commande/i) };
}

describe("OrdersSearchBar", () => {
  it("says what it searches, so the scope is not a guess", () => {
    // The old placeholder promised three fields; the box reads seven. The
    // description travels with the field rather than sitting beside it, so it
    // survives the line below being taken over by the reading chips.
    const { input } = renderBar();
    expect(input).toHaveAccessibleDescription(/n° de suivi/i);
    expect(screen.getAllByText(/n° de suivi/i).length).toBeGreaterThan(0);
  });

  it("reports the phone number it will actually match on", async () => {
    // The whole reliability complaint in one assertion: an operator types the
    // number the way Libya writes it and needs to see that the box understood
    // it as a phone, not as a literal string that will match nothing.
    const user = userEvent.setup();
    const { input } = renderBar();
    await user.type(input, "0925782017");

    const reading = await screen.findByTestId("search-reading");
    expect(reading).toHaveTextContent("Téléphone");
    expect(reading).toHaveTextContent("925782017");
  });

  it("names the field when a term is aimed at one", async () => {
    const user = userEvent.setup();
    const { input } = renderBar();
    await user.type(input, "ville:sfax");

    expect(await screen.findByTestId("search-reading")).toHaveTextContent("Ville");
  });

  it("stays quiet when the reading is just the words you typed", async () => {
    // A chip per word would be noise. It earns its place only when the box did
    // something you would not have predicted.
    const user = userEvent.setup();
    const { input } = renderBar();
    await user.type(input, "salima");

    expect(screen.queryByTestId("search-reading")).toBeNull();
  });

  it("sends one query for a burst of typing, not one per key", async () => {
    const user = userEvent.setup();
    const { onChange, input } = renderBar();
    await user.type(input, "sfax");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("sfax"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("can be emptied without selecting the text", async () => {
    // There was no clear affordance at all: the only way out was ctrl+A.
    const user = userEvent.setup();
    const { onChange, input } = renderBar();
    await user.type(input, "sfax");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("sfax"));

    await user.click(screen.getByRole("button", { name: /effacer la recherche/i }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(""));
  });

  it("clears on Escape", async () => {
    const user = userEvent.setup();
    const { onChange, input } = renderBar();
    await user.type(input, "sfax");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("sfax"));

    await user.type(input, "{Escape}");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(""));
  });

  it("does not fire a query for a search that was abandoned before it settled", async () => {
    // Typing and escaping inside the debounce window is a net no-op. Sending
    // "sfax" and then "" would be two full-table searches for nothing.
    const user = userEvent.setup();
    const { onChange, input } = renderBar();
    await user.type(input, "sfax{Escape}");
    await waitFor(() => expect(input).toHaveValue(""));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers the field prefixes on focus and inserts one on click", async () => {
    const user = userEvent.setup();
    const { input } = renderBar();
    await user.click(input);

    const prefix = screen.getByRole("button", { name: "tel:" });
    await user.click(prefix);
    expect(input).toHaveValue("tel:");
  });

  it("shows it is working while the list fetches", () => {
    // Half of "slow" is not knowing whether anything is happening.
    const { container } = render(
      <OrdersSearchBar value="sfax" onChange={vi.fn()} busy />,
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("takes a query cleared from elsewhere on the page", async () => {
    // "Tout effacer" in the chip row empties filters.q; the box must follow.
    const { rerender } = render(<OrdersSearchBar value="sfax" onChange={vi.fn()} />);
    expect(screen.getByLabelText(/rechercher une commande/i)).toHaveValue("sfax");

    rerender(<OrdersSearchBar value="" onChange={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/rechercher une commande/i)).toHaveValue(""),
    );
  });
});
