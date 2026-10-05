"use client";

// Finances › Achats — the four drawers of prototypes/finances-achats-v1.html:
// Payer, Solder l'arrivage, Nouveau bon de commande, Nouveau fournisseur.
// Every write goes through an existing route (and its RPC where there is one);
// the arithmetic shown while typing comes from src/lib/finance/purchases/settle.ts,
// and the base redoes it on write.

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Banknote, Boxes, Calendar, Check, FileText, Info, Landmark, Layers, PenLine, Plus, Scale, ShoppingCart, Store, Trash2, Truck, Wallet, Package } from "lucide-react";
import type { Arrival, Bill, PurchasesView } from "@/lib/finance/purchases/model";
import { dueDateFor, parseAmount, payOutcome, poTotal, settleDecision, settleMath, type SettleChoice, type Terms } from "@/lib/finance/purchases/settle";
import { DrawerClose, type Fmt, type Loc } from "../kit/ui";

type T = ReturnType<typeof useTranslations>;
const b = (c: ReactNode) => <b>{c}</b>;
const EPS = 0.0005;

export function dateLabel(loc: Loc, iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat(loc === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { ...opts, timeZone: "UTC" }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso),
  );
}

export const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

/** a price: whole when whole, otherwise its decimals (up to the millime) */
export const price = (f: Fmt, v: number) => f.n(v, Number.isInteger(v) ? 0 : Math.round(v * 100) === v * 100 ? 2 : 3);

/** what a typed number looks like back in its field */
const raw = (v: number | null) => (v === null ? "" : String(v));

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(String(out.error ?? res.status)), { status: res.status });
  return out;
}

function Seg<K extends string>({ value, options, onChange, full, label }: { value: K; options: { k: K; label: string; icon?: ReactNode }[]; onChange: (k: K) => void; full?: boolean; label?: string }) {
  return (
    <div className={`segc${full ? " full" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.k} type="button" role="radio" aria-checked={o.k === value} className={o.k === value ? "on" : ""} onClick={() => onChange(o.k)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Head({ lead, id, title, sub, onClose, t }: { lead: ReactNode; id: string; title: string; sub: ReactNode; onClose: () => void; t: T }) {
  return (
    <div className="dr-h">
      {lead}
      <div style={{ minWidth: 0 }}>
        <h3 id={id}>{title}</h3>
        <p>{sub}</p>
      </div>
      <DrawerClose onClose={onClose} label={t("close")} />
    </div>
  );
}

function MoneyIn({ id, value, onChange, sym, big, label }: { id?: string; value: string; onChange: (v: string) => void; sym: string; big?: boolean; label?: string }) {
  return (
    <div className={`inp-u${big ? " big" : ""}`}>
      <input id={id} aria-label={label} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      <span>{sym}</span>
    </div>
  );
}

// ── Payer ────────────────────────────────────────────────────────────────────

type Method = "cash" | "bank_transfer" | "cheque";

export function PayDrawer({ bill, f, t, loc, today, onClose, onDone }: { bill: Bill; f: Fmt; t: T; loc: Loc; today: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [amount, setAmount] = useState(raw(bill.left));
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<Method>("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = bill.supplierName ?? "—";
  const v = parseAmount(amount) ?? 0;
  const out = payOutcome(bill.left, v, bill.supplierOwed);

  let recap: ReactNode;
  if (out.over) recap = <div className="recap warn"><Info className="ic" aria-hidden /><span>{t("payD.over", { v: f.money(bill.left) })}</span></div>;
  else if (out.billRest < EPS)
    recap = (
      <div className="recap good">
        <Check className="ic" aria-hidden />
        <span>
          {out.supplierRest < EPS ? t("payD.clear", { name }) : t("payD.clearRest", { name, v: f.money(out.supplierRest) })}
          {bill.held > 0 && bill.heldOpen ? ` ${t("payD.heldNote", { v: f.n(bill.held) })}` : ""}
        </span>
      </div>
    );
  else
    recap = (
      <div className="recap flat">
        <Info className="ic" aria-hidden />
        <span>
          {t("payD.rest", { v: f.money(out.billRest) })}
          {bill.bucket === "late" ? ` ${t("payD.stillLate")}` : ""}
        </span>
      </div>
    );

  async function submit() {
    if (busy || !(v > 0)) return;
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/warehouse/receptions/${bill.receptionId}/payments`, "POST", { amount: v, paid_at: date || today, method, note: note.trim() || null });
      onDone(t("payD.done"));
    } catch (e) {
      setErr(t("writeError", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head lead={<span className="sav lg">{initials(name)}</span>} id="dr-pay" title={t("payD.title", { name })} sub={t("payD.sub", { ref: bill.ref ?? "—", v: f.money(bill.left) })} onClose={onClose} t={t} />
      <div className="dr-b">
        <div className="dr-sec">
          <h4><Wallet className="ic" aria-hidden />{t("payD.secPay")}</h4>
          <div className="fg">
            <div className="fld">
              <label htmlFor="pay-amt">{t("payD.amount")}</label>
              <MoneyIn id="pay-amt" big value={amount} onChange={setAmount} sym={f.sym} />
              <small>{t("payD.amountHint")}</small>
            </div>
            <div className="two">
              <div className="fld">
                <label htmlFor="pay-date">{t("payD.date")}</label>
                <input id="pay-date" type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="fld">
                <span>{t("payD.method")}</span>
                <Seg<Method>
                  full
                  label={t("payD.method")}
                  value={method}
                  onChange={setMethod}
                  options={[
                    { k: "cash", label: t("payD.cash"), icon: <Banknote className="ic" aria-hidden /> },
                    { k: "bank_transfer", label: t("payD.wire"), icon: <Landmark className="ic" aria-hidden /> },
                    { k: "cheque", label: t("payD.cheque"), icon: <PenLine className="ic" aria-hidden /> },
                  ]}
                />
              </div>
            </div>
            <div className="fld">
              <label htmlFor="pay-note">{t("payD.note")}</label>
              <textarea id="pay-note" className="inp" placeholder={t("payD.notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="dr-sec">
          <h4><FileText className="ic" aria-hidden />{t("payD.secBill")}<span className="end">{bill.ref}</span></h4>
          <div className="sums">
            <div><span>{t("payD.invoice")}</span><b>{f.money(bill.total)}</b></div>
            <div><span>{t("payD.paid")}</span><b>− {f.n(bill.paid)}</b></div>
            {bill.held > 0 && <div><span>{t("payD.held")}</span><b>− {f.n(bill.held)}</b></div>}
            <div className="tot"><span>{t("payD.left")}</span><b>{f.money(bill.left)}</b></div>
          </div>
        </div>
        {recap}
        {err && <div className="err">{err}</div>}
      </div>
      <div className="dr-f">
        <button className="btn2" type="button" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" type="button" disabled={busy || !(v > 0)} onClick={() => void submit()}>
          <Check className="ic" aria-hidden />
          {t("payD.submit")}
        </button>
      </div>
    </>
  );
}

// ── Solder l'arrivage ────────────────────────────────────────────────────────

export function SettleDrawer({ arrival, view, f, t, loc, onClose, onDone }: { arrival: Arrival; view: PurchasesView; f: Fmt; t: T; loc: Loc; onClose: () => void; onDone: (msg: string) => void }) {
  const [supplierId, setSupplierId] = useState(arrival.supplierId ?? "");
  const [supplierRef, setSupplierRef] = useState(arrival.supplierRef ?? "");
  const [prices, setPrices] = useState(arrival.lines.map((l) => raw(l.price)));
  const [freight, setFreight] = useState(raw(arrival.fees.freight));
  const [customs, setCustoms] = useState(raw(arrival.fees.customs));
  const [basis, setBasis] = useState<"value" | "units">(arrival.feeBasis);
  const [invoice, setInvoice] = useState("");
  const [choice, setChoice] = useState<SettleChoice>("claim");
  const [note, setNote] = useState("");
  const [terms, setTerms] = useState<Terms>("30");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fees = (parseAmount(freight) ?? 0) + (parseAmount(customs) ?? 0) + arrival.fees.other;
  const m = useMemo(
    () => settleMath(arrival.lines.map((l, i) => ({ received: l.received, damaged: l.damaged, price: parseAmount(prices[i]) })), fees, basis, parseAmount(invoice)),
    [arrival.lines, prices, fees, basis, invoice],
  );
  const decision = settleDecision(m, choice, note, t("settleD.autoReason", { n: m.damagedUnits }));
  const due = dueDateFor(view.today, terms, custom);
  const owed = decision.ok ? decision.owed : null;

  const hint = (l: Arrival["lines"][number]) =>
    l.hint.kind === "po" ? t("settleD.hintPo", { v: price(f, l.hint.value!) }) : l.hint.kind === "last" ? t("settleD.hintLast", { v: price(f, l.hint.value!) }) : l.hint.kind === "current" ? t("settleD.hintCurrent", { v: price(f, l.hint.value!) }) : t("settleD.hintNone");

  async function save(settle: boolean) {
    if (busy) return;
    setErr(null);
    if (settle && !supplierId) return setErr(t("settleD.needSupplier"));
    if (settle && !decision.ok) return setErr(t("settleD.reasonRequired"));
    setBusy(true);
    try {
      const id = arrival.receptionId;
      await send(`/api/warehouse/receptions/${id}`, "PATCH", {
        supplier_ref: supplierRef.trim() || null,
        lines: arrival.lines.map((l, i) => ({ id: l.id, unit_cost: parseAmount(prices[i]) })),
      });
      // Landed fees: the drawer holds one figure per kind — replace the rows of that kind when it changed.
      for (const [kind, typed] of [["freight", parseAmount(freight) ?? 0], ["customs", parseAmount(customs) ?? 0]] as const) {
        if (Math.abs(typed - arrival.fees[kind]) < EPS) continue;
        for (const cid of arrival.costIds[kind]) await send(`/api/warehouse/receptions/${id}/costs?cost_id=${encodeURIComponent(cid)}`, "DELETE");
        if (typed > 0) await send(`/api/warehouse/receptions/${id}/costs`, "POST", { amount: typed, kind });
      }
      if (basis !== arrival.feeBasis) await send(`/api/warehouse/receptions/${id}/costs`, "PATCH", { fee_basis: basis });
      if (!settle) {
        onDone(t("settleD.draftDone"));
        return;
      }
      const d = decision as Extract<typeof decision, { ok: true }>;
      const out = await send(`/api/warehouse/receptions/${id}/settle`, "POST", {
        supplier_id: supplierId,
        invoice_total: d.invoiceTotal,
        due_at: due,
        discrepancy_reason: d.reason,
        claim_amount: d.claimAmount,
      });
      onDone(t("settleD.done", { ref: String(out.reference ?? "") }));
    } catch (e) {
      setErr(t("writeError", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  const gapAbs = m.gap === null ? 0 : Math.abs(m.gap);
  const landedList = arrival.lines
    .map((l, i) => (m.landed[i] === null ? null : `${l.name} ${f.n(m.landed[i] as number, 2)}`))
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Head
        lead={<span className="hold"><Package className="ic" aria-hidden /></span>}
        id="dr-settle"
        title={t("settleD.title")}
        sub={t("settleD.sub", { site: arrival.siteName ?? "—", day: arrival.day ? dateLabel(loc, arrival.day, { weekday: "long", day: "numeric", month: "short" }) : "—" })}
        onClose={onClose}
        t={t}
      />
      <div className="dr-b">
        <div className="dr-sec">
          <h4><Store className="ic" aria-hidden />{t("settleD.secFrom")}</h4>
          <div className="two">
            <div className="fld">
              <label htmlFor="st-sup">{t("settleD.supplier")}</label>
              <select id="st-sup" className="inp" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t("settleD.pickSupplier")}</option>
                {view.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="fld">
              <label htmlFor="st-inv">{t("settleD.invoiceNo")}</label>
              <input id="st-inv" className="inp" placeholder={t("settleD.invoiceNoPh")} value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {arrival.poRefs.length ? (
              <span className="tg"><FileText className="ic" aria-hidden />{t("settleD.fromPo", { refs: arrival.poRefs.join(", ") })}</span>
            ) : (
              <span className="tg warn"><Info className="ic" aria-hidden />{t("settleD.fromLast")}</span>
            )}
          </div>
        </div>

        <div className="dr-sec">
          <h4><Boxes className="ic" aria-hidden />{t("settleD.secLines")}<span className="end">{t("settleD.linesEnd")}</span></h4>
          <div className="lt">
            <div className="lt-r hd">
              <span>{t("settleD.colProduct")}</span>
              <span className="e">{t("settleD.colIn")}</span>
              <span className="e">{t("settleD.colDmg")}</span>
              <span>{t("settleD.colPrice")}</span>
              <span className="e">{t("settleD.colTotal")}</span>
            </div>
            {arrival.lines.map((l, i) => (
              <div className="lt-r" key={l.id}>
                <b dir="auto">{l.variant ? `${l.name} · ${l.variant}` : l.name}</b>
                <span className="n">{f.n(l.received)}</span>
                <span className={`n ${l.damaged ? "bad" : "zero"}`}>{f.n(l.damaged)}</span>
                <div className="pr">
                  <MoneyIn label={`${t("settleD.colPrice")} ${i + 1}`} value={prices[i]} onChange={(v) => setPrices((p) => p.map((x, j) => (j === i ? v : x)))} sym={f.sym} />
                  <small>{hint(l)}</small>
                </div>
                <span className="n">{f.n(m.lineTotals[i])}</span>
              </div>
            ))}
            <div className="lt-note"><Info className="ic" aria-hidden /><span>{t("settleD.linesNote")}</span></div>
          </div>
        </div>

        <div className="dr-sec">
          <h4><Truck className="ic" aria-hidden />{t("settleD.secFees")}<span className="end">{t("settleD.feesEnd")}</span></h4>
          <div className="two">
            <div className="fld">
              <label htmlFor="st-tr">{t("settleD.freight")}</label>
              <MoneyIn id="st-tr" value={freight} onChange={setFreight} sym={f.sym} />
            </div>
            <div className="fld">
              <label htmlFor="st-dz">{t("settleD.customs")}</label>
              <MoneyIn id="st-dz" value={customs} onChange={setCustoms} sym={f.sym} />
            </div>
          </div>
          {arrival.fees.other > 0 && <p className="cmp" style={{ marginTop: 8 }}>{t("settleD.otherFees", { v: f.money(arrival.fees.other) })}</p>}
          <div className="seg-row">
            <Seg<"value" | "units"> value={basis} onChange={setBasis} options={[{ k: "value", label: t("settleD.byValue") }, { k: "units", label: t("settleD.byUnit") }]} />
            <span className="cmp">{fees > 0 ? t("settleD.landed", { list: landedList || "—" }) : t("settleD.landedNone")}</span>
          </div>
        </div>

        <div className="dr-sec">
          <h4><Scale className="ic" aria-hidden />{t("settleD.secRec")}</h4>
          <div className="fg">
            <div className="fld">
              <label htmlFor="st-total">{t("settleD.invoiceTotal")}</label>
              <MoneyIn id="st-total" value={invoice} onChange={setInvoice} sym={f.sym} />
            </div>
            {m.gap === null ? (
              <div className="recap flat"><Info className="ic" aria-hidden /><span>{t("settleD.noInvoice")}</span></div>
            ) : gapAbs < EPS ? (
              <div className="rec ok">
                <div className="rec-l">
                  <Check className="ic" aria-hidden />
                  {t("settleD.recInv", { v: price(f, m.invoice!) })}<span className="sp" />{t("settleD.recGoods", { v: price(f, m.goods) })}<span className="sp" />{t("settleD.recGap", { v: "0" })}
                </div>
              </div>
            ) : (
              <div className="rec gap">
                <div className="rec-l">
                  {t("settleD.recInv", { v: price(f, m.invoice!) })}<span className="sp" />{t("settleD.recGoods", { v: price(f, m.goods) })}<span className="sp" />
                  <span className="gapv">{t("settleD.recGap", { v: `${m.gap! > 0 ? "+" : "−"}${price(f, gapAbs)}` })}</span>
                </div>
                <div className="rec-why">{m.explained ? t("settleD.why", { n: m.damagedUnits, v: price(f, m.damagedValue) }) : t("settleD.whyUnknown")}</div>
                {!m.explained && (
                  <div className="fld">
                    <label htmlFor="st-why">{t("settleD.explain")}</label>
                    <input id="st-why" className="inp" placeholder={t("settleD.explainPh")} value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                )}
                {m.gap! > 0 && (
                  <div className="choice">
                    <button className={`ch${choice === "claim" ? " on" : ""}`} type="button" aria-pressed={choice === "claim"} onClick={() => setChoice("claim")}>
                      <b>{t("settleD.claim")} <em>{t("settleD.recommended")}</em></b>
                      <small>{t("settleD.claimSub", { v: price(f, m.goods) })}</small>
                    </button>
                    <button className={`ch${choice === "pay" ? " on" : ""}`} type="button" aria-pressed={choice === "pay"} onClick={() => setChoice("pay")}>
                      <b>{t("settleD.payAnyway")}</b>
                      <small>{t("settleD.payAnywaySub", { v: price(f, m.invoice!) })}</small>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="dr-sec">
          <h4><Calendar className="ic" aria-hidden />{t("settleD.secDue")}</h4>
          <div className="seg-row" style={{ marginTop: 0 }}>
            <Seg<Terms> value={terms} onChange={setTerms} options={[{ k: "cod", label: t("settleD.cod") }, { k: "30", label: t("settleD.d30") }, { k: "date", label: t("settleD.other") }]} />
            {terms === "date" && <input type="date" className="inp" style={{ width: 170 }} aria-label={t("settleD.other")} value={custom} onChange={(e) => setCustom(e.target.value)} />}
            <b className="due-line">
              {t("settleD.dueLine", {
                v: f.money(owed ?? m.goods),
                when: terms === "cod" ? t("settleD.dueToday") : due ? t("settleD.dueOn", { day: dateLabel(loc, due) }) : t("settleD.duePick"),
              })}
            </b>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
      <div className="dr-f">
        <button className="btn2" type="button" disabled={busy} onClick={() => void save(false)}>{t("settleD.saveDraft")}</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void save(true)}>
          <Check className="ic" aria-hidden />
          {t("settleD.submit")}
        </button>
      </div>
    </>
  );
}

// ── Nouveau bon de commande ──────────────────────────────────────────────────

export interface OrderPrefill {
  site?: string | null;
  product?: string | null;
  qty?: number | null;
}

interface DraftLine {
  product: string;
  qty: string;
  price: string;
}

export function OrderDrawer({ view, prefill, marketName, f, t, onClose, onDone }: { view: PurchasesView; prefill: OrderPrefill; marketName: string; f: Fmt; t: T; onClose: () => void; onDone: (msg: string) => void }) {
  const cat = useMemo(() => new Map(view.catalogue.map((c) => [c.id, c])), [view.catalogue]);
  const p0 = prefill.product && cat.get(prefill.product) ? cat.get(prefill.product)! : null;
  const site0 = prefill.site && view.warehouses.some((w) => w.id === prefill.site) ? prefill.site : view.warehouses.find((w) => w.isDefault)?.id ?? view.warehouses[0]?.id ?? "";
  const sugg = p0 ? view.suggestions.find((g) => g.productId === p0.id && g.siteId === site0) ?? null : null;
  const qty0 = prefill.qty ?? sugg?.qty ?? null;

  const [supplierId, setSupplierId] = useState(p0?.lastSupplierId && view.suppliers.some((s) => s.id === p0.lastSupplierId) ? p0.lastSupplierId : "");
  const [site, setSite] = useState(site0);
  const [wanted, setWanted] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ product: p0?.id ?? "", qty: qty0 ? String(qty0) : "", price: raw(p0?.lastPrice ?? null) }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sup = view.suppliers.find((s) => s.id === supplierId);
  const total = poTotal(lines.map((l) => ({ qty: l.qty ? Number.parseInt(l.qty, 10) : null, price: parseAmount(l.price) })));
  const siteName = view.warehouses.find((w) => w.id === site0)?.name ?? "—";

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickProduct = (i: number, id: string) => {
    const c = cat.get(id);
    setLine(i, { product: id, ...(c && !lines[i].price && c.lastPrice !== null ? { price: raw(c.lastPrice) } : {}) });
    if (!supplierId && c?.lastSupplierId && view.suppliers.some((s) => s.id === c.lastSupplierId)) setSupplierId(c.lastSupplierId);
  };

  async function submit() {
    if (busy) return;
    setErr(null);
    if (!supplierId) return setErr(t("poD.needSupplier"));
    const filled = lines.filter((l) => l.product || l.qty);
    const bad = filled.some((l) => !l.product || !/^\d+$/.test(l.qty) || Number(l.qty) <= 0);
    if (!filled.length || bad) return setErr(t("poD.needLines"));
    setBusy(true);
    try {
      const out = await send("/api/purchases/orders", "POST", {
        supplier_id: supplierId,
        warehouse_id: site,
        wanted_by: wanted || null,
        lines: filled.map((l) => ({ product_id: l.product, variant_id: null, qty: Number(l.qty), unit_cost: parseAmount(l.price) })),
      });
      onDone(t("poD.done", { ref: String(out.reference ?? "") }));
    } catch (e) {
      setErr(t("writeError", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head lead={<span className="hold"><ShoppingCart className="ic" aria-hidden /></span>} id="dr-po" title={t("poD.title")} sub={marketName} onClose={onClose} t={t} />
      <div className="dr-b">
        {p0 && (sugg || qty0) && (
          <div className="from">
            <Layers className="ic" aria-hidden />
            <span>
              {sugg?.days != null
                ? t.rich("poD.from", { b, site: siteName, name: p0.name, days: sugg.days, qty: f.n(qty0 ?? 0) })
                : t.rich("poD.fromNoDays", { b, site: siteName, name: p0.name, qty: f.n(qty0 ?? 0) })}
            </span>
          </div>
        )}
        <div className="dr-sec">
          <h4><Store className="ic" aria-hidden />{t("poD.secSup")}</h4>
          <div className="fg">
            <div className="fld">
              <label htmlFor="po-sup">{t("poD.supplier")}</label>
              <select id="po-sup" className="inp" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t("poD.pick")}</option>
                {view.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.city ? `${s.name} · ${s.city}` : s.name}</option>
                ))}
              </select>
              {view.suppliers.length === 0 ? (
                <small>{t("poD.noSuppliers")}</small>
              ) : sup ? (
                <small>{sup.fillRate === null && sup.leadTimeDays === null ? t("poD.supHintNone") : t("poD.supHint", { d: sup.leadTimeDays === null ? "—" : t("sup.days", { n: sup.leadTimeDays }), f: sup.fillRate === null ? "—" : `${sup.fillRate} %` })}</small>
              ) : null}
            </div>
            <div className="two">
              <div className="fld">
                <span>{t("poD.site")}</span>
                <Seg<string> full label={t("poD.site")} value={site} onChange={setSite} options={view.warehouses.map((w) => ({ k: w.id, label: w.name }))} />
              </div>
              <div className="fld">
                <label htmlFor="po-date">{t("poD.wanted")}</label>
                <input id="po-date" type="date" className="inp" value={wanted} onChange={(e) => setWanted(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
        <div className="dr-sec">
          <h4><Boxes className="ic" aria-hidden />{t("poD.secLines")}</h4>
          <div className="fg">
            <div className="pl-r hd">
              <span>{t("poD.colProduct")}</span>
              <span className="e">{t("poD.colQty")}</span>
              <span className="e">{t("poD.colPrice")}</span>
              <span className="e">{t("poD.colTotal")}</span>
            </div>
            {lines.map((l, i) => {
              const q = l.qty ? Number.parseInt(l.qty, 10) : null;
              const pr = parseAmount(l.price);
              return (
                <div className="pl-r" key={i}>
                  <select className="inp" aria-label={`${t("poD.colProduct")} ${i + 1}`} value={l.product} onChange={(e) => pickProduct(i, e.target.value)}>
                    <option value="">{t("poD.pickProduct")}</option>
                    {view.catalogue.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div className="inp-u">
                    <input aria-label={`${t("poD.colQty")} ${i + 1}`} inputMode="numeric" placeholder="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^\d]/g, "") })} />
                  </div>
                  <div className="inp-u">
                    <input aria-label={`${t("poD.colPrice")} ${i + 1}`} inputMode="decimal" placeholder="—" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
                  </div>
                  <span className="t">
                    {q !== null && pr !== null ? f.n(q * pr) : "—"}
                    {lines.length > 1 && (
                      <button type="button" className="rm" aria-label={t("poD.removeLine")} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                        <Trash2 className="ic" aria-hidden />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            <button className="addl" type="button" onClick={() => setLines((ls) => [...ls, { product: "", qty: "", price: "" }])}>
              <Plus className="ic" aria-hidden />
              {t("poD.addLine")}
            </button>
            <div className="sums">
              <div className="tot"><span>{t("poD.total")}</span><b>{f.money(total)}</b></div>
            </div>
            <p className="cmp">{t("poD.priceHint")}</p>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
      <div className="dr-f">
        <button className="btn2" type="button" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void submit()}>
          <Check className="ic" aria-hidden />
          {t("poD.submit")}
        </button>
      </div>
    </>
  );
}

// ── Nouveau fournisseur ──────────────────────────────────────────────────────

export function SupplierDrawer({ marketId, marketName, t, onClose, onDone }: { marketId: string; marketName: string; t: T; onClose: () => void; onDone: (msg: string) => void }) {
  const [form, setForm] = useState({ name: "", city: "", phone: "", category: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((x) => ({ ...x, [k]: e.target.value }));

  async function submit() {
    if (busy) return;
    setErr(null);
    if (!form.name.trim()) return setErr(t("supD.needName"));
    setBusy(true);
    try {
      await send("/api/suppliers", "POST", { market_id: marketId, ...form });
      onDone(t("supD.done"));
    } catch (e) {
      setErr((e as { status?: number }).status === 409 ? t("supD.duplicate") : t("writeError", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head lead={<span className="hold"><Store className="ic" aria-hidden /></span>} id="dr-sup" title={t("supD.title")} sub={t("supD.sub", { market: marketName })} onClose={onClose} t={t} />
      <div className="dr-b">
        <div className="dr-sec">
          <h4><Store className="ic" aria-hidden />{t("supD.secWho")}</h4>
          <div className="fg">
            <div className="fld">
              <label htmlFor="ns-n">{t("supD.name")}</label>
              <input id="ns-n" className="inp" dir="auto" placeholder={t("supD.namePh")} value={form.name} onChange={set("name")} />
            </div>
            <div className="two">
              <div className="fld">
                <label htmlFor="ns-c">{t("supD.city")}</label>
                <input id="ns-c" className="inp" dir="auto" placeholder={t("supD.cityPh")} value={form.city} onChange={set("city")} />
              </div>
              <div className="fld">
                <label htmlFor="ns-p">{t("supD.phone")}</label>
                <input id="ns-p" className="inp" dir="ltr" placeholder="+218 …" value={form.phone} onChange={set("phone")} />
              </div>
            </div>
            <div className="fld">
              <label htmlFor="ns-k">{t("supD.category")}</label>
              <input id="ns-k" className="inp" dir="auto" placeholder={t("supD.categoryPh")} value={form.category} onChange={set("category")} />
            </div>
            <div className="fld">
              <label htmlFor="ns-note">{t("supD.note")}</label>
              <textarea id="ns-note" className="inp" value={form.note} onChange={set("note")} />
            </div>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
      <div className="dr-f">
        <button className="btn2" type="button" onClick={onClose}>{t("cancel")}</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void submit()}>
          <Check className="ic" aria-hidden />
          {t("supD.submit")}
        </button>
      </div>
    </>
  );
}
