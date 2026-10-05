import { describe, test, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { OutcomeRows } from "../OutcomeRows";

const rows = [
  { key: "del", label: "Livrées", color: "#4DAE7E", n: 275, hint: "colis remis" },
  { key: "rej", label: "Rejetées", color: "#E46A7B", n: 601, trend: <span>↓8</span> },
  { key: "pend", label: "En cours", color: "#D0D5DD", n: 0 },
];

describe("OutcomeRows — one bar per outcome, on one scale", () => {
  test("a labelled list with one row per outcome: count first, then its share of the total", () => {
    render(<OutcomeRows label="Ce que sont devenues les commandes" rows={rows} total={1441} pct={(v) => `${Math.round(v)} %`} num={(v) => String(v)} />);
    const list = screen.getByRole("list", { name: "Ce que sont devenues les commandes" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Livrées");
    expect(items[0]).toHaveTextContent("275");
    expect(items[0]).toHaveTextContent("19 %");
    expect(items[0]).toHaveTextContent("colis remis");
    expect(items[1]).toHaveTextContent("↓8");
  });

  test("bars share the total's scale, so the widths are the shares", () => {
    render(<OutcomeRows label="x" rows={rows} total={1441} pct={(v) => `${v}`} num={String} />);
    const fills = document.querySelectorAll<HTMLElement>("[data-fill]");
    expect(fills[1].style.width).toBe(`${((601 / 1441) * 100).toFixed(2)}%`);
    expect(fills[2].style.width).toBe("0%");
  });

  test("a zero row is drawn faint; a row with an action is a button", () => {
    const onClick = vi.fn();
    render(<OutcomeRows label="x" rows={[{ ...rows[0], onClick }, rows[2]]} total={10} pct={String} num={String} />);
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("data-zero");
    fireEvent.click(screen.getByRole("button", { name: /Livrées/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("without a share column the % is not written (counts of a day, not of a whole)", () => {
    render(<OutcomeRows label="x" rows={rows} total={1441} num={String} />);
    expect(screen.getAllByRole("listitem")[0]).not.toHaveTextContent("%");
  });
});
