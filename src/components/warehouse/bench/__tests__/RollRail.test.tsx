import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RollRail } from "../RollRail";
import { Intl } from "./fixtures";

/**
 * The roll rail: how many parcels wait for each Darb sticker colour.
 *
 * The bench works one roll at a time (pick up the red roll, do every red
 * parcel, put it down), so the rail is the batching control, not decoration.
 */
afterEach(cleanup);

describe("RollRail", () => {
  it("lists every roll in poster order with its count, dimming the empty ones", () => {
    render(
      <Intl>
        <RollRail counts={{ "#d80a0a": 2, "#339307": 1 }} unknown={0} total={3} selected={null} onSelect={() => {}} />
      </Intl>,
    );
    const rolls = screen.getAllByTestId("wh-roll");
    // "all" + nine rolls; no unknown chip when nothing is unknown.
    expect(rolls).toHaveLength(10);
    expect(rolls[0]).toHaveTextContent("الكل");
    expect(rolls[0]).toHaveTextContent("3");
    expect(rolls[1]).toHaveAttribute("data-key", "#d80a0a");
    expect(rolls[1]).toHaveTextContent("أحمر");
    expect(rolls[1]).toHaveTextContent("2");
    expect(rolls[1]).toHaveAttribute("data-zero", "false");
    expect(rolls[2]).toHaveAttribute("data-key", "#fc6401");
    expect(rolls[2]).toHaveAttribute("data-zero", "true");
  });

  it("adds an unknown chip only when a parcel has no resolvable colour", () => {
    render(
      <Intl>
        <RollRail counts={{}} unknown={1} total={1} selected={null} onSelect={() => {}} />
      </Intl>,
    );
    const unknown = screen.getAllByTestId("wh-roll").at(-1)!;
    expect(unknown).toHaveAttribute("data-key", "unknown");
    expect(unknown).toHaveTextContent("غير معروف");
  });

  it("marks the selected roll and reports taps", () => {
    const onSelect = vi.fn();
    render(
      <Intl>
        <RollRail counts={{ "#d80a0a": 2 }} unknown={0} total={2} selected="#d80a0a" onSelect={onSelect} />
      </Intl>,
    );
    const red = screen.getAllByTestId("wh-roll")[1];
    expect(red).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getAllByTestId("wh-roll")[0]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("outlines the two colours that vanish on a light ground", () => {
    render(
      <Intl>
        <RollRail counts={{}} unknown={0} total={0} selected={null} onSelect={() => {}} />
      </Intl>,
    );
    const swatches = screen.getAllByTestId("wh-roll-swatch");
    const yellow = swatches.find((s) => s.getAttribute("data-hex") === "#f9fc01")!;
    const red = swatches.find((s) => s.getAttribute("data-hex") === "#d80a0a")!;
    expect(yellow).toHaveAttribute("data-faint", "true");
    expect(red).toHaveAttribute("data-faint", "false");
  });
});
