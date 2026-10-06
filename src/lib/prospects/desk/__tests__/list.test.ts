import { describe, expect, it } from "vitest";
import { parseListQuery, sourceOrFilter, stateFilter, agentOrFilter, toCsv, PAGE_SIZE } from "../list";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseListQuery", () => {
  it("reads repeated and comma-separated multi-selects, dropping anything invalid", () => {
    const q = parseListQuery(new URLSearchParams(`src=rej,ret&src=nope&agent=${A},none&agent=not-a-uuid&state=won&q=  ahmed  &page=3`));
    expect(q).toEqual({ sources: ["rej", "ret"], agents: [A, "none"], state: "won", q: "ahmed", page: 3, pageSize: PAGE_SIZE });
    expect(q.id).toBeUndefined();
  });

  it("defaults to open prospects, page 1, nothing filtered", () => {
    expect(parseListQuery(new URLSearchParams(""))).toEqual({ sources: [], agents: [], state: "open", q: "", page: 1, pageSize: PAGE_SIZE });
  });

  it("reads one prospect by id (the old /leads/[id] links land here), ignoring a malformed one", () => {
    expect(parseListQuery(new URLSearchParams(`id=${A}`)).id).toBe(A);
    expect(parseListQuery(new URLSearchParams("id=x")).id).toBeUndefined();
  });

  it("clamps the page and dedupes selections", () => {
    const q = parseListQuery(new URLSearchParams(`page=-4&src=rej&src=rej&agent=${A}&agent=${A}`));
    expect(q.page).toBe(1);
    expect(q.sources).toEqual(["rej"]);
    expect(q.agents).toEqual([A]);
  });
});

describe("filters for PostgREST", () => {
  it("maps sources to lead_source values; Listes means everything that is not automatic", () => {
    expect(sourceOrFilter([])).toBeNull();
    expect(sourceOrFilter(["rej", "ret"])).toBe("source.in.(rejected_order,winback)");
    expect(sourceOrFilter(["camp"])).toBe("source.not.in.(rejected_order,winback,repeat_buyer)");
    expect(sourceOrFilter(["old", "camp"])).toBe("source.in.(repeat_buyer),source.not.in.(rejected_order,winback,repeat_buyer)");
  });

  it("maps agents, with « Sans agent » as a null check", () => {
    expect(agentOrFilter([])).toBeNull();
    expect(agentOrFilter([A, B])).toBe(`assigned_to.in.(${A},${B})`);
    expect(agentOrFilter(["none", A])).toBe(`assigned_to.is.null,assigned_to.in.(${A})`);
    expect(agentOrFilter(["none"])).toBe("assigned_to.is.null");
  });

  it("maps the state to the same definitions as the desk facts", () => {
    expect(stateFilter("open")).toEqual({ statusIn: ["new", "assigned", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled", "qualified"], convertedNull: true });
    expect(stateFilter("won")).toEqual({ or: "converted_order_id.not.is.null,status.eq.won" });
    expect(stateFilter("lost")).toEqual({ statusIn: ["lost", "archived"], convertedNull: true });
    expect(stateFilter("all")).toEqual({});
  });
});

describe("toCsv", () => {
  const cols = [{ key: "name", label: "Nom" }, { key: "note", label: "Note" }];
  it("quotes separators, quotes and newlines", () => {
    const out = toCsv([{ name: "أحمد ب.", note: 'a "b"; c\nd' }], cols, { sep: ";", bom: false });
    expect(out).toBe('Nom;Note\r\nأحمد ب.;"a ""b""; c\nd"\r\n');
  });

  it("starts with a BOM for Excel so Arabic opens readable", () => {
    expect(toCsv([], cols, { sep: ";", bom: true }).charCodeAt(0)).toBe(0xfeff);
  });

  it("neutralises cells Excel would run as a formula", () => {
    const out = toCsv([{ name: "=HYPERLINK(1)", note: "+218" }], cols, { sep: ",", bom: false });
    expect(out.split("\r\n")[1]).toBe("'=HYPERLINK(1),'+218");
  });
});

import { toDeskRow } from "../list";

describe("toDeskRow", () => {
  const NOW = new Date("2026-10-06T10:00:00Z");
  const raw = {
    id: "l1", status: "attempt_2", source: "rejected_order", customer_name: "أحمد ب.", customer_phone: "0912344218",
    customer_city: "طرابلس", assigned_to: "a1", callback_scheduled_at: null, converted_order_id: null, campaign_id: null,
    source_order_id: "o1", return_reason: "changement_avis", created_at: "2026-10-04T08:00:00Z",
    products: { name: "كتاب الحفظ الميسر", default_price: 249, image_url: "https://x/p.jpg" },
    agent: [{ full_name: "tasnim", color: "indigo" }],
    campaign: null,
    source_order: { external_id: "LY-48210", total_price: 249 },
    converted: null,
  };

  it("flattens embeds, derives source, state, attempts and age", () => {
    expect(toDeskRow(raw, NOW)).toEqual({
      id: "l1", name: "أحمد ب.", phone: "0912344218", city: "طرابلس",
      source: "rej", leadSource: "rejected_order", state: "in_progress", status: "attempt_2", attempts: 2,
      reason: "changement_avis", campaignName: null,
      productName: "كتاب الحفظ الميسر", productPrice: 249, productImage: "https://x/p.jpg",
      agentId: "a1", agentName: "tasnim", agentColor: "indigo",
      callbackAt: null, lateCallback: false,
      sourceOrderId: "o1", sourceOrderRef: "LY-48210", value: 249,
      convertedOrderId: null, convertedRef: null, convertedStatus: null,
      createdAt: "2026-10-04T08:00:00Z", ageDays: 2,
    });
  });

  it("marks a callback in the past as late, and falls back to the order value when no product", () => {
    const r = toDeskRow({ ...raw, status: "callback_scheduled", callback_scheduled_at: "2026-10-06T08:00:00Z", products: null }, NOW);
    expect(r.lateCallback).toBe(true);
    expect(r.attempts).toBe(0);
    expect(r.value).toBe(249);
    expect(r.productName).toBeNull();
  });
});

import { combinedOr } from "../list";

describe("combinedOr", () => {
  it("ANDs several OR groups into the single .or() supabase-js can send (verified live on PostgREST)", () => {
    expect(combinedOr([null, null])).toBeNull();
    expect(combinedOr(["source.in.(winback)", null])).toBe("and(or(source.in.(winback)))");
    expect(combinedOr(["source.in.(winback)", "assigned_to.is.null"])).toBe("and(or(source.in.(winback)),or(assigned_to.is.null))");
  });
});
