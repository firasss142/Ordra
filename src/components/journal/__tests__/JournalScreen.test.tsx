import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import fr from "@/messages/fr.json";
import { JournalScreen } from "../JournalScreen";
import type { Overview, FeedRow, Issue, SystemTile } from "@/lib/journal/types";

/**
 * Journaux against a fake of its six routes, with the real intl, toast and SWR
 * providers. What the owner approved in prototypes/journaux-v2.html: a verdict,
 * one card per problem, calm tiles; one stream with five chips; panels that say
 * « Ce qui se passe · Combien · Que faire ».
 */

const NOW = new Date("2026-10-03T14:40:00Z");
const NB = / | /g;
const norm = (s: string | null | undefined) => (s ?? "").replace(NB, " ");
const byText = (text: string) => (_: string, el: Element | null) =>
  !!el && norm(el.textContent) === text && Array.from(el.children).every((c) => norm(c.textContent) !== text);

const ARCHIVE: Issue = {
  id: "11111111-1111-4111-8111-111111111111",
  rule: "job_failing",
  severity: "critical",
  system: "jobs",
  params: { job: "auto-archive-finished-orders", failures: 43, message: 'ERROR:  invalid input syntax for type integer: "{"value": 30}"', kind: "cron" },
  first_seen: "2026-08-22T03:00:00Z",
  last_seen: "2026-10-03T14:35:00Z",
  affected: 43,
  amount: null,
  currency: null,
  status: "open",
  muted_until: null,
  market: null,
};
const NAVEX: Issue = {
  ...ARCHIVE,
  id: "22222222-2222-4222-8222-222222222222",
  rule: "carrier_stuck",
  system: "carrier:c-navex",
  params: {
    carrier: "navex",
    name: "Navex",
    causes: [
      { reason: "unknown_navex_etat:Livrer Paye", parcels: 91, amount: 5479 },
      { reason: "invalid transition from deposit to returned", parcels: 48, amount: 2732 },
    ],
  },
  affected: 139,
  amount: 8211,
  currency: "TND",
  market: "tn",
};

const tile = (over: Partial<SystemTile>): SystemTile => ({
  id: "carrier:c-darb",
  family: "carrier",
  kind: "darb_assabil",
  name: "Darb Tripoli",
  market: "ly",
  state: "ok",
  reason: "in_service",
  last_at: "2026-10-03T14:33:00Z",
  detail: { parcels: 300 },
  issue_ids: [],
  bars: "o".repeat(48),
  ...over,
});

function overview(issues: Issue[]): Overview {
  return {
    issues,
    systems: [
      tile({}),
      tile({ id: "carrier:c-navex", name: "Navex", market: "tn", kind: "navex", state: issues.includes(NAVEX) ? "fail" : "ok", reason: issues.includes(NAVEX) ? "issue" : "in_service", issue_ids: issues.includes(NAVEX) ? [NAVEX.id] : [], bars: null }),
      tile({ id: "whatsapp", family: "msg", kind: "whatsapp", name: "WhatsApp", market: null, state: "off", reason: "not_connected", last_at: null, bars: null }),
      tile({ id: "jobs", family: "auto", kind: "jobs", name: null, market: null, state: issues.includes(ARCHIVE) ? "fail" : "ok", reason: "jobs", detail: { total: 14, failing: issues.includes(ARCHIVE) ? 1 : 0 }, bars: null }),
      tile({ id: "app", family: "app", kind: "app", name: "Ordra", market: null, state: "ok", reason: "app", detail: { errors: 0 }, bars: null }),
    ],
    jobs: [
      { job: "auto-archive-finished-orders", schedule: "0 3 * * *", last_at: "2026-10-03T03:00:00Z", cron_status: "failed", state: issues.includes(ARCHIVE) ? "fail" : "ok", issue_id: issues.includes(ARCHIVE) ? ARCHIVE.id : null, result: null },
      { job: "darb-sync-10min", schedule: "3-59/10 * * * *", last_at: "2026-10-03T14:33:00Z", cron_status: "succeeded", state: "ok", issue_id: null, result: { status: "succeeded", changed: 2 } },
    ],
    security: { errors: 0, logins: 14, login_failures: 3, exports: 1, role_changes: 0, repeated: [] },
    generated_at: NOW.toISOString(),
  };
}

const row = (over: Partial<FeedRow> & { id: string; at: string }): FeedRow => ({
  family: "team",
  kind: "order.status",
  severity: null,
  actor_id: "u-tasnim",
  actor_name: "tasnim",
  actor_role: "agent",
  market_id: null,
  order_id: null,
  order_ref: null,
  params: {},
  ref: null,
  ...over,
});

const FEED: FeedRow[] = [
  row({ id: "oh:3", at: "2026-10-03T14:20:00Z", params: { to: "confirmed" }, order_ref: "2059056", order_id: "o-1", ref: "order:o-1" }),
  row({ id: "oh:2", at: "2026-10-03T14:15:00Z", params: { to: "confirmed" }, order_ref: "1542368", order_id: "o-2", ref: "order:o-2" }),
  row({ id: "ic:1", at: "2026-10-03T10:41:00Z", family: "ext", kind: "carrier.upload_failed", severity: "fail", params: { carrier: "Darb Tripoli", code: "DARB_VALIDATION", message: "destination manquante" }, ref: "call:44444444-4444-4444-8444-444444444444" }),
  row({ id: "ae:9", at: "2026-10-02T17:10:00Z", kind: "products.updated", actor_name: "Super Admin", actor_role: "super_admin", params: { entity: "products", label: "Gel X", fields: ["default_price"], changes: { default_price: [199, 179] } }, ref: "audit:55555555-5555-4555-8555-555555555555" }),
];

interface Call {
  method: string;
  url: string;
  body: unknown;
}
let calls: Call[];
let issues: Issue[];

function installApi() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const path = url.split("?")[0];
      const q = new URLSearchParams(url.split("?")[1] ?? "");
      const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });

      if (path === "/api/admin/journal/overview") return json(overview(issues));
      if (path === "/api/admin/journal/feed") {
        let rows = FEED;
        const fam = q.get("family");
        if (fam) rows = rows.filter((r) => r.family === fam);
        if (q.get("only_issues") === "1") rows = rows.filter((r) => r.severity);
        return json({ rows, next: null, routine: { "2026-10-03": 312 } });
      }
      if (path === "/api/admin/journal/detail") {
        const ref = q.get("ref") ?? "";
        if (ref.startsWith("audit:"))
          return json({ type: "audit", row: { id: ref.slice(6), action: "products.updated", entity_type: "products", entity_label: "Gel X", changes: { default_price: [199, 179] }, occurred_at: "2026-10-02T17:10:00Z" } });
        if (ref.startsWith("call:"))
          return json({ type: "call", row: { id: ref.slice(5), system: "darb_assabil", status: "refused", error_code: "DARB_VALIDATION", message: "destination manquante", duration_ms: 1200, attempt: 1, order_id: "o-9", occurred_at: "2026-10-03T10:41:00Z" } });
      }
      if (path === "/api/admin/journal/trace") {
        return json({
          matches: [{ id: "o-1", ref: "2165688", status: "delivered", market: "ly", created_at: "2026-09-16T23:45:00Z" }],
          trace: {
            order: { id: "o-1", ref: "2165688", status: "delivered", amount: 199, currency: "LYD", market: "ly", city: "Benghazi", shop: "Converty", platform: "converty", carrier: "Darb Tripoli", tracking: "SH1", created_at: "2026-09-16T23:45:00Z" },
            events: [
              { at: "2026-09-16T23:45:00Z", seq: 1, kind: "order.received", actor: null, actor_type: "system", params: {} },
              { at: "2026-09-20T16:19:00Z", seq: 1, kind: "order.status", actor: "tasnim", actor_type: "agent", params: { from: "attempt_3", to: "confirmed" } },
            ],
          },
        });
      }
      if (path.startsWith("/api/admin/journal/issues/") && method === "POST") return json({ ok: true });
      return json({ error: `unhandled ${method} ${url}` }, 404);
    }),
  );
}

function renderScreen(ui: ReactNode = <JournalScreen />) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli" now={NOW}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // the API sends them sorted by what they cost (journal_overview)
  issues = [NAVEX, ARCHIVE];
  installApi();
  window.history.replaceState(null, "", "/fr/system/logs");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Aperçu — « est-ce que tout marche ? »", () => {
  test("a verdict counts the problems, and each problem is one card with its figure", async () => {
    renderScreen();
    expect(await screen.findByRole("heading", { name: "2 choses à régler" })).toBeInTheDocument();
    const cards = screen.getByRole("region", { name: "À régler maintenant" });
    expect(within(cards).getAllByRole("button")).toHaveLength(2);
    expect(norm(within(cards).getAllByRole("button")[0].textContent)).toContain("Navex : 139 colis bloqués");
    expect(within(cards).getByText(byText("8 211 TND"))).toBeInTheDocument();
    expect(norm(within(cards).getAllByRole("button")[1].textContent)).toContain("« Archivage des commandes terminées » échoue depuis 43 passages");
  });

  test("the tab carries the number of problems", async () => {
    renderScreen();
    const tab = await screen.findByRole("tab", { name: /Aperçu/ });
    await waitFor(() => expect(norm(tab.textContent)).toContain("2"));
  });

  test("with no problem, it says so, and the tiles are calm", async () => {
    issues = [];
    renderScreen();
    expect(await screen.findByRole("heading", { name: "Tout fonctionne" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "À régler maintenant" })).not.toBeInTheDocument();
    const systems = screen.getByRole("region", { name: "Systèmes" });
    // everything healthy is one line until asked
    expect(within(systems).queryByText("Darb Tripoli")).not.toBeInTheDocument();
    fireEvent.click(within(systems).getByRole("button", { name: /5 systèmes sans problème/ }));
    expect(within(systems).getByText("Darb Tripoli")).toBeInTheDocument();
    expect(within(systems).getByText("Non connecté")).toBeInTheDocument();
    expect(within(systems).getByText("Toutes réussies")).toBeInTheDocument();
  });

  test("a problem opens « Ce qui se passe · Combien · Que faire », with its causes", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /Navex\s:\s139 colis bloqués/ }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Ce qui se passe")).toBeInTheDocument();
    expect(within(panel).getByText("Combien")).toBeInTheDocument();
    expect(within(panel).getByText("Que faire")).toBeInTheDocument();
    expect(within(panel).getByText(byText("« Livrer Paye » — statut inconnu d’Ordra"))).toBeInTheDocument();
    expect(within(panel).getByText(byText("« Retourné » refusé depuis « Déposé »"))).toBeInTheDocument();
  });

  test("« Ignorer 7 jours » mutes the problem through the API", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /Archivage des commandes terminées/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Ignorer 7 jours" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", url: `/api/admin/journal/issues/${ARCHIVE.id}/mute`, body: { days: 7 } }),
    );
  });

  test("the jobs tile opens the list of jobs, with what each did", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /Tâches automatiques/ }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Archivage des commandes terminées")).toBeInTheDocument();
    expect(within(panel).getByText("En échec")).toBeInTheDocument();
    expect(within(panel).getByText("2 changements")).toBeInTheDocument();
  });

  test("a carrier tile shows its 48 hours", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /systèmes sans problème/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Darb Tripoli/ }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("img", { name: "Les 48 dernières heures" })).toBeInTheDocument();
  });
});

describe("Aperçu v2 — clear at a glance (2026-10-06)", () => {
  const inactive = (n: number): Issue => ({
    ...ARCHIVE,
    id: `33333333-3333-4333-8333-33333333333${n}`,
    rule: "carrier_inactive",
    severity: "warning",
    system: `carrier:c-old-${n}`,
    params: { name: `Ancien compte ${n}`, off_at: "2026-10-01T10:00:00Z", no_news: 1 },
    affected: 2,
    amount: 100,
    currency: "LYD",
    market: "ly",
  });
  const CITIES: Issue = {
    ...ARCHIVE,
    id: "44444444-4444-4444-8444-444444444444",
    rule: "server_error",
    system: "app",
    params: {
      route: "/api/cities", method: "GET", status: 500, message: "Internal server error", last: "2026-10-03T14:30:00Z",
      cause_kind: "db", cause_code: "22P02", cause_target: "cities", cause_detail: 'invalid input syntax for type uuid: ""',
    },
    affected: 720,
    amount: null,
    currency: null,
    market: null,
  };

  test("urgent and « à surveiller » problems are two separate lists", async () => {
    issues = [NAVEX, inactive(1)];
    renderScreen();
    const now = await screen.findByRole("region", { name: "À régler maintenant" });
    const watch = screen.getByRole("region", { name: "À surveiller" });
    expect(norm(now.textContent)).toContain("Navex");
    expect(norm(watch.textContent)).toContain("Ancien compte 1");
    expect(norm(now.textContent)).not.toContain("Ancien compte");
  });

  test("three problems of the same kind fold into one card that opens to the list", async () => {
    issues = [inactive(1), inactive(2), inactive(3)];
    renderScreen();
    const watch = await screen.findByRole("region", { name: "À surveiller" });
    expect(within(watch).getAllByRole("button")).toHaveLength(1);
    const fold = within(watch).getByRole("button", { name: /3 transporteurs coupés ont encore des colis/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    // the fold and, under it, one card per problem
    expect(within(watch).getAllByRole("button")).toHaveLength(4);
    expect(within(watch).getByRole("button", { name: /^Ancien compte 2/ })).toBeInTheDocument();
  });

  test("a server error says WHY on its card, not « Internal server error »", async () => {
    issues = [CITIES];
    renderScreen();
    const now = await screen.findByRole("region", { name: "À régler maintenant" });
    expect(norm(now.textContent)).toContain("Ordra a envoyé à la base une valeur vide ou mal formée");
    expect(norm(now.textContent)).not.toContain("Internal server error");
  });

  test("its panel answers « Pourquoi » and « Que faire », the technical detail last", async () => {
    issues = [CITIES];
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /Erreur serveur répétée/ }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("heading", { name: "Pourquoi" })).toBeInTheDocument();
    expect(norm(within(panel).getByText(/valeur vide ou mal formée/).textContent)).toContain("un identifiant");
    expect(norm(panel.textContent)).toContain("Repérer l’écran qui déclenche l’erreur");
    expect(norm(panel.textContent)).toContain("22P02");
    expect(norm(panel.textContent)).toContain("cities");
  });

  test("systems only « à vérifier » fold into one line too: the problem list already names them", async () => {
    renderScreen();
    const systems = await screen.findByRole("region", { name: "Systèmes" });
    await waitFor(() => expect(within(systems).getByText("Navex")).toBeInTheDocument());
    // fixture: no amber tile → no amber line
    expect(within(systems).queryByRole("button", { name: /à vérifier/ })).not.toBeInTheDocument();
  });

  test("failing systems stay visible; the healthy ones are one line", async () => {
    renderScreen();
    const systems = await screen.findByRole("region", { name: "Systèmes" });
    await waitFor(() => expect(within(systems).getByText("Navex")).toBeInTheDocument());
    expect(within(systems).queryByText("Darb Tripoli")).not.toBeInTheDocument();
    expect(within(systems).getByRole("button", { name: /3 systèmes sans problème/ })).toBeInTheDocument();
  });
});

describe("Historique — « que s'est-il passé ? »", () => {
  async function openHistory() {
    renderScreen();
    fireEvent.click(await screen.findByRole("tab", { name: "Historique" }));
  }

  test("one stream by day, series merged, routine counted not listed", async () => {
    await openHistory();
    expect(await screen.findByText(byText("tasnim a confirmé 2 commandes"))).toBeInTheDocument();
    expect(screen.getByText("Aujourd’hui")).toBeInTheDocument();
    expect(screen.getByText(byText("312 passages de routine sans changement (synchronisations, imports vides)"))).toBeInTheDocument();
    expect(screen.getByText(/Hier/)).toBeInTheDocument();
  });

  test("a failure carries its flag; success carries none", async () => {
    await openHistory();
    const failure = (await screen.findByText(byText("Envoi chez Darb Tripoli refusé"))).closest("[data-row]")!;
    expect(within(failure as HTMLElement).getByText("Échec")).toBeInTheDocument();
    const ok = screen.getByText(byText("tasnim a confirmé 2 commandes")).closest("[data-row]")!;
    expect(within(ok as HTMLElement).queryByText("Échec")).not.toBeInTheDocument();
  });

  test("a chip asks the server for its family only", async () => {
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: "Sécurité et erreurs" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/admin/journal/feed") && c.url.includes("family=sec"))).toBe(true));
  });

  test("« Problèmes seulement » keeps only failures and warnings", async () => {
    await openHistory();
    fireEvent.click(await screen.findByRole("switch", { name: "Problèmes seulement" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("only_issues=1"))).toBe(true));
    await waitFor(() => expect(screen.queryByText(byText("tasnim a confirmé 2 commandes"))).not.toBeInTheDocument());
    expect(screen.getByText(byText("Envoi chez Darb Tripoli refusé"))).toBeInTheDocument();
  });

  test("a change opens before → after", async () => {
    await openHistory();
    fireEvent.click(await screen.findByText(byText("Super Admin a changé le prix de Gel X : 199 → 179")));
    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByText("Prix de vente")).toBeInTheDocument();
    expect(within(panel).getByText("Avant")).toBeInTheDocument();
    expect(within(panel).getByText("199")).toBeInTheDocument();
    expect(within(panel).getByText("179")).toBeInTheDocument();
  });

  test("a refused upload tells what happened and what to do, with the carrier's reason", async () => {
    await openHistory();
    fireEvent.click(await screen.findByText(byText("Envoi chez Darb Tripoli refusé")));
    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByText("destination manquante")).toBeInTheDocument();
    expect(within(panel).getByText("Que faire")).toBeInTheDocument();
  });
});

describe("Retrouver une commande", () => {
  test("« / » opens the search; one match shows its whole story", async () => {
    renderScreen();
    await screen.findByRole("heading", { name: "2 choses à régler" });
    fireEvent.keyDown(document, { key: "/" });
    const panel = await screen.findByRole("dialog");
    fireEvent.change(within(panel).getByRole("searchbox"), { target: { value: "2165688" } });
    fireEvent.submit(within(panel).getByRole("search"));
    expect(await within(panel).findByText(byText("Reçue de Converty"))).toBeInTheDocument();
    expect(within(panel).getByText(byText("tasnim a confirmé la commande 2165688"))).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/admin/journal/trace?q=2165688")).toBe(true);
  });
});
