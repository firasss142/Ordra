import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinanceFunnel } from "./FinanceFunnel";

const labels = {
  leads: "Leads",
  confirmed: "Confirmed",
  delivered: "Delivered",
  toConfirmed: "Confirmation",
  toDelivered: "Delivery",
};

describe("FinanceFunnel", () => {
  it("renders all three stages with their counts", () => {
    render(<FinanceFunnel leads={100} confirmed={60} delivered={40} labels={labels} />);
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("computes confirmation rate (confirmed / leads)", () => {
    render(<FinanceFunnel leads={100} confirmed={60} delivered={40} labels={labels} />);
    expect(screen.getByText("60.0%")).toBeInTheDocument();
  });

  it("computes delivery rate (delivered / confirmed)", () => {
    render(<FinanceFunnel leads={100} confirmed={50} delivered={40} labels={labels} />);
    // 40 / 50 = 80%
    expect(screen.getByText("80.0%")).toBeInTheDocument();
  });

  it("shows 0% when leads is zero", () => {
    render(<FinanceFunnel leads={0} confirmed={0} delivered={0} labels={labels} />);
    const zeros = screen.getAllByText("0.0%");
    expect(zeros.length).toBe(2);
  });

  it("shows 0% delivery rate when confirmed is zero", () => {
    render(<FinanceFunnel leads={10} confirmed={0} delivered={0} labels={labels} />);
    const zeros = screen.getAllByText("0.0%");
    // confirmation rate = 0, delivery rate = 0
    expect(zeros.length).toBe(2);
  });
});
