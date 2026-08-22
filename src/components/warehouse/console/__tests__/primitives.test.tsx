import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { Boxes, ScanLine } from "lucide-react";
import { WhPipeline, WhKpiCard, WhKpiGrid, WhActionRow, WhChip, WhCard } from "../primitives";

afterEach(() => cleanup());

describe("WhPipeline", () => {
  const cells = [
    { id: "a", label: "À préparer", value: 17, tone: "warn" as const, icon: Boxes, barPct: 40 },
    { id: "b", label: "Scannées", value: 0, tone: "scan" as const, icon: ScanLine, dim: true },
  ];

  it("sets figures in the mono face, tabular", () => {
    render(<WhPipeline cells={cells} />);
    const value = within(screen.getByTestId("wh-cell-a")).getByTestId("wh-value");
    expect(value.className).toMatch(/font-mono/);
    expect(value.className).toMatch(/tabular-nums/);
  });

  it("dims a cell with nothing to say, and drops its bar with it", () => {
    render(<WhPipeline cells={cells} />);
    const quiet = screen.getByTestId("wh-cell-b");
    expect(quiet.dataset.dim).toBe("true");
    expect(quiet.className).toMatch(/opacity-50/);
    // A dimmed cell draws no bar: there is no progress to report.
    expect(within(quiet).queryByTestId("wh-bar")).toBeNull();
  });

  it("draws the bar along the cell's bottom edge, sized by its share", () => {
    render(<WhPipeline cells={cells} />);
    const bar = within(screen.getByTestId("wh-cell-a")).getByTestId("wh-bar");
    expect(bar.className).toMatch(/absolute/);
    expect(bar.className).toMatch(/bottom-0/);
    expect(bar.getAttribute("style")).toContain("0.4");
  });

  it("never lets a bar vanish entirely, so a small queue is still visible", () => {
    render(<WhPipeline cells={[{ ...cells[0], barPct: 0 }]} />);
    expect(within(screen.getByTestId("wh-cell-a")).getByTestId("wh-bar").getAttribute("style"))
      .toContain("0.02");
  });
});

describe("WhKpiCard", () => {
  it("shows a figure with its unit and a divided footer", () => {
    render(
      <WhKpiCard
        id="queue"
        label="Dans la file"
        icon={Boxes}
        tone="warn"
        value={6}
        unit="colis"
        note="Le plus ancien : 14 j"
        foot={[
          { value: "944,00 LYD", label: "Valeur en file" },
          { value: "3", label: "Traités" },
        ]}
        edge="warn"
      />,
    );
    const card = screen.getByTestId("wh-kpi-queue");
    expect(within(card).getByText("6")).toBeInTheDocument();
    expect(within(card).getByText("colis")).toBeInTheDocument();
    expect(within(card).getByText("944,00 LYD")).toBeInTheDocument();
    // The severity edge is an inset bar, not a border colour swap alone.
    expect(card.className).toMatch(/inset_0_2px_0/);
  });

  it("mutes the figure when there is nothing to report", () => {
    render(<WhKpiCard id="dep" label="Dépréciés" value={0} unit="u" dim />);
    const card = screen.getByTestId("wh-kpi-dep");
    expect(card.dataset.dim).toBe("true");
    expect(within(card).getByTestId("wh-value").className).toMatch(/text-wh-ink-3/);
  });

  it("clamps a progress bar to its track", () => {
    render(<WhKpiCard id="goal" label="Objectif" value={80} progressPct={140} />);
    const fill = screen.getByTestId("wh-kpi-goal").querySelector("i");
    expect(fill?.getAttribute("style")).toContain("100%");
  });
});

describe("WhActionRow", () => {
  const base = {
    id: "late",
    icon: Boxes,
    tone: "warn" as const,
    title: "Sortir les colis en retard",
    detail: "Le plus ancien attend 4 j",
    value: 5,
    unit: "colis",
  };

  it("is inert content until it has somewhere to go", () => {
    render(<WhActionRow {...base} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("wh-action-late")).toBeInTheDocument();
  });

  it("becomes a control, with a chevron, once given a handler", () => {
    const go = vi.fn();
    render(<WhActionRow {...base} onClick={go} />);
    screen.getByRole("button").click();
    expect(go).toHaveBeenCalledOnce();
  });

  it("carries the severity stripe only when asked", () => {
    const { rerender } = render(<WhActionRow {...base} />);
    expect(screen.getByTestId("wh-action-late").dataset.stripe).toBe("false");
    rerender(<WhActionRow {...base} stripe />);
    expect(screen.getByTestId("wh-action-late").dataset.stripe).toBe("true");
  });
});

describe("house rules", () => {
  it("styles through tokens, never raw hex", () => {
    const { container } = render(
      <WhKpiGrid>
        <WhCard title="Carte">
          <WhChip tone="ok">+28 %</WhChip>
          <WhActionRow id="x" icon={ScanLine} tone="ok" title="t" detail="d" value={1} unit="u" />
        </WhCard>
      </WhKpiGrid>,
    );
    const classes = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .map((el) => el.className)
      .filter((c): c is string => typeof c === "string")
      .join(" ");
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
