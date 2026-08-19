import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { WhKpiCell, WhKpiStrip, WhActionRow, WhPill, WhHolder } from "../primitives";
import { padCounter } from "../tokens";
import { Package } from "lucide-react";

afterEach(() => cleanup());

const HEX = /#[0-9a-fA-F]{3,8}/;

function classNames(container: HTMLElement): string {
  return Array.from(container.querySelectorAll<HTMLElement>("*"))
    .map((el) => el.className)
    .filter((c): c is string => typeof c === "string")
    .join(" ");
}

describe("WhKpiStrip", () => {
  it("renders every cell's label, figure and context chip", () => {
    render(
      <WhKpiStrip
        cells={[
          { id: "a", label: "À préparer", value: 17, tone: "warn", icon: Package, chip: "Plus ancien : 4 j", gaugePct: 40 },
          { id: "b", label: "Scannées", value: 11, tone: "scan", icon: Package, chip: "+3 vs objectif", gaugePct: 55 },
        ]}
      />,
    );
    expect(screen.getByText("À préparer")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("Plus ancien : 4 j")).toBeInTheDocument();
    expect(screen.getByText("+3 vs objectif")).toBeInTheDocument();
  });

  it("keeps figures tabular so columns of digits do not jitter", () => {
    const { container } = render(
      <WhKpiStrip cells={[{ id: "a", label: "Remis", value: 14, tone: "ok", icon: Package }]} />,
    );
    expect(container.querySelector(".tabular-nums")).toBeTruthy();
  });

  it("marks a settled cell as settled instead of drawing a gauge", () => {
    render(
      <WhKpiStrip
        cells={[{ id: "a", label: "Stock bas", value: 0, tone: "muted", icon: Package, settled: true }]}
      />,
    );
    // Nothing to do reads as nothing to do: no gauge competing for attention.
    expect(screen.getByTestId("wh-kpi-settled")).toBeInTheDocument();
    expect(screen.queryByTestId("wh-kpi-gauge")).not.toBeInTheDocument();
  });

  it("styles through tokens, never raw hex", () => {
    const { container } = render(
      <WhKpiStrip cells={[{ id: "a", label: "Retours", value: 6, tone: "move", icon: Package }]} />,
    );
    expect(classNames(container)).not.toMatch(HEX);
  });
});

describe("WhActionRow", () => {
  it("renders title, detail, value and unit", () => {
    render(
      <WhActionRow
        icon={Package}
        tone="bad"
        title="Rattraper les commandes jamais scannées"
        detail="Étiquetées chez Darb, toujours comptées dans notre stock."
        value={427}
        unit="cmdes"
      />,
    );
    expect(screen.getByText(/Rattraper les commandes/)).toBeInTheDocument();
    expect(screen.getByText("427")).toBeInTheDocument();
    expect(screen.getByText("cmdes")).toBeInTheDocument();
  });

  it("wears a severity stripe only when asked", () => {
    const { container, rerender } = render(
      <WhActionRow icon={Package} tone="bad" title="t" detail="d" value={1} unit="u" stripe="bad" />,
    );
    expect(container.querySelector(".border-s-wh-bad")).toBeTruthy();
    rerender(<WhActionRow icon={Package} tone="bad" title="t" detail="d" value={1} unit="u" />);
    expect(container.querySelector(".border-s-wh-bad")).toBeFalsy();
  });

  it("is a button when it can be acted on, plain content otherwise", () => {
    const { rerender } = render(
      <WhActionRow icon={Package} tone="warn" title="t" detail="d" value={1} unit="u" onClick={() => {}} />,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
    rerender(<WhActionRow icon={Package} tone="warn" title="t" detail="d" value={1} unit="u" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("WhPill / WhHolder", () => {
  it("renders pill content and avoids raw hex", () => {
    const { container } = render(<WhPill tone="ok">Prête</WhPill>);
    expect(screen.getByText("Prête")).toBeInTheDocument();
    expect(classNames(container)).not.toMatch(HEX);
  });

  it("hides the holder glyph from assistive tech", () => {
    const { container } = render(<WhHolder icon={Package} tone="scan" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("padCounter", () => {
  it("pads to a fixed width so the counters stop shifting", () => {
    expect(padCounter(6)).toBe("0006");
    expect(padCounter(0)).toBe("0000");
    expect(padCounter(1234)).toBe("1234");
  });

  it("never renders a negative counter", () => {
    expect(padCounter(-3)).toBe("0000");
  });
});
