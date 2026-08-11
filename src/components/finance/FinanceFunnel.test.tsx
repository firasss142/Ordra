import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinanceFunnel } from "./FinanceFunnel";

const labels = {
  leads: "Leads",
  confirmed: "Confirmed",
  delivered: "Delivered",
  toConfirmed: "Confirmation",
  toDelivered: "Delivery",
  notCohort: "cohortes différentes",
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
    expect(screen.getByText("80.0%")).toBeInTheDocument();
  });

  /**
   * The live Libya market renders leads=1, confirmed=13, delivered=20, which
   * the old component published as "1300.0%" and "153.8%". The three stages
   * are not one cohort over the window, so the ratio is not a conversion rate
   * — it is an artefact. §4.17 G: a headline number and the thing it claims
   * to measure must be the same set.
   */
  it("suppresses a rate above 100% instead of publishing it", () => {
    render(<FinanceFunnel leads={1} confirmed={13} delivered={20} labels={labels} />);
    expect(screen.queryByText("1300.0%")).toBeNull();
    expect(screen.queryByText("153.8%")).toBeNull();
    expect(screen.getAllByTestId("funnel-rate-suppressed").length).toBe(2);
  });

  it("suppresses a rate whose denominator is too thin to support one", () => {
    // 4 leads is not a base you can quote a conversion percentage from.
    render(<FinanceFunnel leads={4} confirmed={2} delivered={1} labels={labels} />);
    expect(screen.queryByText("50.0%")).toBeNull();
    expect(screen.getAllByTestId("funnel-rate-suppressed").length).toBe(2);
  });

  it("still shows the counts when the rates are suppressed", () => {
    render(<FinanceFunnel leads={1} confirmed={13} delivered={20} labels={labels} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("suppresses rather than dividing by zero when leads is zero", () => {
    render(<FinanceFunnel leads={0} confirmed={0} delivered={0} labels={labels} />);
    expect(screen.getAllByTestId("funnel-rate-suppressed").length).toBe(2);
  });
});
