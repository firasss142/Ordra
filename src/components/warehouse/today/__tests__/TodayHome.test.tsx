import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import { assembleDayLoop, type DayLoopRows } from "@/lib/warehouse/day-loop-assemble";
import { TodayHome } from "../TodayHome";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/**
 * The warehouse agent's home: four jobs in the order of a day, each the only
 * door to its work, each carrying one number. Built from the same assembly the
 * route returns, so the screen is tested against real payloads, not stubs.
 * The copy is the approved prototype's (entrepot-day-loop-agent-v3.html, R.today).
 */

function rows(over: Partial<DayLoopRows> = {}): DayLoopRows {
  return {
    warehouses: [{ id: "B", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي" }],
    queueBySite: { B: { to_prepare: 31, oldest_prepare_hours: 70, returns_inbox: 2, set_aside: 42 } },
    marketQueue: { to_prepare: 31 },
    returning: [{ warehouse_id: "B" }, { warehouse_id: "B" }, { warehouse_id: "B" }],
    receptions: [],
    productIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
    countRows: [],
    agents: [{ id: "a", full_name: "adel", warehouse_id: "B" }],
    leaderboard: [{ actor_id: "a", scanned: 14, last_scan_at: null }],
    marketScannedToday: 14,
    goal: null,
    ...over,
  };
}

function payload(over: Partial<DayLoopRows> = {}, locale = "fr") {
  return {
    ...assembleDayLoop(rows(over), { focus: "B", today: "2026-10-02", locale, withManagerViews: false }),
    siteUnassigned: false as const,
    sitePinned: true,
  };
}

function renderHome(data: Parameters<typeof TodayHome>[0]["data"], locale: "fr" | "ar" = "fr") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? arMessages : frMessages}>
      <TodayHome data={data} locale={locale} dateLabel="jeudi 2 octobre" initial="A" />
    </NextIntlClientProvider>,
  );
}

const job = (k: string) => screen.getAllByRole("link").find((a) => a.getAttribute("data-job") === k)!;

afterEach(cleanup);

describe("TodayHome", () => {
  it("shows the four jobs in the order of a day, each a link to its work", () => {
    renderHome(payload());
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("data-job"));
    expect(links.map((a) => [a.getAttribute("data-job"), a.getAttribute("href")])).toEqual([
      ["out", "/fr/warehouse/out"],
      ["returns", "/fr/warehouse/returns"],
      ["receive", "/fr/warehouse/stock?tab=receptions"],
      ["count", "/fr/warehouse/count"],
    ]);
  });

  it("gives each job its backlog as the one figure", () => {
    renderHome(payload());
    expect(within(job("out")).getByTestId("today-figure")).toHaveTextContent("31");
    expect(within(job("returns")).getByTestId("today-figure")).toHaveTextContent("2");
    expect(within(job("receive")).getByTestId("today-figure")).toHaveTextContent("0");
    expect(within(job("count")).getByTestId("today-figure")).toHaveTextContent("7");
  });

  it("names the oldest parcel in rounded days: 70 h is « 3 j »", () => {
    renderHome(payload());
    expect(within(job("out")).getByText("à scanner · le plus ancien depuis 3 j")).toBeInTheDocument();
  });

  it("fills the bar to today's share — 14 of 45 is 31 %, not a full bar", () => {
    renderHome(payload());
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "31");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("31%");
    // The fraction is a number pair: it must not mirror into « 45 / 14 » in Arabic.
    const fraction = screen.getByText("14 / 45");
    expect(fraction).toHaveAttribute("dir", "ltr");
  });

  it("draws an empty bar on a day with nothing scanned and nothing waiting", () => {
    renderHome(payload({ queueBySite: { B: {} }, leaderboard: [] }));
    expect((screen.getByRole("progressbar").firstElementChild as HTMLElement).style.width).toBe("0%");
  });

  it("says what is waiting at Darb and what is still on the way", () => {
    renderHome(payload());
    expect(within(job("returns")).getByText("chez Darb pour nous · et 3 en route")).toBeInTheDocument();
  });

  it("names the agent's building when no delivery is announced", () => {
    renderHome(payload());
    expect(job("receive")).toHaveAttribute("data-state", "idle");
    expect(within(job("receive")).getByText("aucune livraison annoncée pour Benghazi")).toBeInTheDocument();
  });

  it("says that nothing has ever been counted, with the warning chip", () => {
    renderHome(payload());
    expect(within(job("count")).getByText("produits jamais comptés")).toBeInTheDocument();
    expect(within(job("count")).getByText("jamais compté")).toBeInTheDocument();
  });

  it("carries each job's own hue", () => {
    renderHome(payload());
    expect(job("out").className).toContain("job-out");
    expect(job("returns").className).toContain("job-returns");
    expect(job("receive").className).toContain("job-receive");
    expect(job("count").className).toContain("job-count");
  });

  it("names the building and opens the settings from the agent's initial", () => {
    renderHome(payload());
    expect(screen.getByText("Benghazi · jeudi 2 octobre")).toBeInTheDocument();
    const avatar = screen.getByRole("link", { name: "Réglages" });
    expect(avatar).toHaveAttribute("href", "/fr/warehouse/settings");
    expect(avatar).toHaveTextContent("A");
  });

  it("links the stock strip to the stock screen and says where its figures come from", () => {
    renderHome(payload());
    const strip = screen.getByRole("link", { name: /Stock/ });
    expect(strip).toHaveAttribute("href", "/fr/warehouse/stock");
    expect(within(strip).getByText("7 produits · tous les chiffres viennent du registre")).toBeInTheDocument();
  });

  it("drops « from the register » once a product of this building has been counted", () => {
    renderHome(payload({ countRows: [{ product_id: "p1", warehouse_id: "B" }] }));
    expect(within(screen.getByRole("link", { name: /Stock/ })).getByText("7 produits")).toBeInTheDocument();
  });

  it("puts the driver strip between the title and the jobs", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <TodayHome data={payload()} locale="fr" dateLabel="jeudi 2 octobre" initial="A" pickup={<p>driver</p>} />
      </NextIntlClientProvider>,
    );
    const driver = screen.getByText("driver");
    expect(driver.compareDocumentPosition(job("out")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains an unassigned agent instead of showing an empty day", () => {
    renderHome({ siteUnassigned: true });
    expect(screen.getByText(frMessages.warehouse.bench.noSiteTitle)).toBeInTheDocument();
    expect(screen.queryAllByRole("link").filter((a) => a.getAttribute("data-job"))).toHaveLength(0);
  });

  it("reads in Arabic, with the prototype's wording", () => {
    renderHome(payload({}, "ar"), "ar");
    expect(screen.getByText("اليوم")).toBeInTheDocument();
    expect(screen.getByText("بانتظار المسح · الأقدم منذ 3 أيام")).toBeInTheDocument();
    expect(screen.getByText("لا توريد مُعلن لبنغازي")).toBeInTheDocument();
    expect(screen.getByText("منتجات لم تُجرد أبداً")).toBeInTheDocument();
    expect(screen.getByText("7 منتجات · كل الأرقام من السجل")).toBeInTheDocument();
  });
});
