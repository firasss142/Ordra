import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BenchCard } from "../BenchCard";
import { Intl, row, UNKNOWN } from "./fixtures";

/**
 * One parcel on the bench.
 *
 * The card carries what the agent matches against the physical box (customer,
 * product, quantity, city), what decides the roll (the colour bar), how long
 * it has waited, and one 48px action.
 */
afterEach(cleanup);

describe("BenchCard", () => {
  it("shows who, what, where, and the take action", () => {
    const onTake = vi.fn();
    const r = row();
    render(<Intl><BenchCard row={r} isLy held={false} currency="LYD" onTake={onTake} /></Intl>);
    expect(screen.getByText("محمد علي")).toBeInTheDocument();
    expect(screen.getByText(/دمية ملاكمة حجم كبير/)).toBeInTheDocument();
    expect(screen.getByText(/× 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "خذ الطرد" }));
    expect(onTake).toHaveBeenCalledWith(r);
  });

  it("wears its roll colour on the leading edge", () => {
    render(<Intl><BenchCard row={row()} isLy held={false} currency="LYD" onTake={() => {}} /></Intl>);
    expect(screen.getByTestId("wh-bench-card")).toHaveAttribute("data-roll", "#d80a0a");
  });

  it("turns the age amber past two days on the bench", () => {
    const late = row({ uploaded_at: new Date(Date.now() - 13 * 86_400_000).toISOString() });
    render(<Intl><BenchCard row={late} isLy held={false} currency="LYD" onTake={() => {}} /></Intl>);
    const age = screen.getByTestId("wh-bench-age");
    expect(age).toHaveAttribute("data-late", "true");
    expect(age).toHaveTextContent("13 ي");
  });

  it("says the parcel is in hand instead of offering to take it again", () => {
    render(<Intl><BenchCard row={row()} isLy held currency="LYD" onTake={() => {}} /></Intl>);
    expect(screen.queryByRole("button", { name: "خذ الطرد" })).toBeNull();
    expect(screen.getByText("في يدك")).toBeInTheDocument();
    expect(screen.getByTestId("wh-bench-card")).toHaveAttribute("data-held", "true");
  });

  it("flags low stock in words, not only in colour", () => {
    render(
      <Intl>
        <BenchCard row={row({ current_stock: 2, low_stock_threshold: 20 })} isLy held={false} currency="LYD" onTake={() => {}} />
      </Intl>,
    );
    const stock = screen.getByTestId("wh-bench-stock");
    expect(stock).toHaveAttribute("data-low", "true");
    expect(stock).toHaveTextContent("تحت الحد");
  });

  it("disables take for a parcel the carrier already took away", () => {
    render(
      <Intl>
        <BenchCard row={row({ carrier_status_slug: "released" })} isLy held={false} currency="LYD" onTake={() => {}} />
      </Intl>,
    );
    expect(screen.getByRole("button", { name: "خذ الطرد" })).toBeDisabled();
  });

  it("carries no colour bar when the zone is unknown", () => {
    render(<Intl><BenchCard row={row({ zone: UNKNOWN })} isLy held={false} currency="LYD" onTake={() => {}} /></Intl>);
    expect(screen.getByTestId("wh-bench-card")).toHaveAttribute("data-roll", "");
  });

  it("shows the product picture when the product has one, and a placeholder otherwise", () => {
    render(
      <Intl>
        <BenchCard row={row({ product_image_url: "https://img/p1.png" })} isLy held={false} currency="LYD" onTake={() => {}} />
      </Intl>,
    );
    expect(screen.getByTestId("wh-bench-thumb").querySelector("img")).toHaveAttribute("src", "https://img/p1.png");
    cleanup();
    render(<Intl><BenchCard row={row()} isLy held={false} currency="LYD" onTake={() => {}} /></Intl>);
    expect(screen.getByTestId("wh-bench-thumb").querySelector("img")).toBeNull();
  });
});
