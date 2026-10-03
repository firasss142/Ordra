import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReturnCard, OnTheWayCard } from "../ReturnCard";
import { atDarb, onTheWay } from "@/components/warehouse/returns/__tests__/fixtures";

/**
 * One returned parcel on the phone (prototype `.parcel`): product and quantity
 * first, then city · first name · Darb's reason, then how long Darb has held
 * it — amber past two days. A parcel still on the road is the same row, greyed
 * and inert: it is not receivable yet.
 */
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

afterEach(cleanup);

describe("ReturnCard — chez Darb pour nous", () => {
  it("reads product ×qty, then city · first name · reason", () => {
    render(<ReturnCard row={atDarb("1")} onOpen={() => {}} />);
    const row = screen.getByRole("button");
    expect(row).toHaveTextContent("مصحف القرآن تدبر وعمل");
    expect(row).toHaveTextContent("×1");
    expect(screen.getByText("طبرق · سعاد · Refusé par le client")).toBeInTheDocument();
  });

  it("drops the reason when Darb gave none", () => {
    render(<ReturnCard row={atDarb("1", { darb_reason: null })} onOpen={() => {}} />);
    expect(screen.getByText("طبرق · سعاد")).toBeInTheDocument();
  });

  it("ages from when Darb marked it returned, amber past two days", () => {
    const { rerender } = render(<ReturnCard row={atDarb("1", { hoursAtDarb: 96 })} onOpen={() => {}} />);
    expect(screen.getByText("il y a 4 j").closest("[data-tone]")).toHaveAttribute("data-tone", "warn");
    rerender(<ReturnCard row={atDarb("1", { hoursAtDarb: 25 })} onOpen={() => {}} />);
    expect(screen.getByText("il y a 1 j").closest("[data-tone]")).toHaveAttribute("data-tone", "mute");
    rerender(<ReturnCard row={atDarb("1", { hoursAtDarb: 5 })} onOpen={() => {}} />);
    expect(screen.getByText("il y a 5 h")).toBeInTheDocument();
  });

  it("opens the verdict for its parcel", () => {
    const onOpen = vi.fn();
    render(<ReturnCard row={atDarb("o-7")} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("o-7");
  });
});

describe("OnTheWayCard — en route", () => {
  it("shows the product and « city · à scanner à l'arrivée », and is not a button", () => {
    render(<OnTheWayCard row={onTheWay("w-1")} />);
    expect(screen.getByText("مصحف القرآن تدبر وعمل")).toBeInTheDocument();
    expect(screen.getByText("سرت · à scanner à l'arrivée")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
