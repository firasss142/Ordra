import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminSettlementPanel } from "./AdminSettlementPanel";

vi.mock("swr", () => ({ default: () => ({ data: undefined }), mutate: vi.fn() }));

const MARKETS = [
  { id: "m-tn", code: "tn", name: "Tunisia" },
  { id: "m-ly", code: "ly", name: "Libya" },
];

const preview = (over: Record<string, unknown> = {}) => ({
  dryRun: true,
  period: { start: "2026-03-01", end: "2026-03-31" },
  productsSettled: 1,
  marketWideAdSpend: 140,
  ledgerEntries: 3,
  totalPayable: 672.6,
  reserveReleaseAfter: "2026-06-29",
  alreadySettled: false,
  reconciliation: [
    { productId: "prod-1", netProfit: 38041.498, allocated: 38041.498, unallocated: 0 },
  ],
  unreconciled: [],
  statements: [
    {
      investor_id: "u-1",
      product_id: "prod-1",
      share_pct: 40,
      net_profit: 38041.498,
      investor_share: 672.6,
      reserve_held: 67.26,
    },
  ],
  ...over,
});

function mount() {
  render(<AdminSettlementPanel markets={MARKETS} locale="fr" />);
  fireEvent.change(screen.getByLabelText("Début"), { target: { value: "2026-03-01" } });
  fireEvent.change(screen.getByLabelText("Fin"), { target: { value: "2026-03-31" } });
}

async function runPreview(body: Record<string, unknown>, status = 200) {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Prévisualiser" }));
  await waitFor(() => expect(spy).toHaveBeenCalled());
  return spy;
}

beforeEach(() => vi.restoreAllMocks());

/**
 * The endpoint has always returned `alreadySettled`, `unreconciled` and a full
 * per-product reconciliation; the panel showed three numbers and dropped the
 * rest. An operator could preview an already-settled period, read a clean
 * total, click confirm, and meet a raw 409 rendered like a network blip.
 */
describe("AdminSettlementPanel — what the preview reveals", () => {
  test("previews as a dry run", async () => {
    const spy = await runPreview(preview());
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toMatchObject({ dry_run: true });
  });

  test("surfaces the per-product reconciliation the API returns", async () => {
    await runPreview(preview());
    expect(screen.getByText("Réconciliation par produit")).toBeInTheDocument();
    expect(screen.getByText(/38 041,498/)).toBeInTheDocument();
  });

  test("shows when the withheld reserve matures", async () => {
    await runPreview(preview());
    expect(screen.getByText("Réserve libérée le")).toBeInTheDocument();
  });
});

describe("AdminSettlementPanel — refusing to commit a bad run", () => {
  test("blocks and explains an already-settled period", async () => {
    await runPreview(preview({ alreadySettled: true }));
    expect(screen.getByText("Cette période est déjà réglée")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clôturer la période" })
    ).not.toBeInTheDocument();
  });

  test("blocks when allocations do not reconcile, and names the shortfall", async () => {
    await runPreview(
      preview({
        unreconciled: [
          { productId: "prod-1", netProfit: 38041.498, allocated: 15216.599, unallocated: 22824.899 },
        ],
      })
    );
    expect(screen.getByText(/ne réconcilient pas/)).toBeInTheDocument();
    expect(screen.getByText(/22 824,899/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clôturer la période" })
    ).not.toBeInTheDocument();
  });

  test("offers the commit only on a clean preview", async () => {
    await runPreview(preview());
    expect(screen.getByRole("button", { name: "Clôturer la période" })).toBeInTheDocument();
  });
});

describe("AdminSettlementPanel — committing", () => {
  test("requires a second confirmation that restates what will be written", async () => {
    const spy = await runPreview(preview());
    fireEvent.click(screen.getByRole("button", { name: "Clôturer la période" }));

    expect(screen.getByText(/irréversible/)).toBeInTheDocument();
    // Still only the preview call — nothing committed by opening the confirm.
    expect(spy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Oui, clôturer" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(spy.mock.calls[1][1]?.body))).toMatchObject({ dry_run: false });
  });

  /**
   * A preview is only valid for the range it was run against. Leaving the
   * commit button live after the dates change would settle a different period
   * than the one reviewed.
   */
  test("discards the preview when the period changes", async () => {
    await runPreview(preview());
    expect(screen.getByRole("button", { name: "Clôturer la période" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Fin"), { target: { value: "2026-04-30" } });
    expect(
      screen.queryByRole("button", { name: "Clôturer la période" })
    ).not.toBeInTheDocument();
  });

  test("shows the server's detail, not just its error code", async () => {
    await runPreview(
      { error: "This period is already settled.", detail: "1 statement(s) exist for 2026-03-01..2026-03-31." },
      409
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("1 statement(s) exist");
  });
});
