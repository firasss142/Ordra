import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { ProspectsConsole, type ProspectsConsoleProps } from "../ProspectsConsole";
import type { ProspectRow } from "@/lib/prospects/types";
import type { AgentLoadRanked, CampaignResult, ConsoleMetrics } from "@/lib/prospects/console";

const NOW = Date.parse("2026-09-15T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function row(over: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "l1", market_id: "m1", status: "assigned", source: "whatsapp", bucket: "hot",
    customer_name: "Amal Zentani", customer_phone: "0917788001",
    customer_city: "Tripoli", customer_address: null,
    product_id: null, product_name: null, product_price: null, product_image_url: null, product_note: null,
    notes: null, assigned_to: "a1", assigned_name: "Hend", callback_scheduled_at: null,
    converted_order_id: null, converted_order_ref: null,
    campaign_id: null, campaign_name: null, campaign_offer: null, campaign_script: null,
    source_order_id: null, source_order_ref: null, return_reason: null,
    repeat_kind: "none", prior_order_count: 0, prior_delivered_count: 0, prior_returned_count: 0,
    last_known_address: null,
    created_at: minutesAgo(23), updated_at: minutesAgo(23), last_touch_at: null,
    ...over,
  };
}

const METRICS: ConsoleMetrics = {
  new_7d: 38, new_prev_7d: 34, hot_waiting: 6, oldest_hot_minutes: 47,
  median_first_contact_minutes: 14, median_first_contact_prev: 18,
  converted_30d: 74, delivered_30d: 61, delivered_revenue_30d: 6715,
  pool: 290, pool_campaigns: 1, pool_oldest_days: 70, never_called: 288,
  total: 292, late_callbacks: 2, lost_30d: 4, calls_today: 14, reached_today: 9,
  oldest_hot_agent: "Hend",
};

const CAMPAIGNS: CampaignResult[] = [
  { id: "c1", name: "Sérum 60-120 j", offer: "−15 % sur le 50 ml", audience: 400, called: 200, converted: 40, revenue: 3190, created_at: "2026-09-08T00:00:00Z" },
  { id: "c2", name: "Montre X2 Benghazi", offer: null, audience: 96, called: 0, converted: 0, revenue: 0, created_at: "2026-09-10T00:00:00Z" },
];

const AGENTS: AgentLoadRanked[] = [
  { id: "a1", name: "Hend", open_leads: 12, hot_waiting: 2, calls_today: 14, converted_today: 4, rate: 29 },
  { id: "a2", name: "Salima", open_leads: 3, hot_waiting: 0, calls_today: 0, converted_today: 0, rate: null },
];

const ROWS = [
  row({ id: "hot", customer_name: "Amal Zentani", assigned_name: "Hend", product_price: 110 }),
  row({ id: "camp", bucket: "campaign", source: "campaign", status: "new", customer_name: "Khaled Zawi",
        campaign_id: "c1", campaign_name: "Sérum 60-120 j", assigned_to: null, assigned_name: null }),
  row({ id: "wb", bucket: "winback", source: "winback", customer_name: "Mohamed Saleh",
        source_order_id: "o1", return_reason: "Pas de réponse", assigned_name: "Mouna" }),
];

function mount(over: Partial<ProspectsConsoleProps> = {}, messages: typeof fr = fr, locale = "fr") {
  const props: ProspectsConsoleProps = {
    metrics: METRICS, campaigns: CAMPAIGNS, agents: AGENTS,
    rows: ROWS, error: false, isLoading: false, truncated: false, onRetry: vi.fn(),
    marketCode: "ly", tz: "Africa/Tripoli", locale, now: NOW,
    onNewCampaign: vi.fn(), onImportCsv: vi.fn(), onOpenProspect: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Tripoli">
      <ProspectsConsole {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const table = () => screen.getByRole("table", { name: "Pipeline" });
const rowOf = (name: string) => within(table()).getByText(name).closest("tr") as HTMLElement;

beforeEach(() => vi.clearAllMocks());

describe("ProspectsConsole — the four KPIs", () => {
  test("shows new prospects with the trend against the previous week", () => {
    mount();
    const kpi = screen.getByRole("group", { name: "Nouveaux (7 j)" });
    expect(within(kpi).getByText("38")).toBeTruthy();
    // 38 against 34 is +12 %.
    expect(within(kpi).getByText(/\+12/)).toBeTruthy();
  });

  test("a week with no history to compare shows no trend rather than a fake rise", () => {
    mount({ metrics: { ...METRICS, new_prev_7d: 0 } });
    const kpi = screen.getByRole("group", { name: "Nouveaux (7 j)" });
    expect(within(kpi).queryByText(/%/)).toBeNull();
  });

  test("the hot tile says how long the oldest one has waited, which is the thing to act on", () => {
    mount();
    const kpi = screen.getByRole("group", { name: "Chauds sans réponse" });
    expect(within(kpi).getByText("6")).toBeTruthy();
    expect(within(kpi).getByText(/47 min/)).toBeTruthy();
  });

  test("no hot prospects waiting reads as calm, not as a missing figure", () => {
    mount({ metrics: { ...METRICS, hot_waiting: 0, oldest_hot_minutes: null } });
    const kpi = screen.getByRole("group", { name: "Chauds sans réponse" });
    expect(within(kpi).getByText("personne n'attend")).toBeTruthy();
  });

  test("time to first contact is shown with its median", () => {
    mount();
    const kpi = screen.getByRole("group", { name: "Délai de 1er contact" });
    expect(within(kpi).getByText(/14/)).toBeTruthy();
  });

  // A market with no measured contacts must not render "NaN min".
  test("a market with nothing measured says so", () => {
    mount({ metrics: { ...METRICS, median_first_contact_minutes: null, median_first_contact_prev: null } });
    const kpi = screen.getByRole("group", { name: "Délai de 1er contact" });
    expect(within(kpi).getByText("pas encore de mesure")).toBeTruthy();
    expect(within(kpi).queryByText(/NaN/)).toBeNull();
  });

  test("delivered revenue is shown with how many were delivered", () => {
    mount();
    const kpi = screen.getByRole("group", { name: /CA livré/ });
    expect(within(kpi).getByText(/6 715/)).toBeTruthy();
    expect(within(kpi).getByText(/61 livrées/)).toBeTruthy();
  });
});

describe("ProspectsConsole — campaigns", () => {
  test("each campaign shows its funnel figures and delivered revenue", () => {
    mount();
    const card = screen.getByRole("group", { name: "Sérum 60-120 j" });
    expect(within(card).getByText(/400/)).toBeTruthy();
    expect(within(card).getByText(/200/)).toBeTruthy();
    expect(within(card).getByText(/3 190/)).toBeTruthy();
  });

  test("the funnel is drawn to the audience, so the three segments fill the bar", () => {
    mount();
    const card = screen.getByRole("group", { name: "Sérum 60-120 j" });
    const bar = within(card).getByRole("img", { name: /Sérum 60-120 j/ });
    const widths = Array.from(bar.querySelectorAll("span"))
      .map((s) => parseFloat((s as HTMLElement).style.width));
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
  });

  test("a campaign nobody has called says so instead of showing 0 %", () => {
    mount();
    const card = screen.getByRole("group", { name: "Montre X2 Benghazi" });
    expect(within(card).getByText("jamais appelée")).toBeTruthy();
  });

  test("a market with no campaigns says so", () => {
    mount({ campaigns: [] });
    expect(screen.getByText("Aucune campagne pour l'instant.")).toBeTruthy();
  });
});

describe("ProspectsConsole — the agent roster", () => {
  test("each agent shows their load and today's tally", () => {
    mount();
    const roster = screen.getByRole("group", { name: "Par agent · aujourd'hui" });
    expect(within(roster).getByText("Hend")).toBeTruthy();
    expect(within(roster).getByText(/4 \/ 14/)).toBeTruthy();
  });

  test("an agent with hot prospects waiting is flagged, because that is what needs a manager", () => {
    mount();
    const roster = screen.getByRole("group", { name: "Par agent · aujourd'hui" });
    expect(within(roster).getByText(/2 chauds attendent/)).toBeTruthy();
  });

  test("an agent who has made no calls today is not shown a damning zero per cent", () => {
    mount();
    const roster = screen.getByRole("group", { name: "Par agent · aujourd'hui" });
    const salima = within(roster).getByText("Salima").closest("li") as HTMLElement;
    expect(within(salima).getByText("aucun appel aujourd'hui")).toBeTruthy();
    expect(within(salima).queryByText(/0 %/)).toBeNull();
  });
});

describe("ProspectsConsole — the pipeline table", () => {
  test("lists every prospect with its agent", () => {
    mount();
    expect(within(table()).getAllByRole("row")).toHaveLength(ROWS.length + 1); // + header
    expect(within(rowOf("Amal Zentani")).getByText("Hend")).toBeTruthy();
  });

  // 1 982 production campaign leads have no assigned_to at all.
  test("an unassigned prospect is named as such, not left blank", () => {
    mount();
    expect(within(rowOf("Khaled Zawi")).getByText("Non assigné")).toBeTruthy();
  });

  test("a filter narrows the table and says how many remain", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Retours/ }));
    expect(within(table()).getAllByRole("row")).toHaveLength(2);
    expect(within(table()).getByText("Mohamed Saleh")).toBeTruthy();
  });

  test("the unassigned filter finds the prospects nobody can see", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Non assignés/ }));
    expect(within(table()).getAllByRole("row")).toHaveLength(2);
    expect(within(table()).getByText("Khaled Zawi")).toBeTruthy();
  });

  test("a filter that matches nothing says so rather than showing an empty table", () => {
    mount({ rows: [ROWS[0]] });
    fireEvent.click(screen.getByRole("button", { name: /Retours/ }));
    expect(screen.getByText("Aucun prospect ne correspond à ce filtre.")).toBeTruthy();
  });

  test("clicking a prospect opens it", () => {
    const props = mount();
    fireEvent.click(rowOf("Amal Zentani"));
    expect(props.onOpenProspect).toHaveBeenCalledWith(expect.objectContaining({ id: "hot" }));
  });

  // The real finding of this rebuild: campaign leads nobody owns.
  test("it warns when prospects are assigned to nobody", () => {
    mount();
    expect(screen.getByText(/1 prospect n'est assigné à personne/)).toBeTruthy();
  });

  test("no warning when every prospect has an owner", () => {
    mount({ rows: [ROWS[0]] });
    expect(screen.queryByText(/assigné à personne/)).toBeNull();
  });
});

describe("ProspectsConsole — states", () => {
  test("a failed load offers a retry", () => {
    const props = mount({ error: true, rows: [] });
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  test("a capped list says so", () => {
    mount({ truncated: true });
    expect(screen.getByText(/Seuls les/)).toBeTruthy();
  });

  test("the two ways in are offered", () => {
    const props = mount();
    fireEvent.click(screen.getByRole("button", { name: /Nouvelle campagne/ }));
    expect(props.onNewCampaign).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    expect(props.onImportCsv).toHaveBeenCalled();
  });
});

describe("ProspectsConsole — Arabic", () => {
  test("renders in Arabic with the Cairo face", () => {
    const { container } = render(
      <NextIntlClientProvider locale="ar" messages={ar} timeZone="Africa/Tripoli">
        <ProspectsConsole
          metrics={METRICS} campaigns={CAMPAIGNS} agents={AGENTS} rows={ROWS}
          error={false} isLoading={false} truncated={false} onRetry={vi.fn()}
          marketCode="ly" tz="Africa/Tripoli" locale="ar" now={NOW}
          onNewCampaign={vi.fn()} onImportCsv={vi.fn()} onOpenProspect={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "العملاء المحتملون" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "ساخنون بلا رد" })).toBeTruthy();
    expect(container.querySelector(".font-cairo")).toBeTruthy();
  });
});
