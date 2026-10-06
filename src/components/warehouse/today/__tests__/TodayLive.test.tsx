import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TodayResponse } from "@/app/api/warehouse/today/route";
import { TodayLive } from "../TodayLive";

/**
 * Which driver switch the agent's « Aujourd'hui » carries: Darb's in Libya, X-Delivery's
 * in Tunisia (prototypes/xdelivery-v1.html), never both.
 */

vi.mock("swr", () => ({
  default: (_k: string, _f: unknown, opts?: { fallbackData?: unknown }) => ({ data: opts?.fallbackData }),
}));
vi.mock("../TodayHome", () => ({
  TodayHome: ({ pickup }: { pickup?: React.ReactNode }) => <div data-testid="home">{pickup}</div>,
}));
vi.mock("@/components/warehouse/desk/TodayDesk", () => ({ TodayDesk: () => null }));
vi.mock("@/components/warehouse/pickup/PickupSwitch", () => ({
  PickupSwitch: () => <div data-testid="darb-switch" />,
}));
vi.mock("@/components/warehouse/pickup/XDeliveryPickupCard", () => ({
  XDeliveryPickupCard: () => <div data-testid="xd-card" />,
}));

const initial = {} as TodayResponse;
const renderLive = (marketCode: "ly" | "tn") =>
  render(
    <TodayLive
      initial={initial}
      variant="agent"
      locale="fr"
      dateLabel="mardi 6 octobre"
      warehouseId={null}
      showPickup={marketCode === "ly"}
      marketCode={marketCode}
    />,
  );

afterEach(cleanup);

describe("TodayLive — the agent's pickup slot", () => {
  it("Tunisia: the X-Delivery card", () => {
    renderLive("tn");
    expect(screen.getByTestId("xd-card")).toBeInTheDocument();
    expect(screen.queryByTestId("darb-switch")).toBeNull();
  });

  it("Libya: Darb's switch only", () => {
    renderLive("ly");
    expect(screen.getByTestId("darb-switch")).toBeInTheDocument();
    expect(screen.queryByTestId("xd-card")).toBeNull();
  });
});
