import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrderStatusBadge } from "../OrderStatusBadge";

function renderBadge(props: Partial<React.ComponentProps<typeof OrderStatusBadge>> = {}) {
  return render(
    <OrderStatusBadge status="attempt_2" label="Tentative 2" locale="fr" {...props} />,
  );
}

describe("OrderStatusBadge", () => {
  it("states the status in words, never by colour alone", () => {
    renderBadge({ status: "rejected", label: "Rejeté" });
    expect(screen.getByText("Rejeté")).toBeInTheDocument();
  });

  it("carries a glyph, so the column survives greyscale", () => {
    // Five tones on one pill shape meant a deuteranope — or anyone printing
    // this — saw "Rejeté" and "Tentative 1" as the same object.
    const { container } = renderBadge({ status: "rejected", label: "Rejeté" });
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("counts attempts against the market's real ceiling", () => {
    renderBadge({ status: "attempt_2", label: "Tentative 2", attemptsCount: 2, maxAttempts: 8 });
    expect(screen.getByTestId("status-counter")).toHaveTextContent("2/8");
  });

  it("never invents a ceiling it does not know", () => {
    // "/3" would be a lie: the status enum stops at 3, the real max is 8.
    renderBadge({ status: "attempt_2", label: "Tentative 2", attemptsCount: 2 });
    const counter = screen.getByTestId("status-counter");
    expect(counter).toHaveTextContent("2");
    expect(counter.textContent).not.toContain("/");
  });

  it("trusts the count over the label once the label stops counting", () => {
    renderBadge({ status: "attempt_3", label: "Tentative 3", attemptsCount: 7, maxAttempts: 8 });
    expect(screen.getByTestId("status-counter")).toHaveTextContent("7/8");
  });

  it("does not say the attempt number twice", () => {
    // "Tentative 1" + a "1/8" counter rendered as "Tentative 11/8", which
    // reads as eleven-eighths. The counter replaces the number, it does not
    // follow it.
    renderBadge({ status: "attempt_1", label: "Tentative 1", attemptsCount: 1, maxAttempts: 8 });
    expect(screen.getByTestId("order-status").textContent).not.toContain("11/8");
    expect(screen.getByText("Tentative")).toBeInTheDocument();
    expect(screen.getByTestId("status-counter")).toHaveTextContent("1/8");
  });

  it("strips the trailing number in Arabic too", () => {
    renderBadge({ status: "attempt_2", label: "محاولة 2", attemptsCount: 2, maxAttempts: 8 });
    expect(screen.getByText("محاولة")).toBeInTheDocument();
  });

  it("still reads as the same phrase once the number moves to the counter", () => {
    // Rendered whole it is "Tentative 2" either way — the digit just lives in
    // the tabular-nums slot now, so it aligns down the column.
    renderBadge({ status: "attempt_2", label: "Tentative 2", attemptsCount: null });
    expect(screen.getByTestId("order-status").textContent).toBe("Tentative2");
  });

  it("shows no counter on a status that is not an attempt", () => {
    renderBadge({ status: "uploaded", label: "Téléchargé", attemptsCount: 3, maxAttempts: 8 });
    expect(screen.queryByTestId("status-counter")).toBeNull();
  });

  it("marks the weight so a settled order cannot look urgent", () => {
    renderBadge({ status: "uploaded", label: "Téléchargé" });
    expect(screen.getByTestId("order-status")).toHaveAttribute("data-weight", "quiet");
  });

  it("goes loud only when the attempts have actually run out", () => {
    renderBadge({ status: "attempt_3", label: "Tentative 3", attemptsCount: 8, maxAttempts: 8 });
    expect(screen.getByTestId("order-status")).toHaveAttribute("data-weight", "loud");
  });

  it("keeps the label readable to a screen reader as one phrase", () => {
    renderBadge({ status: "attempt_2", label: "Tentative 2", attemptsCount: 2, maxAttempts: 8 });
    expect(screen.getByTestId("order-status")).toHaveAccessibleName("Tentative 2/8");
  });
});
