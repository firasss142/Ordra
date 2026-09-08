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

describe("BenchHome — take, scan, next", () => {
  it("taking a parcel opens the sheet carrying the parcel and its roll", () => {
    renderHome();
    fireEvent.click(within(screen.getByText("محمد علي").closest("article")!).getByRole("button", { name: "خذ الطرد" }));
    const sheet = screen.getByRole("dialog");
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
    fireEvent.click(within(screen.getByText("محمد علي").closest("article")!).getByRole("button", { name: "خذ الطرد" }));
    const sheet = screen.getByRole("dialog");
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
