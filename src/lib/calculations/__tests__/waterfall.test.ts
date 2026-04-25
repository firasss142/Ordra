import { describe, it, expect } from "vitest";
import { calculateWaterfallSteps } from "../waterfall";

describe("calculateWaterfallSteps", () => {
  const pnl = {
    revenue: 1000,
    cogs: 300,
    delivery_cost: 150,
    return_cost: 50,
    packing_cost: 30,
    ad_spend: 200,
    net_profit: 270,
  };

  it("returns 7 steps in the correct order", () => {
    const steps = calculateWaterfallSteps(pnl);
    expect(steps.map((s) => s.key)).toEqual([
      "revenue",
      "cogs",
      "delivery",
      "returns",
      "packing",
      "ads",
      "net_profit",
    ]);
  });

  it("revenue step has sign +1 and cumulative equals revenue", () => {
    const [rev] = calculateWaterfallSteps(pnl);
    expect(rev.value).toBe(1000);
    expect(rev.sign).toBe(1);
    expect(rev.cumulative).toBe(1000);
  });

  it("cost steps have sign -1 and decrement cumulative", () => {
    const steps = calculateWaterfallSteps(pnl);
    const cogs = steps.find((s) => s.key === "cogs")!;
    const delivery = steps.find((s) => s.key === "delivery")!;
    expect(cogs.sign).toBe(-1);
    expect(cogs.value).toBe(300);
    expect(cogs.cumulative).toBe(700);
    expect(delivery.sign).toBe(-1);
    expect(delivery.cumulative).toBe(550);
  });

  it("net_profit step cumulative equals net_profit input", () => {
    const steps = calculateWaterfallSteps(pnl);
    const net = steps.find((s) => s.key === "net_profit")!;
    expect(net.value).toBe(270);
    expect(net.cumulative).toBe(270);
    expect(net.sign).toBe(0);
  });

  it("cumulative at net_profit equals revenue minus all costs", () => {
    const steps = calculateWaterfallSteps(pnl);
    const net = steps.find((s) => s.key === "net_profit")!;
    const expected = pnl.revenue - pnl.cogs - pnl.delivery_cost - pnl.return_cost - pnl.packing_cost - pnl.ad_spend;
    expect(net.cumulative).toBe(expected);
  });

  it("handles negative net profit (costs exceed revenue)", () => {
    const loss = { ...pnl, ad_spend: 800, net_profit: -330 };
    const steps = calculateWaterfallSteps(loss);
    const net = steps.find((s) => s.key === "net_profit")!;
    expect(net.value).toBe(-330);
    expect(net.cumulative).toBe(-330);
  });

  it("avoids floating-point drift with decimal values", () => {
    const decimal = {
      revenue: 100.50,
      cogs: 29.99,
      delivery_cost: 10.01,
      return_cost: 5.00,
      packing_cost: 5.50,
      ad_spend: 10.00,
      net_profit: 40,
    };
    const steps = calculateWaterfallSteps(decimal);
    const net = steps.find((s) => s.key === "net_profit")!;
    expect(net.cumulative).toBe(40);
  });
});
