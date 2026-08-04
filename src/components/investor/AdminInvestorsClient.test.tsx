import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminInvestorsClient } from "./AdminInvestorsClient";

vi.mock("swr", () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn() }),
  mutate: vi.fn(),
}));

// Each panel has its own suite; stub them so this file tests only the shell.
vi.mock("./AdminInvestorsPanel", () => ({
  AdminInvestorsPanel: () => <div>panel:investors</div>,
}));
vi.mock("./AdminPositionsPanel", () => ({
  AdminPositionsPanel: () => <div>panel:positions</div>,
}));
vi.mock("./AdminSettlementPanel", () => ({
  AdminSettlementPanel: () => <div>panel:settlements</div>,
}));
vi.mock("./AdminWithdrawalsPanel", () => ({
  AdminWithdrawalsPanel: () => <div>panel:withdrawals</div>,
}));
vi.mock("./AdminCorrectionsPanel", () => ({
  AdminCorrectionsPanel: () => <div>panel:corrections</div>,
}));

const MARKETS = [
  { id: "m-ly", code: "ly", name: "Libya" },
  { id: "m-tn", code: "tn", name: "Tunisia" },
];

const mount = () => render(<AdminInvestorsClient markets={MARKETS} locale="fr" />);

beforeEach(() => vi.restoreAllMocks());

/**
 * Five panels used to stack on one scroll, so an operator paying a withdrawal
 * scrolled past a period-close form whose confirm button writes an irreversible
 * ledger entry. One job on screen at a time.
 */
describe("AdminInvestorsClient — tabs", () => {
  test("opens on the investors list", () => {
    mount();
    expect(screen.getByText("panel:investors")).toBeInTheDocument();
    expect(screen.queryByText("panel:settlements")).not.toBeInTheDocument();
  });

  test("shows exactly one panel at a time", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Clôtures" }));

    expect(screen.getByText("panel:settlements")).toBeInTheDocument();
    for (const other of ["investors", "positions", "withdrawals", "corrections"]) {
      expect(screen.queryByText(`panel:${other}`)).not.toBeInTheDocument();
    }
  });

  test("reaches every section", () => {
    mount();
    for (const [label, panel] of [
      ["Positions", "positions"],
      ["Retraits", "withdrawals"],
      ["Corrections", "corrections"],
      ["Investisseurs", "investors"],
    ] as const) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      expect(screen.getByText(`panel:${panel}`)).toBeInTheDocument();
    }
  });

  test("marks the active tab for assistive tech", () => {
    mount();
    expect(screen.getByRole("tab", { name: "Investisseurs" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    fireEvent.click(screen.getByRole("tab", { name: "Retraits" }));
    expect(screen.getByRole("tab", { name: "Retraits" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Investisseurs" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  /**
   * Closing a period is the one action on this page that cannot be undone. It
   * should never be one scroll away from routine work.
   */
  test("keeps the irreversible period close behind a deliberate click", () => {
    mount();
    expect(screen.queryByText("panel:settlements")).not.toBeInTheDocument();
  });
});
