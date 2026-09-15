import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { ProspectsView, type ProspectsViewProps } from "../ProspectsView";
import type { ProspectRow } from "@/lib/prospects/types";

/** 2026-09-14 12:00 in Tripoli. */
const NOW = Date.parse("2026-09-14T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const minutesAhead = (m: number) => new Date(NOW + m * 60_000).toISOString();

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
    created_at: minutesAgo(6), updated_at: minutesAgo(6), last_touch_at: null,
    ...over,
  };
}

const HOT = row({ id: "hot", customer_name: "Amal Zentani", created_at: minutesAgo(23), product_name: "Sérum vitamine C", product_price: 110 });
const CALLBACK = row({
  id: "cb", bucket: "callback", status: "callback_scheduled", customer_name: "Houda Mabrouk",
  callback_scheduled_at: minutesAhead(95), customer_city: "Benghazi",
});
const RETRY = row({ id: "retry", bucket: "retry", status: "attempt_2", customer_name: "Fatma Arfi", customer_phone: "0919982211" });
const CAMPAIGN = row({
  id: "camp", bucket: "campaign", source: "campaign", status: "new", customer_name: "Khaled Zawi",
  campaign_id: "c1", campaign_name: "Sérum 60-120 j", campaign_offer: "−15 % sur le 50 ml",
  campaign_script: "Bonjour Khaled, ici Hend d'Ordra.",
});
const WINBACK = row({
  id: "wb", bucket: "winback", source: "winback", customer_name: "Mohamed Saleh",
  source_order_id: "o1", return_reason: "Le client n'a pas répondu au téléphone",
  prior_order_count: 1, prior_returned_count: 1,
});
const CONVERTED = row({ id: "won", bucket: "converted", status: "won", customer_name: "Samira Darsi", converted_order_id: "o9", converted_order_ref: "48219" });

function mount(over: Partial<ProspectsViewProps> = {}) {
  const props: ProspectsViewProps = {
    rows: [HOT, CALLBACK, RETRY, CAMPAIGN, WINBACK, CONVERTED],
    error: false,
    isLoading: false,
    onRetry: vi.fn(),
    role: "agent",
    marketCode: "ly",
    tz: "Africa/Tripoli",
    locale: "fr",
    now: NOW,
    hotWindowMinutes: 60,
    stats: { calls: 12, converted: 3 },
    pending: null,
    notice: null,
    onQueue: vi.fn(),
    onUndo: vi.fn(),
    onDismissNotice: vi.fn(),
    onConvert: vi.fn(),
    onNewLead: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <ProspectsView {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const list = () => screen.getByRole("list", { name: "Prospects" });
const rows = () => within(list()).getAllByRole("listitem");
const rowOf = (name: string) => within(list()).getByText(name).closest("[role='listitem']") as HTMLElement;

beforeEach(() => vi.clearAllMocks());

describe("ProspectsView — the list", () => {
  test("shows the page title and how many prospects are hot right now", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Prospects" })).toBeTruthy();
    // One hot row in the fixture.
    expect(screen.getByText(/1 à appeler maintenant/)).toBeTruthy();
  });

  test("every prospect is listed once", () => {
    mount();
    expect(rows()).toHaveLength(6);
  });

  test("a bucket filter narrows the list, and the tile carries its count", () => {
    mount();
    const campaign = screen.getByRole("button", { name: /Campagne/ });
    fireEvent.click(campaign);
    expect(rows()).toHaveLength(1);
    expect(within(list()).getByText("Khaled Zawi")).toBeTruthy();
    expect(campaign.getAttribute("aria-pressed")).toBe("true");
  });

  test("a hot prospect reads as its age, because the 10-minute rule is what the agent races", () => {
    mount();
    expect(within(rowOf("Amal Zentani")).getByText(/Chaud · 23 min/)).toBeTruthy();
  });

  test("a retry names the attempt so the agent knows how many tries are left", () => {
    mount();
    expect(within(rowOf("Fatma Arfi")).getByText(/2 essais/)).toBeTruthy();
  });

  test("a converted prospect shows the order it became", () => {
    mount();
    expect(within(rowOf("Samira Darsi")).getByText(/48219/)).toBeTruthy();
  });

  // Each row carries the move twice — a tinted bar for the phone, an outlined
  // pill for desktop — and CSS hides one. Both are in the DOM by design.
  test("each row offers the one move its bucket means", () => {
    mount();
    expect(within(rowOf("Amal Zentani")).getAllByRole("button", { name: /Appeler/ })).toHaveLength(2);
    expect(within(rowOf("Khaled Zawi")).getAllByRole("button", { name: /script/ })).toHaveLength(2);
    expect(within(rowOf("Mohamed Saleh")).getAllByRole("button", { name: /renvoi/ })).toHaveLength(2);
  });

  test("search matches a name, a city, or the digits of a phone number", () => {
    mount();
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "Benghazi" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(box, { target: { value: "0919982211" } });
    expect(within(list()).getByText("Fatma Arfi")).toBeTruthy();
  });

  test("a search that matches nothing says so instead of showing an empty page", () => {
    mount();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(screen.getByText("Aucun prospect ne correspond à cette recherche.")).toBeTruthy();
  });

  test("a prospect with no product shows no price, rather than inventing a zero", () => {
    mount();
    // Fatma has no product; the fixture's hot row does.
    expect(within(rowOf("Amal Zentani")).getByText(/110/)).toBeTruthy();
    expect(within(rowOf("Fatma Arfi")).queryByText(/LYD/)).toBeNull();
  });
});

describe("ProspectsView — the detail", () => {
  test("selecting a prospect fills the panel with its next action", () => {
    mount();
    fireEvent.click(rowOf("Amal Zentani"));
    const panel = screen.getByRole("region", { name: "Détail du prospect" });
    expect(within(panel).getByText("Appeler maintenant")).toBeTruthy();
    expect(within(panel).getByText(/Un prospect joint dans les 10 minutes convertit/)).toBeTruthy();
  });

  test("the campaign's offer and script are shown, because they are what the agent may promise", () => {
    mount();
    fireEvent.click(rowOf("Khaled Zawi"));
    const panel = screen.getByRole("region", { name: "Détail du prospect" });
    expect(within(panel).getAllByText(/−15 % sur le 50 ml/).length).toBeGreaterThan(0);
    expect(within(panel).getByText(/Bonjour Khaled, ici Hend d'Ordra./)).toBeTruthy();
  });

  test("a win-back shows the carrier's own words about why the parcel came back", () => {
    mount();
    fireEvent.click(rowOf("Mohamed Saleh"));
    const panel = screen.getByRole("region", { name: "Détail du prospect" });
    expect(within(panel).getAllByText(/Le client n'a pas répondu au téléphone/).length).toBeGreaterThan(0);
  });

  test("a customer with returns and no deliveries is flagged before the agent promises anything", () => {
    mount();
    fireEvent.click(rowOf("Mohamed Saleh"));
    const panel = screen.getByRole("region", { name: "Détail du prospect" });
    expect(within(panel).getByText(/Risque · 1 retournée, 0 livrée/)).toBeTruthy();
  });

  test("a panel with no campaign shows no empty campaign section", () => {
    mount();
    fireEvent.click(rowOf("Amal Zentani"));
    const panel = screen.getByRole("region", { name: "Détail du prospect" });
    expect(within(panel).queryByText("Script de campagne")).toBeNull();
  });

  test("a converted prospect offers the order, not a call", () => {
    mount();
    fireEvent.click(rowOf("Samira Darsi"));
    const panel = screen.getByRole("region", { name: "Détail du prospect" });
    expect(within(panel).getByText("Rien à faire")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Résultat de l'appel" })).toBeNull();
  });
});

describe("ProspectsView — recording an outcome", () => {
  test("no answer is saved with the exact payload the API expects", () => {
    const props = mount();
    fireEvent.click(rowOf("Amal Zentani"));
    fireEvent.click(screen.getByRole("button", { name: "Résultat de l'appel" }));
    fireEvent.click(screen.getByRole("button", { name: /Pas de réponse/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le résultat" }));

    expect(props.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hot" }),
      { kind: "no_answer", note: null },
    );
  });

  test("a callback cannot be saved until a time is chosen", () => {
    mount();
    fireEvent.click(rowOf("Amal Zentani"));
    fireEvent.click(screen.getByRole("button", { name: "Résultat de l'appel" }));
    fireEvent.click(screen.getByRole("button", { name: /Rappeler plus tard/ }));

    const save = screen.getByRole("button", { name: "Enregistrer le résultat" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "+2 h" }));
    expect((screen.getByRole("button", { name: "Enregistrer le résultat" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("a callback is saved at the chosen time, on the market clock", () => {
    const props = mount();
    fireEvent.click(rowOf("Amal Zentani"));
    fireEvent.click(screen.getByRole("button", { name: "Résultat de l'appel" }));
    fireEvent.click(screen.getByRole("button", { name: /Rappeler plus tard/ }));
    fireEvent.click(screen.getByRole("button", { name: "+2 h" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le résultat" }));

    expect(props.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hot" }),
      { kind: "callback", at: new Date(NOW + 7_200_000).toISOString(), note: null },
    );
  });

  test("a lost prospect must say why", () => {
    const props = mount();
    fireEvent.click(rowOf("Amal Zentani"));
    fireEvent.click(screen.getByRole("button", { name: "Résultat de l'appel" }));
    fireEvent.click(screen.getByRole("button", { name: /Pas intéressé/ }));
    expect((screen.getByRole("button", { name: "Enregistrer le résultat" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Prix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le résultat" }));
    expect(props.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hot" }),
      { kind: "lost", reason: "price", note: null },
    );
  });

  test("wanting to order opens the conversion rather than saving an outcome", () => {
    const props = mount();
    fireEvent.click(rowOf("Amal Zentani"));
    fireEvent.click(screen.getByRole("button", { name: "Résultat de l'appel" }));
    fireEvent.click(screen.getByRole("button", { name: /Veut commander/ }));

    expect(props.onConvert).toHaveBeenCalledWith(expect.objectContaining({ id: "hot" }));
    expect(props.onQueue).not.toHaveBeenCalled();
  });

  test("the note the agent typed rides along with the outcome", () => {
    const props = mount();
    fireEvent.click(rowOf("Amal Zentani"));
    fireEvent.click(screen.getByRole("button", { name: "Résultat de l'appel" }));
    fireEvent.click(screen.getByRole("button", { name: /Pas de réponse/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "rappeler ce soir" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le résultat" }));

    expect(props.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hot" }),
      { kind: "no_answer", note: "rappeler ce soir" },
    );
  });
});

describe("ProspectsView — states", () => {
  test("an empty list says so", () => {
    mount({ rows: [] });
    expect(screen.getByText("Aucun prospect pour l'instant.")).toBeTruthy();
  });

  test("a failed load offers a retry", () => {
    const props = mount({ rows: [], error: true });
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  test("while loading the list reports itself busy rather than looking empty", () => {
    mount({ rows: [], isLoading: true });
    expect(list().getAttribute("aria-busy")).toBe("true");
  });

  test("a saved outcome can be undone from the toast", () => {
    const props = mount({ notice: { bucket: "retry" } });
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(props.onUndo).toHaveBeenCalled();
  });

  test("super admin with no market chosen is told to pick one", () => {
    mount({ role: "super_admin", rows: [], marketCode: null });
    expect(screen.getByText("Choisis un marché pour voir ses prospects.")).toBeTruthy();
  });
});

describe("ProspectsView — Arabic", () => {
  // The Libyan market reads right-to-left. The view is mounted under the ar
  // messages here rather than probed through the app, because the locale a
  // user may see is decided by their market, not by the URL.
  function mountAr(over: Partial<ProspectsViewProps> = {}) {
    const props: ProspectsViewProps = {
      rows: [HOT, CALLBACK, RETRY, CAMPAIGN, WINBACK, CONVERTED],
      error: false, isLoading: false, onRetry: vi.fn(),
      role: "agent", marketCode: "ly", tz: "Africa/Tripoli", locale: "ar",
      now: NOW, hotWindowMinutes: 60, stats: { calls: 12, converted: 3 },
      pending: null, notice: null,
      onQueue: vi.fn(), onUndo: vi.fn(), onDismissNotice: vi.fn(),
      onConvert: vi.fn(), onNewLead: vi.fn(),
      ...over,
    };
    render(
      <NextIntlClientProvider locale="ar" messages={ar} timeZone="Africa/Tripoli">
        <ProspectsView {...props} />
      </NextIntlClientProvider>,
    );
    return props;
  }

  test("the page, its buckets and its moves are all in Arabic", () => {
    mountAr();
    expect(screen.getByRole("heading", { name: "العملاء المحتملون" })).toBeTruthy();
    for (const bucket of ["ساخنون", "مواعيد", "بلا رد", "حملة", "مرتجعات", "تحوّلوا"]) {
      expect(screen.getByRole("button", { name: new RegExp(bucket) })).toBeTruthy();
    }
  });

  test("Arabic gets the Cairo face the rest of the Libyan console uses", () => {
    const { container } = render(
      <NextIntlClientProvider locale="ar" messages={ar} timeZone="Africa/Tripoli">
        <ProspectsView
          rows={[HOT]} error={false} isLoading={false} onRetry={vi.fn()}
          role="agent" marketCode="ly" tz="Africa/Tripoli" locale="ar"
          now={NOW} hotWindowMinutes={60} stats={{ calls: 0, converted: 0 }}
          pending={null} notice={null}
          onQueue={vi.fn()} onUndo={vi.fn()} onDismissNotice={vi.fn()}
          onConvert={vi.fn()} onNewLead={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector(".font-cairo")).toBeTruthy();
  });

  test("amounts keep the number before the unit in Arabic, which plain bidi gets wrong", () => {
    mountAr();
    const amount = screen.getAllByText((_, el) => el?.textContent === "110 د.ل")[0];
    expect(amount).toBeTruthy();
  });
});

describe("ProspectsView — the minute clock", () => {
  /**
   * `now` ticks once a minute so a hot prospect's age stays honest. It is
   * passed to every row, which defeated memo() for the whole list: a campaign
   * or converted row shows nothing time-dependent, yet re-rendered on every
   * tick along with its chip, its buttons and its money formatting.
   */
  test("a tick of the clock does not re-render rows that show nothing time-dependent", () => {
    const props: ProspectsViewProps = {
      rows: [HOT, CAMPAIGN, CONVERTED, WINBACK],
      error: false, isLoading: false, onRetry: vi.fn(),
      role: "agent", marketCode: "ly", tz: "Africa/Tripoli", locale: "fr",
      now: NOW, hotWindowMinutes: 60, stats: { calls: 0, converted: 0 },
      pending: null, notice: null,
      onQueue: vi.fn(), onUndo: vi.fn(), onDismissNotice: vi.fn(),
      onConvert: vi.fn(), onNewLead: vi.fn(),
    };
    const { rerender } = render(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        <ProspectsView {...props} />
      </NextIntlClientProvider>,
    );

    const textOf = (name: string) => rowOf(name).textContent;
    const campaignBefore = textOf("Khaled Zawi");
    const convertedBefore = textOf("Samira Darsi");
    // Identity is the real assertion: a memoised row that is not re-rendered
    // keeps the very same DOM node. A fresh node means React rebuilt it.
    const campaignNode = rowOf("Khaled Zawi");
    const convertedNode = rowOf("Samira Darsi");

    // Two minutes later: only the hot row's age may change.
    rerender(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
        <ProspectsView {...props} now={NOW + 120_000} />
      </NextIntlClientProvider>,
    );

    expect(textOf("Khaled Zawi")).toBe(campaignBefore);
    expect(textOf("Samira Darsi")).toBe(convertedBefore);
    expect(rowOf("Khaled Zawi")).toBe(campaignNode);
    expect(rowOf("Samira Darsi")).toBe(convertedNode);
    // The hot row did move: 23 min → 25 min.
    expect(within(rowOf("Amal Zentani")).getByText(/25 min/)).toBeTruthy();
  });
});

describe("ProspectsView — a capped list", () => {
  // Tunisia has ~1 700 working prospects and the query returns 300. Showing
  // them without a word implies the agent has seen everything there is.
  test("says the list is capped when it is", () => {
    mount({ truncated: true });
    expect(screen.getByText(/Seuls les 6 premiers/)).toBeTruthy();
  });

  test("says nothing when the whole list is on screen", () => {
    mount({ truncated: false });
    expect(screen.queryByText(/Seuls les/)).toBeNull();
  });
});
