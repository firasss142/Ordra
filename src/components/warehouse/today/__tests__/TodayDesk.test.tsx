import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import { assembleDayLoop, type DayLoopRows } from "@/lib/warehouse/day-loop-assemble";
import { TodayDesk } from "../TodayDesk";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/**
 * The manager's « Aujourd'hui »: the agent's four jobs, wider — each split by
 * building — plus what only a manager sees: the decisions waiting for them and
 * today's team. Every decision is a link; the dashboard this replaces had
 * priority actions that could not be clicked.
 */

function rows(over: Partial<DayLoopRows> = {}): DayLoopRows {
  return {
    warehouses: [
      { id: "T", code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس" },
      { id: "B", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي" },
    ],
    queueBySite: {
      T: { to_prepare: 16, oldest_prepare_hours: 26, returns_inbox: 0, set_aside: 351 },
      B: { to_prepare: 31, oldest_prepare_hours: 70, returns_inbox: 2, set_aside: 42 },
    },
    marketQueue: { to_prepare: 47, oldest_prepare_hours: 70, returns_inbox: 2, set_aside: 393 },
    returning: [{ warehouse_id: "B" }],
    receptions: [{ warehouse_id: "T", status: "open", arrival_date: "2026-10-01" }],
    productIds: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
    countRows: [],
    agents: [
      { id: "a", full_name: "adel", warehouse_id: "B" },
      { id: "t", full_name: "tarek", warehouse_id: "T" },
    ],
    leaderboard: [{ actor_id: "a", scanned: 14, last_scan_at: "2026-10-02T09:41:00Z" }],
    marketScannedToday: 14,
    goal: null,
    ...over,
  };
}

function payload(focus: string | null = null, over: Partial<DayLoopRows> = {}) {
  return {
    ...assembleDayLoop(rows(over), { focus, today: "2026-10-02", locale: "fr", withManagerViews: true }),
    siteUnassigned: false as const,
    sitePinned: false,
  };
}

function renderDesk(data: ReturnType<typeof payload>) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
      <TodayDesk data={data} locale="fr" dateLabel="jeudi 2 octobre" />
    </NextIntlClientProvider>,
  );
}

const jobCard = (k: string) => screen.getAllByRole("link").find((a) => a.getAttribute("data-job") === k)!;

afterEach(cleanup);

describe("TodayDesk", () => {
  it("shows the four jobs, each split by building", () => {
    renderDesk(payload());
    expect(within(jobCard("out")).getByTestId("today-figure")).toHaveTextContent("47");
    expect(within(jobCard("out")).getByTestId("today-split")).toHaveTextContent(/Tripoli\s*16\s*Benghazi\s*31/);
    expect(within(jobCard("returns")).getByTestId("today-split")).toHaveTextContent(/Tripoli\s*0\s*Benghazi\s*2/);
  });

  it("links each job to the screen where it is done", () => {
    renderDesk(payload());
    expect(jobCard("out")).toHaveAttribute("href", "/fr/warehouse/out");
    expect(jobCard("receive")).toHaveAttribute("href", "/fr/warehouse/stock?tab=receptions");
    expect(jobCard("count")).toHaveAttribute("href", "/fr/warehouse/count");
  });

  it("lists every decision as a link to where it is acted on", () => {
    renderDesk(payload());
    const list = screen.getByRole("region", { name: "À décider" });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/fr/warehouse/out",
      "/fr/warehouse/returns",
      "/fr/warehouse/stock?tab=receptions",
      "/fr/warehouse/count",
    ]);
    expect(within(list).getByText("393 colis mis de côté")).toBeInTheDocument();
  });

  it("says when there is nothing to decide instead of drawing an empty card", () => {
    renderDesk(payload(null, {
      queueBySite: {},
      marketQueue: { to_prepare: 0 },
      receptions: [],
      countRows: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"].map((p) => ({ product_id: p, warehouse_id: "B" })),
    }));
    expect(screen.getByText("Rien à décider pour l'instant.")).toBeInTheDocument();
  });

  it("lists today's team, a building that has not scanned included", () => {
    renderDesk(payload());
    const team = screen.getByRole("region", { name: "Équipe aujourd'hui" });
    expect(within(team).getByText("adel")).toBeInTheDocument();
    expect(within(team).getByText("tarek")).toBeInTheDocument();
    expect(within(team).getByText("aucun scan aujourd'hui")).toBeInTheDocument();
  });

  it("switches building through the address, so a view can be shared", () => {
    renderDesk(payload("T"));
    const nav = screen.getByRole("navigation", { name: "Bâtiment" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["Tous", "/fr/warehouse", null],
      ["Tripoli", "/fr/warehouse?warehouse_id=T", "page"],
      ["Benghazi", "/fr/warehouse?warehouse_id=B", null],
    ]);
  });
});
