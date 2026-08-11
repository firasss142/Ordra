import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinanceKpiCard } from "./FinanceKpiCard";
import { Coins } from "lucide-react";

describe("FinanceKpiCard", () => {
  it("renders label, value and subtitle", () => {
    render(
      <FinanceKpiCard
        label="Profit net"
        value="2 489 LYD"
        subtitle="79,0 % marge"
        icon={Coins}
      />,
    );
    expect(screen.getByText("Profit net")).toBeInTheDocument();
    expect(screen.getByText("2 489 LYD")).toBeInTheDocument();
    expect(screen.getByText("79,0 % marge")).toBeInTheDocument();
  });

  it("puts a positive delta in the mint pill", () => {
    render(
      <FinanceKpiCard label="CA" value="3 150" icon={Coins} delta={{ text: "+87,5 %", tone: "positive" }} />,
    );
    const pill = screen.getByTestId("kpi-delta");
    expect(pill).toHaveTextContent("+87,5 %");
    expect(pill.className).toContain("bg-fin-mint");
    expect(pill.className).toContain("text-fin-green-ink");
  });

  it("puts a negative delta in the red tint, never the mint", () => {
    render(
      <FinanceKpiCard label="Marge" value="79,0 %" icon={Coins} delta={{ text: "-0,6 pp", tone: "negative" }} />,
    );
    const pill = screen.getByTestId("kpi-delta");
    expect(pill.className).toContain("bg-oms-bad-bg");
    expect(pill.className).toContain("text-oms-age-late");
    expect(pill.className).not.toContain("bg-fin-mint");
  });

  it("renders a muted dash pill for a neutral delta", () => {
    render(<FinanceKpiCard label="CPA" value="—" icon={Coins} delta={{ text: "—", tone: "neutral" }} />);
    const pill = screen.getByTestId("kpi-delta");
    expect(pill).toHaveTextContent("—");
    expect(pill.className).not.toContain("bg-fin-mint");
    expect(pill.className).not.toContain("bg-oms-bad-bg");
  });

  it("omits the delta pill entirely when no delta is given", () => {
    render(<FinanceKpiCard label="CPL" value="—" icon={Coins} />);
    expect(screen.queryByTestId("kpi-delta")).toBeNull();
  });

  it("carries the value in navy ink normally and in critical ink when negative", () => {
    const { rerender } = render(<FinanceKpiCard label="Net" value="100" icon={Coins} />);
    expect(screen.getByText("100").className).toContain("text-fin-navy");

    rerender(<FinanceKpiCard label="Net" value="-200" icon={Coins} negative />);
    expect(screen.getByText("-200").className).toContain("text-oms-age-late");
  });

  it("tints the icon holder with tokens rather than a raw hex", () => {
    render(<FinanceKpiCard label="Net" value="100" icon={Coins} />);
    const holder = screen.getByTestId("kpi-icon-holder");
    expect(holder.className).toContain("bg-fin-mint");
    expect(holder.className).toContain("text-fin-green");
    // A raw hex here is the exact regression the token layer exists to stop.
    expect(holder.getAttribute("style") ?? "").not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("renders the visual slot when one is provided", () => {
    render(
      <FinanceKpiCard
        label="CA"
        value="3 150"
        icon={Coins}
        visual={<div data-testid="spark" />}
      />,
    );
    expect(screen.getByTestId("spark")).toBeInTheDocument();
  });
});
