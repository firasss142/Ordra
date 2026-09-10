import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { ScanRun } from "../ScanRun";
import { Intl, row, GREEN, RED, UNKNOWN } from "./fixtures";

/**
 * The scan run: choose what you hold, then work through it.
 *
 * The bench asks the agent to decide again on every parcel — which colour, which
 * card, take, scan, back to the list. A run makes that decision once: one roll
 * or one product in hand, then parcel after parcel until the batch is done.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/ar/warehouse/scan",
  useSearchParams: () => new URLSearchParams(""),
}));

const mutate = vi.fn();
vi.mock("swr", () => ({
  default: (_k: string, _f: unknown, opts?: { fallbackData?: unknown }) => ({
    data: opts?.fallbackData, error: undefined, isLoading: false, mutate,
  }),
}));

vi.mock("@/components/warehouse/QrScanner", () => ({
  QrScanner: ({ onScan }: { onScan: (v: string) => void }) => (
    <button type="button" data-testid="qr-scanner" onClick={() => onScan("7700001")} />
  ),
}));

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }));
}

const BOUND = { order_id: "x", status: "scanned", stock_after: 39, darb_bound: true, sticker_bind_state: "confirmed" };

function renderRun(orders = [red1, red2, green], market: "ly" | "tn" = "ly", locale: "ar" | "fr" = "fr") {
  return render(
    <Intl locale={locale}>
      <ScanRun market={market} locale={locale} currency="LYD" initialOrders={orders} siteName="Tripoli" />
    </Intl>,
  );
}

const red1 = row({ id: "r1", customer_name: "محمد علي", product_id: "p1", product_name: "Dumbbell" });
const red2 = row({ id: "r2", customer_name: "فاطمة", product_id: "p1", product_name: "Dumbbell" });
const green = row({ id: "g1", customer_name: "سعاد", product_id: "p2", product_name: "Corde", zone: GREEN, customer_city: "بنغازي" });

beforeEach(() => {
  push.mockClear();
  mutate.mockClear();
  sessionStorage.clear();
  localStorage.clear();
  respond(200, BOUND);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("choosing what to hold", () => {
  it("offers the two ways a warehouse actually batches", () => {
    renderRun();
    expect(screen.getByRole("button", { name: /Même produit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Même couleur/ })).toBeInTheDocument();
  });

  it("calls it a region in Tunisia, where there are no Darb rolls", () => {
    renderRun([row({ zone: UNKNOWN, customer_city: "Sousse" })], "tn");
    expect(screen.getByRole("button", { name: /Même région/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Même couleur/ })).not.toBeInTheDocument();
  });

  it("lists the batches of the chosen mode with their size", () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    const buckets = screen.getAllByTestId("wh-run-bucket");
    expect(buckets[0]).toHaveTextContent("Dumbbell");
    expect(buckets[0]).toHaveTextContent("2");
  });

  it("shows the rolls in Darb's order, so the shelf never moves", () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: /Même couleur/ }));
    const buckets = screen.getAllByTestId("wh-run-bucket");
    expect(buckets.map((b) => b.getAttribute("data-roll"))).toEqual(["#d80a0a", "#339307"]);
  });

  it("names a mixed batch instead of hiding it in a product", () => {
    const mixed = row({
      id: "mix",
      items: [
        { product_id: "p1", product_name: "Dumbbell", variant_label: null, quantity: 1, image_url: null },
        { product_id: "p2", product_name: "Corde", variant_label: null, quantity: 1, image_url: null },
      ],
    });
    renderRun([red1, mixed]);
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    const buckets = screen.getAllByTestId("wh-run-bucket");
    expect(buckets[buckets.length - 1]).toHaveTextContent("Colis mixtes");
  });

  it("says the bench is empty rather than showing an empty picker", () => {
    renderRun([]);
    expect(screen.getByText(/Le banc est vide/)).toBeInTheDocument();
  });

  it("refuses to start a run for an agent with no building", () => {
    render(
      <Intl locale="fr">
        <ScanRun market="ly" locale="fr" currency="LYD" initialOrders={[]} siteUnassigned />
      </Intl>,
    );
    expect(screen.getByTestId("wh-run-no-site")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Même produit/ })).not.toBeInTheDocument();
  });
});

describe("working a batch", () => {
  function startProductBatch() {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    fireEvent.click(screen.getAllByTestId("wh-run-bucket")[0]);
  }

  it("shows where you are in the batch, not just the parcel", () => {
    startProductBatch();
    expect(screen.getByTestId("wh-run-progress")).toHaveTextContent("1 / 2");
  });

  it("puts the parcel in front of the agent before the camera opens", () => {
    startProductBatch();
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("محمد علي");
    expect(screen.queryByTestId("qr-scanner")).not.toBeInTheDocument();
  });

  it("opens the scanner only once the agent says it is the right parcel", () => {
    startProductBatch();
    fireEvent.click(screen.getByRole("button", { name: /C'est bien ce colis/ }));
    expect(screen.getByTestId("wh-run-scanner")).toBeInTheDocument();
  });

  it("lists every product of a mixed parcel, with its quantity", () => {
    const mixed = row({
      id: "mix",
      items: [
        { product_id: "p1", product_name: "Dumbbell", variant_label: "5 kg", quantity: 2, image_url: null },
        { product_id: "p2", product_name: "Corde", variant_label: null, quantity: 1, image_url: null },
        { product_id: "p3", product_name: "Tapis", variant_label: null, quantity: 3, image_url: null },
      ],
    });
    renderRun([mixed]);
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    fireEvent.click(screen.getAllByTestId("wh-run-bucket")[0]);
    const lines = screen.getAllByTestId("wh-run-line");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent("Dumbbell");
    expect(lines[0]).toHaveTextContent("2");
    expect(lines[2]).toHaveTextContent("Tapis");
  });

  it("carries the roll colour into the run, named and plated", () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: /Même couleur/ }));
    fireEvent.click(screen.getAllByTestId("wh-run-bucket")[0]);
    const band = screen.getByTestId("wh-run-band");
    expect(band).toHaveAttribute("data-roll", "#d80a0a");
    expect(band).toHaveTextContent("Rouge");
    expect(screen.getByTestId("wh-run-plate")).toHaveTextContent("TR");
  });

  it("moves to the next parcel after a successful bind", async () => {
    startProductBatch();
    fireEvent.click(screen.getByRole("button", { name: /C'est bien ce colis/ }));
    fireEvent.click(screen.getByTestId("qr-scanner"));
    await screen.findByTestId("wh-run-result");
    // eslint-disable-next-line no-console
    fireEvent.click(screen.getByRole("button", { name: /^Colis suivant$/ }));
    await waitFor(() => {
      expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("فاطمة");
    });
    // The bound parcel has left the batch, so what remains is one of one. The
    // counter describes work still to do, not a total fixed when the run began.
    expect(screen.getByTestId("wh-run-progress")).toHaveTextContent("1 / 1");
  });

  it("keeps the tally of what happened as the batch runs", async () => {
    startProductBatch();
    fireEvent.click(screen.getByRole("button", { name: /C'est bien ce colis/ }));
    fireEvent.click(screen.getByTestId("qr-scanner"));
    await screen.findByTestId("wh-run-result");
    expect(screen.getByTestId("wh-run-tally")).toHaveTextContent("1");
  });

  it("a skipped parcel comes back at the end, once", () => {
    startProductBatch();
    fireEvent.click(screen.getByRole("button", { name: /Passer ce colis/ }));
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("فاطمة");
    fireEvent.click(screen.getByRole("button", { name: /Passer ce colis/ }));
    // Back to the first, which was skipped — not a third parcel that does not exist.
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("محمد علي");
  });

  it("does not advance on its own when Darb kept a different number", async () => {
    respond(200, { ...BOUND, sticker_bind_state: "restickered", carrier_reference: "1279049" });
    startProductBatch();
    fireEvent.click(screen.getByRole("button", { name: /C'est bien ce colis/ }));
    fireEvent.click(screen.getByTestId("qr-scanner"));
    const result = await screen.findByTestId("wh-run-result");
    // The agent must read this one: the parcel is travelling under another
    // number, so the run holds still and names the number Darb kept instead.
    expect(result).toHaveAttribute("data-outcome", "bind_unverified");
    expect(screen.getByTestId("wh-run-unverified")).toHaveTextContent("1279049");
    // No automatic advance: the result is still on screen after the delay.
    await new Promise((r) => setTimeout(r, 1600));
    expect(screen.getByTestId("wh-run-result")).toHaveAttribute("data-outcome", "bind_unverified");
  });

  it("keeps a refusal on screen with a way out", async () => {
    respond(422, { error_code: "STICKER_ALREADY_USED", message: "déjà lié" });
    startProductBatch();
    fireEvent.click(screen.getByRole("button", { name: /C'est bien ce colis/ }));
    fireEvent.click(screen.getByTestId("qr-scanner"));
    const result = await screen.findByTestId("wh-run-result");
    expect(result).toHaveAttribute("data-outcome", "refused_here");
    expect(screen.getByRole("button", { name: /Réessayer/ })).toBeInTheDocument();
  });
});

describe("the run survives the phone", () => {
  it("remembers the batch across a remount, so a locked screen costs nothing", () => {
    const { unmount } = renderRun();
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    fireEvent.click(screen.getAllByTestId("wh-run-bucket")[0]);
    expect(screen.getByTestId("wh-run-parcel")).toBeInTheDocument();
    unmount();

    renderRun();
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("محمد علي");
  });
});

describe("finishing a batch", () => {
  it("reports what the batch cost and what still needs a human", async () => {
    renderRun([red1]);
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    fireEvent.click(screen.getAllByTestId("wh-run-bucket")[0]);
    fireEvent.click(screen.getByRole("button", { name: /C'est bien ce colis/ }));
    fireEvent.click(screen.getByTestId("qr-scanner"));
    await screen.findByTestId("wh-run-result");
    fireEvent.click(screen.getByRole("button", { name: /^Colis suivant$/ }));
    const summary = await screen.findByTestId("wh-run-summary");
    expect(summary).toHaveTextContent("Lot terminé");
    expect(summary).toHaveTextContent("1");
  });

  it("offers the next batch rather than dumping the agent back at the start", async () => {
    // Finish the SMALLER batch (Corde, one parcel); the offer must then be the
    // Dumbbell batch that is still waiting, never the one just completed.
    renderRun([red1, red2, green]);
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    const corde = screen.getAllByTestId("wh-run-bucket").find((b) => b.textContent?.includes("Corde"))!;
    fireEvent.click(corde);
    fireEvent.click(screen.getByRole("button", { name: /C'est bien ce colis/ }));
    fireEvent.click(screen.getByTestId("qr-scanner"));
    await screen.findByTestId("wh-run-result");
    fireEvent.click(screen.getByRole("button", { name: /^Colis suivant$/ }));
    await screen.findByTestId("wh-run-summary");
    expect(screen.getByRole("button", { name: /Lot suivant/ })).toHaveTextContent("Dumbbell");
  });
});
