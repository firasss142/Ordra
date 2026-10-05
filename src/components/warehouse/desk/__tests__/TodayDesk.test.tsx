import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import frMessages from "@/messages/fr.json";
import { assembleDayLoop, type DayLoopRows } from "@/lib/warehouse/day-loop-assemble";
import { TodayDesk } from "../TodayDesk";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace, refresh: vi.fn() }),
  usePathname: () => "/fr/warehouse",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * « Aujourd'hui » on the desk (prototypes/entrepot-desk-v1.html): four job
 * cards, what only the manager can decide, and one card per building.
 */

function rows(over: Partial<DayLoopRows> = {}): DayLoopRows {
  return {
    warehouses: [
      { id: "T", code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس" },
      { id: "B", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي" },
    ],
    queueBySite: {
      T: { to_prepare: 11, oldest_prepare_hours: 26, returns_inbox: 20, set_aside: 323 },
      B: { to_prepare: 31, oldest_prepare_hours: 70, returns_inbox: 12, set_aside: 0 },
    },
    marketQueue: { to_prepare: 42, oldest_prepare_hours: 70, returns_inbox: 32, set_aside: 323 },
    returning: [{ warehouse_id: "B" }, { warehouse_id: "T" }],
    receptions: [{ warehouse_id: "T", status: "open", arrival_date: "2026-10-04" }],
    productIds: ["p1", "p2", "p3"],
    countRows: [],
    agents: [
      { id: "n", full_name: "Nabil", warehouse_id: "B" },
      { id: "k", full_name: "Karim", warehouse_id: "T" },
    ],
    leaderboard: [{ actor_id: "n", scanned: 14, last_scan_at: "2026-10-05T11:20:00Z" }],
    marketScannedToday: 14,
    goal: null,
    ...over,
  };
}

function payload(focus: string | null = null) {
  return {
    ...assembleDayLoop(rows(), { focus, today: "2026-10-05", locale: "fr", withManagerViews: true }),
    siteUnassigned: false as const,
    sitePinned: false,
  };
}

function renderDesk(data = payload()) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
        <TodayDesk data={data} locale="fr" dateLabel="dimanche 5 octobre" marketCode="ly" marketId="m-ly" today="2026-10-05" />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const job = (k: string) => screen.getAllByRole("link").find((a) => a.getAttribute("data-job") === k)!;

describe("TodayDesk (Aurore)", () => {
  it("shows one big number per job and opens the screen where the job is done", () => {
    renderDesk();
    expect(within(job("out")).getByTestId("job-n")).toHaveTextContent("42");
    expect(within(job("returns")).getByTestId("job-n")).toHaveTextContent("32");
    expect(within(job("count")).getByTestId("job-n")).toHaveTextContent("3");
    expect(job("out")).toHaveAttribute("href", "/fr/warehouse/out");
    expect(job("returns")).toHaveAttribute("href", "/fr/warehouse/returns");
    expect(job("receive")).toHaveAttribute("href", "/fr/warehouse/receive");
    expect(job("count")).toHaveAttribute("href", "/fr/warehouse/count");
  });

  it("lists only what the warehouse cannot settle alone — never-counted products are a job, not a decision", () => {
    renderDesk();
    const decide = screen.getByRole("region", { name: "À décider" });
    expect(within(decide).getByText(/323 colis mis de côté/)).toBeInTheDocument();
    expect(within(decide).getByText(/32 retours attendent chez Darb/)).toBeInTheDocument();
    expect(within(decide).getByText(/1 arrivage non soldé/)).toBeInTheDocument();
    expect(within(decide).queryByText(/jamais compté/)).toBeNull();
  });

  it("gives every building its own card, and says when a building has not scanned today", () => {
    renderDesk();
    const ben = screen.getByRole("region", { name: "Benghazi" });
    expect(within(ben).getByTestId("bld-out")).toHaveTextContent("31");
    expect(within(ben).getByTestId("bld-done")).toHaveTextContent("14");
    expect(within(ben).getByTestId("bld-ret")).toHaveTextContent("12");
    const tri = screen.getByRole("region", { name: "Tripoli" });
    expect(within(tri).getByText(/aucun scan aujourd'hui/)).toBeInTheDocument();
  });
});
