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
    goal: 45,
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
      <TodayHome data={data} locale={locale} dateLabel="jeudi 2 octobre" />
    </NextIntlClientProvider>,
  );
}

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
    const job = (k: string) => screen.getAllByRole("link").find((a) => a.getAttribute("data-job") === k)!;
    expect(within(job("out")).getByTestId("today-figure")).toHaveTextContent("31");
    expect(within(job("returns")).getByTestId("today-figure")).toHaveTextContent("2");
    expect(within(job("receive")).getByTestId("today-figure")).toHaveTextContent("0");
    expect(within(job("count")).getByTestId("today-figure")).toHaveTextContent("7");
  });

  it("names the oldest parcel and today's progress against the market goal", () => {
    renderHome(payload());
    expect(screen.getByText("le plus ancien depuis 2 j")).toBeInTheDocument();
    expect(screen.getByText("objectif 45")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "31");
  });

  it("says that nothing has ever been counted, rather than showing a quiet 7", () => {
    renderHome(payload());
    expect(screen.getByText("aucun produit n'a encore été compté")).toBeInTheDocument();
  });

  it("reads as calm when a job has nothing waiting", () => {
    renderHome(payload());
    const receive = screen.getAllByRole("link").find((a) => a.getAttribute("data-job") === "receive")!;
    expect(receive).toHaveAttribute("data-state", "idle");
    expect(within(receive).getByText("aucune livraison annoncée")).toBeInTheDocument();
  });

  it("carries each job's own hue", () => {
    renderHome(payload());
    const job = (k: string) => screen.getAllByRole("link").find((a) => a.getAttribute("data-job") === k)!;
    expect(job("out").className).toContain("job-out");
    expect(job("returns").className).toContain("job-returns");
    expect(job("receive").className).toContain("job-receive");
    expect(job("count").className).toContain("job-count");
  });

  it("names the building and opens the settings from the avatar", () => {
    renderHome(payload());
    expect(screen.getByText(/Benghazi · jeudi 2 octobre/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Réglages" })).toHaveAttribute("href", "/fr/warehouse/settings");
  });

  it("links the stock strip to the stock screen", () => {
    renderHome(payload());
    expect(screen.getByRole("link", { name: /Stock/ })).toHaveAttribute("href", "/fr/warehouse/stock");
  });

  it("explains an unassigned agent instead of showing an empty day", () => {
    renderHome({ siteUnassigned: true });
    expect(screen.getByText(frMessages.warehouse.bench.noSiteTitle)).toBeInTheDocument();
    expect(screen.queryAllByRole("link").filter((a) => a.getAttribute("data-job"))).toHaveLength(0);
  });

  it("reads in Arabic, with the building's Arabic name", () => {
    renderHome(payload({}, "ar"), "ar");
    expect(screen.getByText("اليوم")).toBeInTheDocument();
    expect(screen.getByText(/بنغازي/)).toBeInTheDocument();
    expect(screen.getByText("لم يُجرد أي منتج بعد")).toBeInTheDocument();
  });
});
