import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { PanelHeader } from "../OrderDetailPanel/PanelHeader";

const HOUR = 60 * 60 * 1000;

function renderHeader(props: Partial<React.ComponentProps<typeof PanelHeader>> = {}) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <PanelHeader
        reference="13141601"
        createdAt={new Date(Date.now() - 4 * HOUR).toISOString()}
        status="pending"
        statusLabel="En attente"
        statusTone="neutral"
        locale="fr"
        saveFlash={null}
        onClose={onClose}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

describe("PanelHeader — how long this order has been waiting", () => {
  beforeEach(() => vi.clearAllMocks());

  test("states elapsed time, which the panel never showed at all", () => {
    // The list has carried an age column since the redesign; opening an order
    // used to drop that reading entirely, so the agent lost the one number
    // that decides whether to call now or later.
    renderHeader();
    expect(screen.getByTestId("panel-age")).toHaveTextContent("4 h");
  });

  test("escalates the same way the list does, on the same thresholds", () => {
    // Two hours open is warm, a day is late. Sharing order-age.ts with the row
    // is the point: "il y a 4 h" must not mean two different things.
    renderHeader({ createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() });
    expect(screen.getByTestId("panel-age")).toHaveAttribute("data-tier", "fresh");
  });

  test("a finished order is not late, however old", () => {
    renderHeader({
      createdAt: new Date(Date.now() - 40 * 24 * HOUR).toISOString(),
      status: "delivered",
    });
    expect(screen.getByTestId("panel-age")).toHaveAttribute("data-tier", "settled");
  });

  test("carries the absolute time, so the relative one can be checked", () => {
    renderHeader();
    expect(screen.getByTestId("panel-age")).toHaveAttribute("title");
  });
});

describe("PanelHeader — the reference", () => {
  test("shows the storefront number's tail, not a wall of UUID", () => {
    renderHeader();
    expect(screen.getByText(/41601/)).toBeInTheDocument();
  });

  test("copies the whole reference, not the truncated form", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /copier la référence/i }));

    expect(writeText).toHaveBeenCalledWith("13141601");
  });

  test("keeps the status readable as text, not as colour alone", () => {
    renderHeader();
    expect(screen.getByText("En attente")).toBeInTheDocument();
  });
});
