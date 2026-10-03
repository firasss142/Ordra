import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { BenchHome } from "../BenchHome";
import { Intl, row, GREEN, RED, UNKNOWN } from "./fixtures";

/**
 * « Sortir », as the v3 prototype draws it (`R.out`): the building and the
 * date, the driver strip, two soft tabs, ONE card with a row per sticker roll
 * in Darb's order — the first roll open on its first three parcels — and the
 * parcels older than ten days folded at the bottom.
 *
 * The rolls are the action: « Commencer » opens the scan run on that roll, a
 * parcel opens the run on that parcel. Nothing on this screen binds a sticker
 * itself except the lookup sheet's « sticker libre ».
 */

let search = "";
const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push }),
  usePathname: () => "/ar/warehouse/out",
}));

const mutate = vi.fn();
let today: unknown = { siteUnassigned: false, counts: { setAside: 11 }, scannedToday: 14 };
vi.mock("swr", () => ({
  default: (key: string, _f: unknown, opts?: { fallbackData?: unknown }) => ({
    data: key === "/api/warehouse/today" ? today : opts?.fallbackData,
    error: undefined,
    isLoading: false,
    mutate,
  }),
  useSWRConfig: () => ({ mutate }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/components/warehouse/pickup/PickupSwitch", () => ({
  PickupSwitch: () => <div data-testid="wh-pickup-switch" />,
}));

const stats = { toPrepare: 3, oldestHours: 13 * 24, scannedToday: 0, toHandOver: 3, carrierWarehouse: 4 };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Answers each endpoint the way the server would. */
function serve(routes: Record<string, { status?: number; body: unknown }>) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    const { status = 200, body } = hit ? hit[1] : { body: {} };
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const red1 = row({ id: "aaaaaaaa-0000-4000-8000-000000000001", customer_name: "محمد علي", customer_city: "طرابلس", uploaded_at: hoursAgo(70) });
const red2 = row({ id: "aaaaaaaa-0000-4000-8000-000000000002", customer_name: "فاطمة الورفلي", customer_city: "تاجوراء", uploaded_at: hoursAgo(2) });
const green = row({ id: "aaaaaaaa-0000-4000-8000-000000000003", customer_name: "سعاد المبروك", customer_city: "بنغازي", zone: GREEN });

function renderHome(
  orders = [green, red1, red2],
  market: "ly" | "tn" = "ly",
  locale: "ar" | "fr" = "ar",
  extra: { siteName?: string } = { siteName: "بنغازي" },
) {
  return render(
    <Intl locale={locale}>
      <BenchHome market={market} locale={locale} currency="LYD" initialOrders={orders} initialStats={stats} {...extra} />
    </Intl>,
  );
}

beforeEach(() => {
  search = "";
  today = { siteUnassigned: false, counts: { setAside: 11 }, scannedToday: 14 };
  replace.mockClear();
  push.mockClear();
  mutate.mockClear();
  sessionStorage.clear();
  serve({});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Sortir — the header", () => {
  it("is « Sortir », under the building and the day", () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("إخراج");
    const eyebrow = screen.getByTestId("wh-out-eyebrow");
    expect(eyebrow.textContent).toMatch(/^بنغازي · /);
  });

  it("wears the Sortir hue", () => {
    const { container } = renderHome();
    expect(container.querySelector(".job-out")).not.toBeNull();
  });

  it("carries the driver strip in Libya, not in Tunisia", () => {
    renderHome();
    expect(screen.getByTestId("wh-pickup-switch")).toBeInTheDocument();
    cleanup();
    renderHome([row({ zone: UNKNOWN })], "tn", "fr", {});
    expect(screen.queryByTestId("wh-pickup-switch")).toBeNull();
  });

  it("has no hero, no roll rail, no per-parcel price and no « take the parcel »", () => {
    renderHome();
    expect(screen.queryByTestId("wh-bench-hero")).toBeNull();
    expect(screen.queryByTestId("wh-roll-rail")).toBeNull();
    expect(screen.queryByText("خذ الطرد")).toBeNull();
    expect(screen.queryByText(/249/)).toBeNull();
  });
});

describe("Sortir — the two tabs", () => {
  it("counts what waits and what left today", () => {
    renderHome();
    const [toScan, out] = screen.getAllByRole("tab");
    expect(toScan).toHaveTextContent("للمسح");
    expect(toScan).toHaveTextContent("3");
    expect(toScan).toHaveAttribute("aria-selected", "true");
    expect(out).toHaveTextContent("مُسحت اليوم");
    expect(out).toHaveTextContent("14");
  });

  it("the second tab is the scanned list", () => {
    renderHome();
    fireEvent.click(screen.getByRole("tab", { name: /مُسحت اليوم/ }));
    expect(screen.getByRole("tab", { name: /مُسحت اليوم/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryAllByTestId("wh-roll-row")).toHaveLength(0);
  });
});

describe("Sortir — one card, a row per roll", () => {
  it("lists the rolls in Darb's order with colour, zone and count", () => {
    renderHome();
    const rolls = screen.getAllByTestId("wh-roll-row");
    expect(rolls.map((r) => r.getAttribute("data-roll"))).toEqual(["#d80a0a", "#339307"]);
    expect(rolls[0]).toHaveTextContent("رولة أحمر");
    expect(rolls[0]).toHaveTextContent(RED.nameAr!);
    expect(within(rolls[0]).getByTestId("wh-roll-count")).toHaveTextContent("2");
    expect(within(rolls[1]).getByTestId("wh-roll-count")).toHaveTextContent("1");
  });

  it("« Commencer » opens the scan run on that roll", () => {
    renderHome();
    const [red] = screen.getAllByTestId("wh-roll-row");
    expect(within(red).getByRole("link", { name: "ابدأ" })).toHaveAttribute(
      "href",
      "/ar/warehouse/scan?roll=%23d80a0a",
    );
  });

  it("opens the first roll on its parcels: product first, then city and first name", () => {
    renderHome();
    const parcels = screen.getAllByTestId("wh-out-parcel");
    expect(parcels).toHaveLength(2);
    expect(parcels[0]).toHaveTextContent("دمية ملاكمة حجم كبير ×1");
    expect(parcels[0]).toHaveTextContent("طرابلس · محمد");
    expect(parcels[0]).not.toHaveTextContent("علي");
  });

  it("a parcel opens the run on THAT parcel", () => {
    renderHome();
    const [first] = screen.getAllByTestId("wh-out-parcel");
    expect(first).toHaveAttribute(
      "href",
      `/ar/warehouse/scan?roll=%23d80a0a&order=${red1.id}`,
    );
  });

  it("an age past 48 hours is a warning chip, a fresh one is plain", () => {
    renderHome();
    const [old, fresh] = screen.getAllByTestId("wh-out-parcel");
    expect(within(old).getByTestId("wh-out-age")).toHaveAttribute("data-tone", "warn");
    expect(within(old).getByTestId("wh-out-age")).toHaveTextContent("منذ 3 ي");
    expect(within(fresh).getByTestId("wh-out-age")).toHaveAttribute("data-tone", "mute");
    expect(within(fresh).getByTestId("wh-out-age")).toHaveTextContent("منذ 2 س");
  });

  it("folds past three parcels and opens the rest on tap", () => {
    const reds = Array.from({ length: 5 }, (_, i) =>
      row({ id: `bbbbbbbb-0000-4000-8000-00000000000${i}`, customer_name: `زبون${i} لقب` }),
    );
    renderHome(reds);
    expect(screen.getAllByTestId("wh-out-parcel")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /وطردان آخران/ }));
    expect(screen.getAllByTestId("wh-out-parcel")).toHaveLength(5);
  });

  it("tapping another roll toggles its parcels", () => {
    renderHome();
    const [, greenRoll] = screen.getAllByTestId("wh-roll-row");
    const toggle = within(greenRoll).getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("wh-out-parcel")).toHaveLength(3);
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("wh-out-parcel")).toHaveLength(2);
  });

  it("puts parcels of unknown colour last, with no run to start", () => {
    renderHome([green, row({ id: "aaaaaaaa-0000-4000-8000-000000000009", zone: UNKNOWN })]);
    const rolls = screen.getAllByTestId("wh-roll-row");
    const last = rolls.at(-1)!;
    expect(last).toHaveAttribute("data-roll", "");
    expect(last).toHaveTextContent("غير معروف");
    expect(within(last).queryByRole("link")).toBeNull();
  });

  it("Tunisia has no rolls: one card of parcels, each opening the run", () => {
    const tn = row({ id: "cccccccc-0000-4000-8000-000000000001", zone: UNKNOWN });
    renderHome([tn], "tn", "fr", {});
    expect(screen.queryAllByTestId("wh-roll-row")).toHaveLength(0);
    expect(screen.getByTestId("wh-out-parcel")).toHaveAttribute("href", `/fr/warehouse/scan?order=${tn.id}`);
  });

  it("says so when nothing waits", () => {
    renderHome([]);
    expect(screen.getByText("لا شيء للمسح الآن.")).toBeInTheDocument();
  });
});

describe("Sortir — the parcels older than ten days", () => {
  it("folds them at the bottom with the building's count, still scannable", () => {
    renderHome();
    const fold = screen.getByTestId("wh-out-older");
    expect(fold).toHaveTextContent("أقدم من 10 أيام · 11");
    expect(fold).toHaveTextContent("تبقى قابلة للمسح");
    fireEvent.click(fold);
    expect(screen.getByText(/لم تعد في القائمة/)).toBeInTheDocument();
  });

  it("is absent when none are set aside", () => {
    today = { siteUnassigned: false, counts: { setAside: 0 }, scannedToday: 0 };
    renderHome();
    expect(screen.queryByTestId("wh-out-older")).toBeNull();
  });
});

describe("Sortir — the lookup sheet", () => {
  it("the scan flag opens it with nothing in hand", () => {
    search = "scan=1";
    renderHome();
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent("امسح أي ملصق");
  });

  it("closing it drops the scan flag from the address", () => {
    search = "scan=1";
    renderHome();
    fireEvent.click(screen.getByTestId("wh-sheet-scrim"));
    expect(replace).toHaveBeenCalledWith("/ar/warehouse/out");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /*
   * The parcel has to leave « À scanner » and arrive in « Sortis aujourd'hui »
   * the moment the bind lands. For a second or two it used to be in neither
   * number, and re-scanning to check is what hit Darb's duplicate-key refusal.
   */
  it("a free sticker bound to a parcel moves it out of the bench at once", async () => {
    search = "scan=1";
    const fetchMock = serve({
      "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } },
      "/api/warehouse/scan-out": { body: { stock_after: 574 } },
    });
    renderHome();
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("رقم الملصق"), { target: { value: "1213140" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "مسح" }));
    fireEvent.click(await within(sheet).findByRole("button", { name: "نعم، هذا هو الطرد — اربط" }));

    await waitFor(() => expect(within(sheet).getByTestId("wh-sheet-result")).toHaveAttribute("data-outcome", "bound"));
    const bind = fetchMock.mock.calls.find(([url]) => String(url) === "/api/warehouse/scan-out")!;
    expect(JSON.parse((bind[1] as RequestInit).body as string)).toEqual({ order_id: red1.id, sticker_ref: "1213140" });

    expect(screen.getByRole("tab", { name: /للمسح/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /مُسحت اليوم/ })).toHaveTextContent("15");
    const left = screen.getAllByTestId("wh-out-parcel");
    expect(left).toHaveLength(1);
    expect(left[0]).toHaveTextContent("تاجوراء · فاطمة");
    expect(mutate).toHaveBeenCalled();
  });
});

describe("Sortir — the roll in hand", () => {
  it("« Commencer » remembers the roll, under the key the run writes too", () => {
    renderHome();
    const [, greenRoll] = screen.getAllByTestId("wh-roll-row");
    fireEvent.click(within(greenRoll).getByRole("link", { name: "ابدأ" }));
    expect(sessionStorage.getItem("wh.bench.roll")).toBe("#339307");
  });

  it("a free sticker offers the parcels of the roll last worked", async () => {
    sessionStorage.setItem("wh.bench.roll", "#339307");
    search = "scan=1";
    serve({ "/api/warehouse/returns/lookup": { body: { outcome: "not_found" } } });
    renderHome();
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("رقم الملصق"), { target: { value: "1213140" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "مسح" }));
    const free = await within(sheet).findByTestId("wh-sheet-free");
    expect(free).toHaveTextContent("الطرود التالية من رولة أخضر");
    expect(within(free).getAllByRole("radio")).toHaveLength(1);
  });
});

describe("Sortir — no building", () => {
  it("an unassigned agent is told to see their manager, with nothing to scan", () => {
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
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryAllByTestId("wh-roll-row")).toHaveLength(0);
  });
});
