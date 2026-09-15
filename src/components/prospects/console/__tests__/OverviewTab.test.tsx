import { describe, test, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { OverviewTab, type OverviewTabProps } from "../OverviewTab";
import type { AgentLoadRanked, CampaignResult, ConsoleMetrics, Funnel } from "@/lib/prospects/console";

/**
 * The figures below are the real Libyan market on 2026-09-15, because the
 * point of this screen is what that market actually looks like: 290 of 292
 * prospects with no agent at all, the oldest waiting seventy days.
 */
const METRICS: ConsoleMetrics = {
  new_7d: 0, new_prev_7d: 0, hot_waiting: 0, oldest_hot_minutes: null,
  median_first_contact_minutes: null, median_first_contact_prev: null,
  converted_30d: 0, delivered_30d: 0, delivered_revenue_30d: 0,
  pool: 290, pool_campaigns: 1, pool_oldest_days: 70, never_called: 288,
  total: 292, late_callbacks: 0, lost_30d: 0, calls_today: 0, reached_today: 0,
  oldest_hot_agent: null,
};

const FUNNEL: Funnel = {
  created: 292, pool: 290, assigned: 2, called: 4, reached: 4, conv: 0, deliv: 0,
};

const CAMPAIGNS: CampaignResult[] = [
  {
    id: "c1", name: "Delivered products", offer: null, audience: 290, called: 2,
    converted: 0, revenue: 0, created_at: "2026-07-08T01:44:35Z", channel: "call", pool: 290,
  },
];

const AGENTS: AgentLoadRanked[] = [
  { id: "a1", name: "Hend", open_leads: 12, hot_waiting: 2, calls_today: 14, converted_today: 4, rate: 29, reached_today: 9, late_callbacks: 1, last_touch_minutes: 6 },
  { id: "a2", name: "Mouna", open_leads: 3, hot_waiting: 0, calls_today: 0, converted_today: 0, rate: null, reached_today: 0, late_callbacks: 0, last_touch_minutes: null },
];

function mount(over: Partial<OverviewTabProps> = {}, messages: typeof fr = fr, locale = "fr") {
  const props: OverviewTabProps = {
    metrics: METRICS, funnel: FUNNEL, loss: {}, campaigns: CAMPAIGNS, agents: AGENTS,
    marketCode: "ly", locale,
    onGo: vi.fn(), onDistribute: vi.fn(), onOpenAgent: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Tripoli">
      <OverviewTab {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("the page opens on the work, not on the numbers", () => {
  test("the unowned stock is announced before anything else", () => {
    // 1 984 of 1 992 production prospects have no agent. A page that opened on
    // a tidy row of KPIs would hide the only thing worth doing.
    mount();
    expect(screen.getByText("290 prospects n'ont aucun agent")).toBeInTheDocument();
  });

  test("it says how old the problem is and where it came from", () => {
    mount();
    expect(screen.getByText(/1 campagne concernée/)).toBeInTheDocument();
    expect(screen.getByText(/70 j/)).toBeInTheDocument();
  });

  test("the banner's button opens the distribution sheet", () => {
    const props = mount();
    fireEvent.click(screen.getByRole("button", { name: "Répartir maintenant" }));
    expect(props.onDistribute).toHaveBeenCalled();
  });

  test("a market where everyone has an agent shows no banner", () => {
    mount({ metrics: { ...METRICS, pool: 0 } });
    expect(screen.queryByText(/n'ont aucun agent/)).not.toBeInTheDocument();
  });

  test("hot prospects waiting get their own banner, naming the agent", () => {
    mount({
      metrics: { ...METRICS, hot_waiting: 3, oldest_hot_minutes: 47, oldest_hot_agent: "Hend" },
    });
    expect(screen.getByText("3 chauds sans réponse")).toBeInTheDocument();
    expect(screen.getByText(/47 min chez Hend/)).toBeInTheDocument();
  });
});

describe("the KPIs lead somewhere", () => {
  test("never-called opens the pipeline on the unassigned filter", () => {
    const props = mount();
    fireEvent.click(screen.getByRole("button", { name: /Jamais appelés/ }));
    expect(props.onGo).toHaveBeenCalledWith("pipeline", "unassigned");
  });

  test("late callbacks open the pipeline on the callbacks", () => {
    const props = mount({ metrics: { ...METRICS, late_callbacks: 2 } });
    fireEvent.click(screen.getByRole("button", { name: /Rappels en retard/ }));
    expect(props.onGo).toHaveBeenCalledWith("pipeline", "callback");
  });

  test("hot prospects lead to the team, because that is where the fix is", () => {
    const props = mount();
    fireEvent.click(screen.getByRole("button", { name: /Chauds sans réponse/ }));
    expect(props.onGo).toHaveBeenCalledWith("team");
  });

  test("never-called turns red when it is a real backlog", () => {
    mount();
    const tile = screen.getByRole("button", { name: /Jamais appelés/ });
    expect(tile.className).toContain("#FEF2F2");
  });

  test("a figure with nothing to compare to shows the target, not a fake delta", () => {
    // median_first_contact_prev is null on a market with no history: inventing
    // "+0 %" would claim a measurement nobody made.
    mount();
    expect(screen.getByText("objectif < 10 min")).toBeInTheDocument();
  });

  test("a market with no measurement shows a dash, not a zero", () => {
    // "0 min to first contact" would read as instant, which is the opposite
    // of the truth: nobody has been called at all.
    mount();
    const ttc = screen.getByRole("group", { name: "Délai de 1er contact" });
    expect(within(ttc).getByText("—")).toBeInTheDocument();
  });
});

describe("the funnel says where the stock stops", () => {
  test("every stage is drawn against the prospects created", () => {
    mount();
    const funnel = screen.getByText("Entonnoir").closest("section")!;
    expect(within(funnel).getByText("Sans agent")).toBeInTheDocument();
    expect(within(funnel).getByText("290")).toBeInTheDocument();
    expect(within(funnel).getByText("292 prospects créés sur la période")).toBeInTheDocument();
  });

  test("the pool stage is the one drawn in red", () => {
    mount();
    const funnel = screen.getByText("Entonnoir").closest("section")!;
    expect(funnel.innerHTML).toContain("#FCA5A5");
  });
});

describe("loss analysis", () => {
  test("a market that has lost nobody says so rather than drawing an empty chart", () => {
    mount({ loss: {} });
    const loss = screen.getByText("Motifs de perte").closest("section")!;
    expect(within(loss).getByText(/Aucun prospect ne correspond/)).toBeInTheDocument();
  });

  test("reasons are ranked, worst first, in words a person would use", () => {
    mount({ loss: { price: 12, unreachable: 5, not_interested: 2 } });
    const loss = screen.getByText("Motifs de perte").closest("section")!;
    const labels = within(loss).getAllByText(/Prix|Injoignable|Plus besoin/);
    expect(labels[0]).toHaveTextContent("Prix");
  });

  test("a price-dominated loss gets a note, because that one is actionable", () => {
    mount({ loss: { price: 12, unreachable: 5 } });
    expect(screen.getByText(/Le prix pèse 71 % des pertes/)).toBeInTheDocument();
  });

  test("no note when the loss is spread across reasons", () => {
    mount({ loss: { price: 1, unreachable: 9 } });
    expect(screen.queryByText(/Le prix pèse/)).not.toBeInTheDocument();
  });
});

describe("the agent table", () => {
  test("an agent who has not called today is marked, not hidden", () => {
    mount();
    expect(screen.getByText("Sans appel aujourd'hui")).toBeInTheDocument();
  });

  test("an agent with no calls shows a dash instead of a 0 % rate", () => {
    // 0 % would read as "tried and failed"; they have not tried.
    mount();
    const row = screen.getByText("Mouna").closest("tr")!;
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  test("clicking an agent opens their queue", () => {
    const props = mount();
    fireEvent.click(screen.getByText("Hend").closest("tr")!);
    expect(props.onOpenAgent).toHaveBeenCalledWith("a1");
  });

  test("idle agents holding prospects are named under the table", () => {
    // Mouna has a queue of 3 and has not called today: the manager should be
    // told, by name, rather than having to read the table for it.
    mount();
    const table = screen.getByText("Par agent · aujourd'hui").closest("section")!;
    expect(table.textContent).toContain("Mouna");
    expect(table.textContent).toContain("3 prospects dans leur file");
  });

  test("a market with no agents says so rather than showing an empty table", () => {
    mount({ agents: [] });
    expect(screen.getByText("Aucun agent actif sur ce marché.")).toBeInTheDocument();
  });
});

describe("campaigns on the overview", () => {
  test("a campaign nobody owns shows how many are unowned", () => {
    mount();
    expect(screen.getByText("290 sans agent")).toBeInTheDocument();
  });

  test("a campaign nobody has called says so instead of showing 0 %", () => {
    // "0 %" would read as tried-and-failed. Nobody has picked up the phone.
    mount({ campaigns: [{ ...CAMPAIGNS[0], called: 0 }] });
    expect(screen.getByText("jamais appelée")).toBeInTheDocument();
  });

  test("a campaign that was called and converted nobody shows the real 0 %", () => {
    mount();
    expect(screen.getByText("0 % de conversion")).toBeInTheDocument();
  });
});

describe("Arabic", () => {
  test("the page renders in Arabic with the same figures", () => {
    mount({}, ar as typeof fr, "ar");
    expect(screen.getByText("290 عميلاً محتملاً بلا وكيل")).toBeInTheDocument();
  });

  test("numbers stay Latin so a manager reads the same digits in both languages", () => {
    mount({}, ar as typeof fr, "ar");
    const funnel = screen.getByText("القمع").closest("section")!;
    expect(within(funnel).getByText("290")).toBeInTheDocument();
  });
});
