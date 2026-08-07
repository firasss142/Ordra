import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { OrderFacts } from "../OrderDetailPanel/OrderFacts";

function renderFacts(p: Partial<React.ComponentProps<typeof OrderFacts>> = {}) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrderFacts total={129} currencyCode="TND" itemCount={1}
        agentName="tasnim" carrierName="Darb Assabil" {...p} />
    </NextIntlClientProvider>,
  );
}

describe("OrderFacts", () => {
  test("states money the way the table's Total column does", () => {
    // 129 rendered bare, with the currency jammed against it and no decimals,
    // made the same order read as a different amount here than in the list.
    renderFacts();
    const total = screen.getByText("Total").closest("div")!;
    expect(total.textContent).toContain("129.00");
    expect(total.textContent).toContain("TND");
  });

  test("keeps two decimals on whole amounts", () => {
    renderFacts({ total: 1240 });
    expect(screen.getByText(/1240\.00/)).toBeInTheDocument();
  });

  test("labels every value, so none has to be inferred from position", () => {
    renderFacts();
    for (const l of ["Total", "Articles", "Agent", "Transporteur"]) {
      expect(screen.getByText(l)).toBeInTheDocument();
    }
  });

  test("an unassigned order says so rather than showing a blank", () => {
    renderFacts({ agentName: null });
    expect(screen.getByText(/non assigné/i)).toBeInTheDocument();
  });

  test("no carrier yet renders a dash, not an empty cell", () => {
    renderFacts({ carrierName: null });
    const carrier = screen.getByText("Transporteur").closest("div")!;
    expect(carrier.textContent).toContain("—");
  });
});
