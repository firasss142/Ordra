import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { ScanRun } from "../ScanRun";
import { Intl, row, GREEN, UNKNOWN } from "./fixtures";
import { SCANNER_PREFS_KEY } from "@/lib/warehouse/scanner-prefs";

/**
 * The scan run (prototype v3, `R.run` / `R.bound`).
 *
 * The parcel IS in hand: the run opens on it with the camera and the sticker
 * field already there — no "is this the parcel?" step. The band wears the roll
 * colour, a clean bind sweeps green and the next parcel of the same roll comes
 * on its own in 1.4 s; the amber outcomes never advance by themselves.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/ar/warehouse/scan",
  useSearchParams: () => new URLSearchParams(""),
}));

const mutate = vi.fn();
/** What the server returns on the next revalidation; null = the page as rendered. */
const revalidated: { data: unknown } = { data: null };
vi.mock("swr", () => ({
  default: (_k: string, _f: unknown, opts?: { fallbackData?: unknown }) => ({
    data: revalidated.data ?? opts?.fallbackData, error: undefined, isLoading: false, mutate,
  }),
}));

/** The camera, without a camera: the test fires what it would have decoded. */
const camera: { active: boolean; onScan: ((v: string) => void) | null } = { active: false, onScan: null };
vi.mock("../useQrCamera", () => ({
  useQrCamera: ({ active, onScan }: { active: boolean; onScan: (v: string) => void }) => {
    camera.active = active;
    camera.onScan = onScan;
    return { starting: false, error: null };
  },
}));

function respond(status: number, body: unknown) {
  const f = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", f);
  return f;
}

const BOUND = { order_id: "x", status: "scanned", stock_after: 39, darb_bound: true, sticker_bind_state: "confirmed" };

const red1 = row({ id: "r1", customer_name: "محمد علي", product_id: "p1", product_name: "Dumbbell", customer_city: "Tripoli" });
const red2 = row({ id: "r2", customer_name: "فاطمة", product_id: "p1", product_name: "Dumbbell", customer_city: "Tajoura" });
const green = row({ id: "g1", customer_name: "سعاد", product_id: "p2", product_name: "Corde", zone: GREEN, customer_city: "بنغازي" });

function renderRun(
  orders = [red1, red2, green],
  extra: Partial<React.ComponentProps<typeof ScanRun>> = {},
  locale: "ar" | "fr" = "fr",
) {
  return render(
    <Intl locale={locale}>
      <ScanRun market="ly" locale={locale} currency="LYD" initialOrders={orders} siteName="Tripoli" {...extra} />
    </Intl>,
  );
}

/** Type a sticker number and press « Lier », as an agent without a camera does. */
function bind(code: string) {
  fireEvent.change(screen.getByPlaceholderText("ou tapez le numéro du sticker"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Lier" }));
}

beforeEach(() => {
  push.mockClear();
  mutate.mockClear();
  revalidated.data = null;
  sessionStorage.clear();
  localStorage.clear();
  camera.active = false;
  camera.onScan = null;
  respond(200, BOUND);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("choosing what to hold", () => {
  it("offers the two ways a warehouse actually batches", () => {
    renderRun();
    expect(screen.getByRole("button", { name: /Même produit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Même couleur/ })).toBeInTheDocument();
  });

  it("calls it a region in Tunisia, where there are no Darb rolls", () => {
    render(
      <Intl locale="fr">
        <ScanRun market="tn" locale="fr" currency="TND" initialOrders={[row({ zone: UNKNOWN, customer_city: "Sousse" })]} />
      </Intl>,
    );
    expect(screen.getByRole("button", { name: /Même région/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Même couleur/ })).not.toBeInTheDocument();
  });

  it("shows the rolls in Darb's order, so the shelf never moves", () => {
    renderRun();
    fireEvent.click(screen.getByRole("button", { name: /Même couleur/ }));
    const buckets = screen.getAllByTestId("wh-run-bucket");
    expect(buckets.map((b) => b.getAttribute("data-roll"))).toEqual(["#d80a0a", "#339307"]);
  });

  it("says the bench is empty rather than showing an empty picker", () => {
    renderRun([]);
    expect(screen.getByText(/Le banc est vide/)).toBeInTheDocument();
  });

  it("refuses to start a run for an agent with no building", () => {
    renderRun([], { siteUnassigned: true });
    expect(screen.getByTestId("wh-run-no-site")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Même produit/ })).not.toBeInTheDocument();
  });
});

describe("the parcel in hand (R.run)", () => {
  it("opens on the chosen roll with the parcel AND the scanner — no confirmation step", () => {
    renderRun(undefined, { initialRoll: "#339307" });
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("Corde");
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("بنغازي");
    expect(screen.getByPlaceholderText("ou tapez le numéro du sticker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /C'est bien ce colis/ })).not.toBeInTheDocument();
  });

  it("wears the roll on a full-width band: name, region, branch plate and the way out", () => {
    renderRun(undefined, { initialRoll: "#339307" });
    const band = screen.getByTestId("wh-run-band");
    expect(band).toHaveAttribute("data-roll", "#339307");
    expect(band).toHaveTextContent("Rouleau Vert");
    expect(band).toHaveTextContent("Région orientale");
    expect(within(band).getByTestId("wh-run-plate")).toHaveTextContent("BN");
    fireEvent.click(within(band).getByRole("button", { name: "Quitter la tournée" }));
    expect(push).toHaveBeenCalledWith("/fr/warehouse/out");
  });

  it("puts dark text on the light rolls, white on the others", () => {
    const yellow = row({ id: "y1", zone: { ...GREEN, colorHex: "#f9fc01", colourFr: "Jaune", branchGroup: "MIS" } });
    renderRun([yellow], { initialRoll: "#f9fc01" });
    expect(screen.getByTestId("wh-run-band")).toHaveAttribute("data-light", "true");
  });

  it("opens on the very parcel tapped on Sortir", () => {
    renderRun(undefined, { initialRoll: "#d80a0a", initialOrder: "r2" });
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("فاطمة");
    expect(screen.getByTestId("wh-run-progress")).toHaveTextContent("2 / 2");
  });

  it("says where the parcel sits in the batch, with one dot per parcel", () => {
    renderRun(undefined, { initialRoll: "#d80a0a" });
    expect(screen.getByText("En main")).toBeInTheDocument();
    expect(screen.getByTestId("wh-run-progress")).toHaveTextContent("1 / 2");
    expect(screen.getAllByTestId("wh-run-dot")).toHaveLength(2);
  });

  it("names the roll in the instruction, and frames the viewfinder in its colour", () => {
    renderRun(undefined, { initialRoll: "#339307" });
    expect(screen.getByText("Collez un sticker du rouleau Vert sur ce colis, puis scannez-le.")).toBeInTheDocument();
    expect(screen.getByTestId("wh-run-viewfinder")).toHaveAttribute("data-frame", "#339307");
  });

  it("opens the camera inside the viewfinder on a tap", () => {
    // « Caméra d'abord » switched off in Réglages: the viewfinder waits for a tap.
    localStorage.setItem(SCANNER_PREFS_KEY, JSON.stringify({ cameraFirst: false }));
    renderRun(undefined, { initialRoll: "#339307" });
    expect(camera.active).toBe(false);
    fireEvent.click(screen.getByTestId("wh-run-viewfinder"));
    expect(camera.active).toBe(true);
  });

  it("opens the camera by itself when the agent keeps « Caméra d'abord » (the default)", () => {
    renderRun(undefined, { initialRoll: "#339307" });
    expect(camera.active).toBe(true);
  });

  it("lists every product of a mixed parcel, with its quantity", () => {
    const mixed = row({
      id: "mix",
      items: [
        { product_id: "p1", product_name: "Dumbbell", variant_id: null, variant_label: "5 kg", quantity: 2, image_url: null },
        { product_id: "p2", product_name: "Corde", variant_id: null, variant_label: null, quantity: 1, image_url: null },
        { product_id: "p3", product_name: "Tapis", variant_id: null, variant_label: null, quantity: 3, image_url: null },
      ],
    });
    renderRun([mixed], { initialRoll: "#d80a0a" });
    const lines = screen.getAllByTestId("wh-run-line");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent("Dumbbell");
    expect(lines[0]).toHaveTextContent("2");
    expect(lines[2]).toHaveTextContent("Tapis");
  });

  it("a skipped parcel comes back at the end, once", () => {
    renderRun(undefined, { initialRoll: "#d80a0a" });
    fireEvent.click(screen.getByRole("button", { name: "Passer ce colis" }));
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("فاطمة");
    fireEvent.click(screen.getByRole("button", { name: "Passer ce colis" }));
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("محمد علي");
  });

  it("remembers the batch across a remount, so a locked screen costs nothing", () => {
    const { unmount } = renderRun();
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    fireEvent.click(screen.getAllByTestId("wh-run-bucket")[0]);
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("محمد علي");
    unmount();
    renderRun();
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("محمد علي");
  });

  it("remembers the roll being worked, for a sticker scanned before the parcel", () => {
    renderRun(undefined, { initialRoll: "#339307" });
    // The key Sortir reads for its free-sticker shortlist (BenchHome ROLL_KEY).
    expect(sessionStorage.getItem("wh.bench.roll")).toBe("#339307");
  });
});

describe("a clean bind (R.bound)", () => {
  it("binds the parcel in hand to the typed sticker", async () => {
    const f = respond(200, BOUND);
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/warehouse/scan-out");
    expect(JSON.parse(init.body)).toEqual({ order_id: "r1", sticker_ref: "7700001" });
  });

  it("a gun firing into the focused field binds once, not twice", async () => {
    const f = respond(200, BOUND);
    renderRun(undefined, { initialRoll: "#d80a0a" });
    const input = screen.getByPlaceholderText("ou tapez le numéro du sticker");
    for (const key of "7700001") fireEvent.keyDown(input, { key });
    fireEvent.change(input, { target: { value: "7700001" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByTestId("wh-run-result");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("binds what the camera read, too", async () => {
    renderRun(undefined, { initialRoll: "#d80a0a" });
    expect(camera.active).toBe(true);
    await act(async () => camera.onScan?.("7700001"));
    expect(await screen.findByTestId("wh-run-result")).toHaveAttribute("data-outcome", "bound");
  });

  it("says it bound, shows the number, the parcel and the stock the server moved", async () => {
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    const result = await screen.findByTestId("wh-run-result");
    expect(result).toHaveAttribute("data-outcome", "bound");
    expect(result).toHaveTextContent("Sticker lié");
    expect(result).toHaveTextContent("7700001");
    expect(result).toHaveTextContent("Dumbbell · Tripoli");
    expect(within(result).getByTestId("wh-run-stock")).toHaveTextContent("40 → 39");
  });

  it("states the move the server actually made, not the denormalised quantity", async () => {
    respond(200, {
      ...BOUND,
      movements: [
        { product_id: "p1", change: -3, stock_after: 39 },
        { product_id: "p2", change: -1, stock_after: 7 },
      ],
    });
    renderRun([red1], { initialRoll: "#d80a0a" });
    bind("7700001");
    expect(await screen.findByTestId("wh-run-stock")).toHaveTextContent("42 → 39");
  });

  it("shows the next parcel of the same roll, then moves to it on its own", async () => {
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    expect(screen.getByText("Suivant, même rouleau")).toBeInTheDocument();
    expect(screen.getByTestId("wh-run-next")).toHaveTextContent("فاطمة");
    expect(screen.getByText("passe tout seul")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("فاطمة"), { timeout: 2500 });
    // The bound parcel is counted as done: second of two.
    expect(screen.getByTestId("wh-run-progress")).toHaveTextContent("2 / 2");
  });

  it("« Suivant » does not wait for the ring", async () => {
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("فاطمة");
  });

  it("« Fermer » leaves the run for Sortir", async () => {
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(push).toHaveBeenCalledWith("/fr/warehouse/out");
  });

  it("refreshes the queue once the parcel has left", async () => {
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    expect(mutate).toHaveBeenCalled();
  });

  it("keeps the outcome on screen when the refreshed queue no longer carries the parcel", async () => {
    const view = renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    // The server's next page: the bound parcel has left the bench.
    revalidated.data = { orders: [red2, green] };
    view.rerender(
      <Intl locale="fr">
        <ScanRun market="ly" locale="fr" currency="LYD" initialOrders={[red1, red2, green]} siteName="Tripoli" initialRoll="#d80a0a" />
      </Intl>,
    );
    const result = screen.getByTestId("wh-run-result");
    expect(result).toHaveAttribute("data-outcome", "bound");
    expect(result).toHaveTextContent("7700001");
    expect(result).toHaveTextContent("Dumbbell · Tripoli");
  });
});

describe("outcomes that stop the run", () => {
  it("does not advance on its own when Darb kept a different number", async () => {
    respond(200, { ...BOUND, sticker_bind_state: "restickered", carrier_reference: "1279049" });
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    const result = await screen.findByTestId("wh-run-result");
    expect(result).toHaveAttribute("data-outcome", "bind_unverified");
    expect(screen.getByTestId("wh-run-unverified")).toHaveTextContent("1279049");
    expect(screen.queryByText("passe tout seul")).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1600));
    expect(screen.getByTestId("wh-run-result")).toHaveAttribute("data-outcome", "bind_unverified");
  });

  it("bound at Darb but not committed is amber and says who to tell", async () => {
    respond(409, { error_code: "STOCK_UNDERFLOW", darb_bound: true });
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    const result = await screen.findByTestId("wh-run-result");
    expect(result).toHaveAttribute("data-outcome", "bound_not_committed");
    expect(result).toHaveTextContent(/Prévenez le responsable/);
  });

  it("keeps a refusal on screen with a way out", async () => {
    respond(422, { error_code: "STICKER_ALREADY_USED", message: "déjà lié" });
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    const result = await screen.findByTestId("wh-run-result");
    expect(result).toHaveAttribute("data-outcome", "refused_here");
    expect(result).toHaveTextContent("Ce sticker est déjà lié à un autre colis.");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(screen.getByPlaceholderText("ou tapez le numéro du sticker")).toBeInTheDocument();
  });

  it("refuses a payload that is not a sticker number before touching the network", async () => {
    const f = respond(200, BOUND);
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("https://darb.ly/x");
    expect(await screen.findByTestId("wh-run-result")).toHaveAttribute("data-outcome", "refused_here");
    expect(f).not.toHaveBeenCalled();
  });

  it("names the other building and does not let the parcel be scanned here (R.wrongsite)", async () => {
    respond(403, { error_code: "WRONG_SITE", warehouse_name: "Benghazi", message: "Scan refusé" });
    renderRun(undefined, { initialRoll: "#d80a0a" });
    bind("7700001");
    const result = await screen.findByTestId("wh-run-result");
    expect(result).toHaveAttribute("data-outcome", "wrong_site");
    expect(result).toHaveTextContent("Ne le scannez pas ici");
    expect(result).toHaveTextContent("Ce colis part de l'entrepôt de Benghazi.");
    fireEvent.click(screen.getByRole("button", { name: "Compris" }));
    // Set aside: the next parcel comes up.
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("فاطمة");
  });

  it("never hands the other building's parcel back, even when the rest are set aside", async () => {
    respond(403, { error_code: "WRONG_SITE", warehouse_name: "Benghazi", message: "Scan refusé" });
    const red3 = row({ id: "r3", customer_name: "سالم", product_id: "p1", product_name: "Dumbbell" });
    renderRun([red1, red2, red3], { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    fireEvent.click(screen.getByRole("button", { name: "Compris" }));
    fireEvent.click(screen.getByRole("button", { name: "Passer ce colis" }));
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("سالم");
    fireEvent.click(screen.getByRole("button", { name: "Passer ce colis" }));
    // The skipped one comes back — the Benghazi parcel does not.
    expect(screen.getByTestId("wh-run-parcel")).toHaveTextContent("فاطمة");
  });
});

describe("finishing a batch", () => {
  it("reports what the batch cost and what still needs a human", async () => {
    renderRun([red1], { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    expect(screen.getByText("C'était le dernier colis de ce lot.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    const summary = await screen.findByTestId("wh-run-summary");
    expect(summary).toHaveTextContent("Lot terminé");
    expect(summary).toHaveTextContent("1");
  });

  it("names the parcels that never left, so they are not forgotten", async () => {
    respond(422, { error_code: "STICKER_ALREADY_USED", message: "déjà lié" });
    renderRun([red1], { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    fireEvent.click(screen.getByRole("button", { name: "Passer ce colis" }));
    const summary = await screen.findByTestId("wh-run-summary");
    expect(summary).toHaveTextContent("محمد علي");
    expect(summary).toHaveTextContent(/déjà lié/);
  });

  it("stops calling a parcel refused once a retry binds it", async () => {
    respond(422, { error_code: "STICKER_ALREADY_USED", message: "déjà lié" });
    renderRun([red1], { initialRoll: "#d80a0a" });
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    respond(200, BOUND);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    bind("7700001");
    await waitFor(() => expect(screen.getByTestId("wh-run-result")).toHaveAttribute("data-outcome", "bound"));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    const summary = await screen.findByTestId("wh-run-summary");
    expect(summary).not.toHaveTextContent(/déjà lié/);
  });

  it("offers the next batch rather than dumping the agent back at the start", async () => {
    renderRun([red1, red2, green]);
    fireEvent.click(screen.getByRole("button", { name: /Même produit/ }));
    const corde = screen.getAllByTestId("wh-run-bucket").find((b) => b.textContent?.includes("Corde"))!;
    fireEvent.click(corde);
    bind("7700001");
    await screen.findByTestId("wh-run-result");
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByTestId("wh-run-summary");
    expect(screen.getByRole("button", { name: /Lot suivant/ })).toHaveTextContent("Dumbbell");
  });

  it("hands a set-aside parcel back once, then ends the batch rather than looping it", () => {
    renderRun([red1, red2], { initialRoll: "#d80a0a" });
    for (let i = 0; i < 6; i += 1) {
      const again = screen.queryByRole("button", { name: "Passer ce colis" });
      if (!again) break;
      fireEvent.click(again);
    }
    expect(screen.getByTestId("wh-run-summary")).toHaveTextContent("2 colis passés");
  });
});

describe("Arabic", () => {
  it("speaks the prototype's words", () => {
    renderRun(undefined, { initialRoll: "#339307" }, "ar");
    expect(screen.getByTestId("wh-run-band")).toHaveTextContent("رولة أخضر");
    expect(screen.getByText("في يدك")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("أو اكتب رقم الملصق")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ربط" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تخطَّ هذا الطرد" })).toBeInTheDocument();
  });
});
