import { describe, test, expect } from "vitest";
import { createTranslator } from "next-intl";
import fr from "@/messages/fr.json";
import { describeFeed, describeIssue, describeTile, causeLabel, scheduleLabel } from "../describe";
import { makeFmt } from "../format";
import type { FeedItem, FeedRow, Issue, SystemTile } from "@/lib/journal/types";

const t = createTranslator({ locale: "fr", messages: fr, namespace: "journaux" });
const statuses = createTranslator({ locale: "fr", messages: fr, namespace: "orders.statuses" });
const f = makeFmt("fr", "Africa/Tripoli", (s) => (statuses.has(s as never) ? statuses(s as never) : s), new Date("2026-10-03T14:40:00Z"));
const NB = / | /g;
const plain = (s: string | undefined) => (s ?? "").replace(NB, " ");

const row = (over: Partial<FeedRow>): FeedRow => ({
  at: "2026-10-03T13:40:00Z",
  id: "x",
  family: "team",
  kind: "order.status",
  severity: null,
  actor_id: "u1",
  actor_name: "tasnim",
  actor_role: "agent",
  market_id: null,
  order_id: null,
  order_ref: "2165688",
  params: {},
  ref: null,
  ...over,
});
const item = (over: Partial<FeedRow>, count = 1): FeedItem => {
  const r = row(over);
  const members = Array.from({ length: count }, (_, i) => ({ ...r, id: `${r.id}${i}` }));
  return { ...r, count, since: r.at, members };
};

describe("feed lines", () => {
  test("one confirmation names the order", () => {
    expect(plain(describeFeed(item({ params: { to: "confirmed" } }), t, f).title)).toBe("tasnim a confirmé la commande 2165688");
  });

  test("a series counts", () => {
    expect(plain(describeFeed(item({ params: { to: "confirmed" } }, 2), t, f).title)).toBe("tasnim a confirmé 2 commandes");
  });

  test("call attempts read as attempts, whatever the number", () => {
    expect(plain(describeFeed(item({ params: { to: "attempt_3" } }, 3), t, f).title)).toBe("tasnim : 3 tentatives sans réponse");
  });

  test("a carrier delivery says who and how much", () => {
    const line = describeFeed(
      item({ family: "ext", kind: "carrier.status", actor_id: null, actor_name: null, order_ref: "2059056", params: { to: "delivered", carrier: "Darb Tripoli", amount: 199, currency: "LYD" } }),
      t,
      f,
    );
    expect(plain(line.title)).toBe("Commande 2059056 livrée");
    expect(plain(line.sub)).toBe("Darb Tripoli · 199 LYD");
  });

  test("a batch of settings names the market", () => {
    const line = describeFeed(
      item({ kind: "settings.changed", actor_name: "Admin", params: { count: 28, market: "tn", keys: ["auto_archive_after_days", "max_call_attempts"] } }),
      t,
      f,
    );
    expect(plain(line.title)).toBe("Admin a modifié 28 réglages de la Tunisie");
    expect(plain(line.sub)).toBe("Archivage automatique · Nombre maximum d’appels");
  });

  test("a price change shows before → after", () => {
    const line = describeFeed(
      item({
        kind: "products.updated",
        actor_name: "Super Admin",
        params: { entity: "products", label: "Gel X", fields: ["default_price"], changes: { default_price: [199, 179] } },
      }),
      t,
      f,
    );
    expect(plain(line.title)).toBe("Super Admin a changé le prix de Gel X : 199 → 179");
  });

  test("switching a carrier account off says so, and who did it", () => {
    const line = describeFeed(
      item({ kind: "carriers.updated", actor_name: "hamidaly", params: { entity: "carriers", label: "Darb Benghazi", fields: ["is_active"], changes: { is_active: [true, false] } } }),
      t,
      f,
    );
    expect(plain(line.title)).toBe("hamidaly a désactivé le transporteur Darb Benghazi");
  });

  test("a change by the server with no named person is not given a name", () => {
    const line = describeFeed(
      item({ kind: "carriers.updated", actor_id: null, actor_name: null, params: { entity: "carriers", label: "Navex", fields: ["delivery_fee"], kind: "service" } }),
      t,
      f,
    );
    expect(plain(line.title)).toBe("Le serveur a modifié le transporteur Navex");
  });

  test("a server error names the area and the action, not the code path", () => {
    const line = describeFeed(
      item({ family: "sec", kind: "app.error", severity: "fail", actor_id: null, params: { route: "/api/agents/[id]", method: "PATCH", status: 500 } }, 2),
      t,
      f,
    );
    expect(plain(line.title)).toBe("Erreur serveur · Accès : modifier");
    expect(plain(line.sub)).toBe("2 fois · code 500");
  });

  test("commissions in a series add up", () => {
    const base = { family: "auto" as const, kind: "commission.accrual", actor_id: null, actor_name: null, params: { amount: 9, currency: "LYD", agent: "roqaya" } };
    const it = item(base, 2);
    expect(plain(describeFeed(it, t, f).title)).toBe("2 commissions créditées à roqaya · 18 LYD");
  });

  test("repeated sign-in failures say how many", () => {
    const line = describeFeed(
      item({ family: "sec", kind: "auth.login_failed", severity: "warn", actor_id: null, actor_name: null, params: { label: "ag•••@oms.local" } }, 5),
      t,
      f,
    );
    expect(plain(line.title)).toBe("5 échecs de connexion sur ag•••@oms.local");
  });

  test("a series of changes to different items names the kind of item, not the first one", () => {
    const line = describeFeed(
      item({ family: "auto", kind: "carriers.updated", actor_id: null, actor_name: null, params: { entity: "carriers", label: "Navex", fields: ["is_active"] } }, 15),
      t,
      f,
    );
    expect(plain(line.title)).toBe("Ordra a modifié 15 éléments · Transporteurs");
  });

  test("a resolved problem keeps its figures", () => {
    const line = describeFeed(
      item({
        family: "ext",
        kind: "issue.resolved",
        actor_id: null,
        actor_name: null,
        params: { rule: "carrier_inactive", p: { name: "Darb Benghazi" }, affected: 63 },
        ref: "issue:x",
      }),
      t,
      f,
    );
    expect(plain(line.title)).toBe("Résolu · Darb Benghazi est désactivé, 63 colis encore dehors");
  });

  test("a carrier known only by its code is named, not shown as a code", () => {
    const line = describeFeed(
      item({ family: "ext", kind: "carrier.upload_failed", severity: "fail", params: { carrier: "darb_assabil", message: "x" } }),
      t,
      f,
    );
    expect(plain(line.title)).toBe("Envoi chez Darb Assabil refusé");
  });

  test("an upload with no known carrier does not say « chez — »", () => {
    expect(plain(describeFeed(item({ params: { to: "uploaded" } }), t, f).title)).toBe("tasnim a envoyé la commande 2165688 au transporteur");
  });

  test("an unknown kind still says something", () => {
    expect(plain(describeFeed(item({ kind: "mystery.thing" }), t, f).title)).toBe("Activité · mystery.thing");
  });
});

describe("problems", () => {
  const issue = (over: Partial<Issue>): Issue => ({
    id: "i",
    rule: "job_failing",
    severity: "critical",
    system: "jobs",
    params: {},
    first_seen: "2026-08-22T03:00:00Z",
    last_seen: "2026-10-03T14:35:00Z",
    affected: null,
    amount: null,
    currency: null,
    status: "open",
    muted_until: null,
    market: null,
    ...over,
  });

  test("a failing job uses the job's own name and the streak", () => {
    const d = describeIssue(issue({ params: { job: "auto-archive-finished-orders", failures: 43, message: "invalid input" } }), t, f);
    expect(plain(d.title)).toBe("« Archivage des commandes terminées » échoue depuis 43 passages");
    expect(d.impact).toEqual(["43", expect.stringContaining("échecs")]);
  });

  test("stuck parcels lead with the money", () => {
    const d = describeIssue(
      issue({ rule: "carrier_stuck", system: "carrier:c", params: { name: "Navex", causes: [] }, affected: 139, amount: 8211, currency: "TND" }),
      t,
      f,
    );
    expect(plain(d.title)).toBe("Navex : 139 colis bloqués");
    expect(plain(d.impact[0])).toBe("8 211 TND");
  });

  test("an inactive account with parcels out", () => {
    const d = describeIssue(
      issue({ rule: "carrier_inactive", severity: "warning", params: { name: "Darb Benghazi", off_at: null }, affected: 63 }),
      t,
      f,
    );
    expect(plain(d.title)).toBe("Darb Benghazi est désactivé, 63 colis encore dehors");
    expect(plain(d.line)).toContain("date inconnue");
  });
});

describe("carrier causes", () => {
  test("an unknown status is quoted", () => {
    expect(plain(causeLabel("unknown_navex_etat:Livrer Paye", t, f))).toBe("« Livrer Paye » — statut inconnu d’Ordra");
  });
  test("a refused transition is told in status words", () => {
    expect(plain(causeLabel("invalid transition from deposit to returned", t, f))).toBe("« Retourné » refusé depuis « Déposé »");
  });
});

describe("tiles", () => {
  const tile = (over: Partial<SystemTile>): SystemTile => ({
    id: "carrier:c",
    family: "carrier",
    kind: "darb_assabil",
    name: "Darb Tripoli",
    market: "ly",
    state: "ok",
    reason: "in_service",
    last_at: "2026-10-03T14:33:00Z",
    detail: {},
    issue_ids: [],
    bars: null,
    ...over,
  });

  test("a healthy carrier: in service, last pass", () => {
    const d = describeTile(tile({}), t, f);
    expect(plain(d.where)).toBe("Libye · transporteur");
    expect(d.state).toBe("En service");
    expect(plain(d.last)).toBe("Dernier passage il y a 7 minutes");
  });

  test("a shop paused because ads stopped explains its silence", () => {
    const d = describeTile(tile({ id: "shop:s", family: "intake", kind: "converty", name: "Converty", state: "mute", reason: "ads_stopped", detail: { ads_until: "2026-09-30" } }), t, f);
    expect(d.state).toBe("En pause");
    expect(plain(d.last)).toBe("Publicité arrêtée depuis le 30 sept. — rien à importer");
  });

  test("jobs count their failures", () => {
    const d = describeTile(tile({ id: "jobs", family: "auto", kind: "jobs", name: null, state: "fail", reason: "jobs", detail: { total: 14, failing: 1 } }), t, f);
    expect(d.name).toBe("Tâches automatiques");
    expect(d.state).toBe("1 en échec");
    expect(plain(d.last)).toBe("13 sur 14 réussissent");
  });
});

describe("schedules", () => {
  test("cron reads as words", () => {
    expect(scheduleLabel("*/10 * * * *", t, f)).toBe("toutes les 10 min");
    expect(scheduleLabel("3-59/10 * * * *", t, f)).toBe("toutes les 10 min");
    expect(scheduleLabel("* * * * *", t, f)).toBe("chaque minute");
    expect(scheduleLabel("7 * * * *", t, f)).toBe("chaque heure");
    expect(plain(scheduleLabel("0 3 * * *", t, f))).toBe("chaque jour, 05:00");
  });
});

describe("error rows say why (journal v2)", () => {
  test("a server error row carries its cause instead of the code alone", () => {
    const d = describeFeed(
      item({ family: "sec", kind: "app.error", severity: "fail", params: { route: "/api/cities", method: "GET", status: 500, source: "server", cause_kind: "db", cause_code: "22P02", cause_target: "cities" } }),
      t as never,
      f,
    );
    expect(plain(d.sub)).toContain("valeur vide ou mal formée");
  });

  test("a row recorded before causes keeps the old line", () => {
    const d = describeFeed(item({ family: "sec", kind: "app.error", severity: "fail", params: { route: "/api/x", method: "GET", status: 500 } }), t as never, f);
    expect(plain(d.sub)).toBe("1 fois · code 500");
  });

  test("a browser crash names the page", () => {
    const d = describeFeed(
      item({ family: "sec", kind: "app.error", severity: "fail", params: { route: "/orders", method: "BROWSER", status: 0, source: "browser", page: "/fr/orders", cause_kind: "code", cause_code: "TypeError", cause_detail: "Cannot read properties of undefined (reading 'x')" } }),
      t as never,
      f,
    );
    expect(plain(d.title)).toBe("Une page a planté · /orders");
    expect(plain(d.sub)).toContain("une donnée absente");
  });

  test("a failed call to Meta is named Meta, not « meta »", () => {
    const d = describeFeed(item({ family: "ext", kind: "carrier.sync_failed", severity: "fail", params: { carrier: "meta", status: "refused" } }), t as never, f);
    expect(plain(d.title)).toBe("Synchronisation avec Meta en échec");
  });
});
