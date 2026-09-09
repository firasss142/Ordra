import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { BenchHome } from "../BenchHome";
import { Intl, row, GREEN, RED, UNKNOWN } from "./fixtures";

/**
 * The bench, the agent's home.
 *
 * Answers "what do I do now": how many parcels wait, which rolls to pick up,
 * which parcel next. The KPI wall that used to be here answered "how did the
 * warehouse perform", which is the manager's question.
 */

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
  usePathname: () => "/ar/warehouse",
}));

const mutate = vi.fn();
vi.mock("swr", () => ({
  default: (_key: string, _f: unknown, opts?: { fallbackData?: unknown }) => ({
    data: opts?.fallbackData,
    error: undefined,
    isLoading: false,
    mutate,
  }),
}));

vi.mock("@/components/warehouse/QrScanner", () => ({
  QrScanner: ({ onScan }: { onScan: (v: string) => void }) => (
    <button type="button" data-testid="qr-scanner" onClick={() => onScan("7700001")} />
  ),
}));

const stats = { toPrepare: 3, oldestHours: 13 * 24, scannedToday: 0, toHandOver: 3, carrierWarehouse: 4 };

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }));
}

const red1 = row({ id: "aaaaaaaa-0000-4000-8000-000000000001", customer_name: "محمد علي" });
const red2 = row({ id: "aaaaaaaa-0000-4000-8000-000000000002", customer_name: "فاطمة الورفلي" });
const green = row({ id: "aaaaaaaa-0000-4000-8000-000000000003", customer_name: "سعاد المبروك", customer_city: "بنغازي", zone: GREEN });

function renderHome(orders = [red1, green, red2], market: "ly" | "tn" = "ly", locale: "ar" | "fr" = "ar") {
  return render(
    <Intl locale={locale}>
      <BenchHome market={market} locale={locale} currency="LYD" initialOrders={orders} initialStats={stats} />
    </Intl>,
  );
}

beforeEach(() => {
  search = "";
  replace.mockClear();
  mutate.mockClear();
  sessionStorage.clear();
  respond(200, { stock_after: 574 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("BenchHome — what waits, by roll", () => {
  it("leads with the count and the oldest age, not a goal", () => {
    renderHome();
    const hero = screen.getByTestId("wh-bench-hero");
    expect(hero).toHaveTextContent("3");
    expect(hero).toHaveTextContent("طرود بانتظار المسح");
    expect(hero).toHaveTextContent("الأقدم منذ 13 ي");
    expect(screen.queryByText(/الهدف/)).toBeNull();
  });

  it("groups parcels under their roll, poster order, with the branch code on a plate", () => {
    renderHome();
    const groups = screen.getAllByTestId("wh-bench-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAttribute("data-roll", "#d80a0a");
    expect(within(groups[0]).getByText("أحمر")).toBeInTheDocument();
    expect(within(groups[0]).getByTestId("wh-bench-plate")).toHaveTextContent("TR");
    expect(within(groups[0]).getAllByTestId("wh-bench-card")).toHaveLength(2);
    expect(groups[1]).toHaveAttribute("data-roll", "#339307");
  });

  it("counts per roll on the rail and filters the list on tap", () => {
    renderHome();
    const rolls = screen.getAllByTestId("wh-roll");
    const green = rolls.find((r) => r.getAttribute("data-key") === "#339307")!;
    expect(green).toHaveTextContent("1");
    fireEvent.click(green);
    expect(screen.getAllByTestId("wh-bench-group")).toHaveLength(1);
    expect(screen.getAllByTestId("wh-bench-card")).toHaveLength(1);
    expect(screen.getByText("سعاد المبروك")).toBeInTheDocument();
  });

  it("puts unknown-zone parcels last, under their own header", () => {
    renderHome([green, row({ id: "aaaaaaaa-0000-4000-8000-000000000009", zone: UNKNOWN })]);
    const groups = screen.getAllByTestId("wh-bench-group");
    expect(groups.at(-1)).toHaveAttribute("data-roll", "");
    expect(within(groups.at(-1)!).getByText("غير معروف")).toBeInTheDocument();
  });

  it("explains an empty bench with the carrier-warehouse flow, and no fake goal", () => {
    renderHome([]);
    expect(screen.getByTestId("wh-bench-hero")).toHaveTextContent("لا طرود للمسح");
    expect(screen.getByTestId("wh-bench-carrier-warehouse")).toHaveTextContent("4");
    expect(screen.queryByTestId("wh-roll-rail")).toBeNull();
  });

  it("names how many scanned parcels wait for pickup", () => {
    renderHome();
    expect(screen.getByTestId("wh-bench-pickup")).toHaveTextContent("3");
  });

  it("has no rail and no colour bars for Tunisia", () => {
    renderHome([row({ zone: UNKNOWN })], "tn", "fr");
    expect(screen.queryByTestId("wh-roll-rail")).toBeNull();
    expect(screen.queryByTestId("wh-bench-group")).toBeNull();
    expect(screen.getByTestId("wh-bench-card")).toHaveAttribute("data-roll", "");
  });
});

/**
 * Take a parcel and step through the photo confirmation.
 *
 * The sheet opens on "is this the parcel?" — the only check available without a
 * printer or a barcode — so every test about scanning starts on the far side
 * of it, exactly as the agent does.
 */
function take(name: string) {
  fireEvent.click(
    within(screen.getByText(name).closest("article")!).getByRole("button", { name: "خذ الطرد" }),
  );
  const yes = screen.queryByTestId("wh-parcel-confirm-yes");
  if (yes) fireEvent.click(yes);
  return screen.getByRole("dialog");
}

describe("BenchHome — take, scan, next", () => {
  it("taking a parcel opens the sheet carrying the parcel and its roll", () => {
    renderHome();
    const sheet = take("محمد علي");
    expect(sheet).toHaveTextContent("في يدك:");
    expect(sheet).toHaveTextContent("محمد علي");
    const band = within(sheet).getByTestId("wh-sheet-band");
    expect(band).toHaveAttribute("data-roll", "#d80a0a");
    expect(band).toHaveTextContent("أحمر");
    expect(band).toHaveTextContent("TR");
    expect(within(sheet).getByText(RED.nameAr!)).toBeInTheDocument();
    expect(screen.getByText("محمد علي").closest("article")).toHaveAttribute("data-held", "true");
  });

  it("a bound sticker removes the parcel, counts the scan, and offers the next of the same roll", async () => {
    renderHome();
    const sheet = take("محمد علي");
    const input = within(sheet).getByLabelText("رقم الملصق");
    fireEvent.change(input, { target: { value: "7700001" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "ربط الملصق" }));

    await waitFor(() => expect(within(sheet).getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "bound"));
    expect(within(sheet).getByTestId("wh-sheet-result")).toHaveTextContent("7700001");
    expect(within(sheet).getByTestId("wh-sheet-result")).toHaveTextContent("575 ← 574");
    expect(mutate).toHaveBeenCalled();
    expect(screen.getByTestId("wh-bench-scanned")).toHaveTextContent("1");
    expect(screen.queryByText("محمد علي")).toBeNull();

    // Same roll first: the red roll is still in the agent's hand.
    const next = within(sheet).getByRole("button", { name: /التالي من نفس الرولة/ });
    expect(next).toHaveTextContent("فاطمة الورفلي");
    fireEvent.click(next);
    expect(screen.getByRole("dialog")).toHaveTextContent("فاطمة الورفلي");
    expect(within(screen.getByRole("dialog")).queryByTestId("wh-sheet-result")).toBeNull();
  });

  it("the scan flag opens the sheet with nothing in hand, in lookup mode", () => {
    search = "scan=1";
    renderHome();
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent("لا طرد في يدك");
    expect(within(sheet).getByRole("button", { name: "ابحث عن الملصق" })).toBeInTheDocument();
  });

  it("closing the sheet drops the scan flag from the address", () => {
    search = "scan=1";
    renderHome();
    fireEvent.click(screen.getByTestId("wh-sheet-scrim"));
    expect(replace).toHaveBeenCalledWith("/ar/warehouse");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("remembers the parcel in hand across a reload", () => {
    const { unmount } = renderHome();
    fireEvent.click(within(screen.getByText("محمد علي").closest("article")!).getByRole("button", { name: "خذ الطرد" }));
    unmount();
    renderHome();
    expect(screen.getByText("محمد علي").closest("article")).toHaveAttribute("data-held", "true");
  });
});

/**
 * Which building the agent is standing in.
 *
 * The coloured plate on every card shows `toBranchGroup` — the DESTINATION
 * branch, not the account the parcel was booked on. Two parcels bound for Sebha
 * look identical whether they came from the Tripoli or the Benghazi account, so
 * nothing on screen distinguished the two buildings. Naming the site once, at
 * the top, is what makes the bench say where it belongs.
 */
describe("BenchHome — the building", () => {
  it("names the building the bench belongs to", () => {
    render(
      <Intl locale="ar">
        <BenchHome
          market="ly"
          locale="ar"
          currency="LYD"
          initialOrders={[red1]}
          initialStats={stats}
          siteName="بنغازي"
        />
      </Intl>,
    );
    expect(screen.getByTestId("wh-bench-site")).toHaveTextContent("بنغازي");
  });

  it("says nothing when the market has no second building to confuse it with", () => {
    render(
      <Intl locale="fr">
        <BenchHome
          market="tn"
          locale="fr"
          currency="TND"
          initialOrders={[red1]}
          initialStats={stats}
        />
      </Intl>,
    );
    expect(screen.queryByTestId("wh-bench-site")).not.toBeInTheDocument();
  });

  /*
   * The empty bench that explains itself. An unassigned agent is now shown
   * nothing at all — without this the screen looks broken and the agent goes
   * looking for parcels that were never theirs.
   */
  it("an unassigned agent is told to see their manager, not shown an empty bench", () => {
    render(
      <Intl locale="fr">
        <BenchHome
          market="ly"
          locale="fr"
          currency="LYD"
          initialOrders={[]}
          initialStats={{ ...stats, toPrepare: 0 }}
          siteUnassigned
        />
      </Intl>,
    );
    expect(screen.getByTestId("wh-bench-no-site")).toBeInTheDocument();
  });

  it("an unassigned agent gets no scan affordance at all", () => {
    render(
      <Intl locale="fr">
        <BenchHome
          market="ly"
          locale="fr"
          currency="LYD"
          initialOrders={[]}
          initialStats={{ ...stats, toPrepare: 0 }}
          siteUnassigned
        />
      </Intl>,
    );
    // Offering a camera to someone whose every scan will be refused is a trap.
    expect(screen.queryByTestId("wh-bench-hero")).not.toBeInTheDocument();
  });
});

/**
 * The Scannés tab has to grow the moment a parcel leaves the bench.
 *
 * "À préparer" already drops optimistically, but the Scannés count came only
 * from a separate summary fetch — so for a second or two the parcel was in
 * neither number. That gap is what made agents doubt the scan and re-scan,
 * which is how a parcel hit Darb's duplicate-key refusal and got stranded.
 */
describe("BenchHome — the parcel arrives in Scannés immediately", () => {
  it("moves the count from waiting to handed-over on a scan", async () => {
    renderHome();
    // Before: three waiting, three ready for pickup.
    expect(screen.getByTestId("wh-bench-hero")).toHaveTextContent("3");

    const sheet = take("محمد علي");
    fireEvent.change(within(sheet).getByLabelText("رقم الملصق"), {
      target: { value: "889201" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "ربط الملصق" }));

    await waitFor(() =>
      expect(screen.getByTestId("wh-bench-hero")).toHaveTextContent("2"),
    );
    // The parcel is not in limbo: the Scannés segment counts it right away.
    const scanned = screen.getByRole("tab", { name: /تم مسحها/ });
    await waitFor(() => expect(scanned).toHaveTextContent("4"));
  });
});
