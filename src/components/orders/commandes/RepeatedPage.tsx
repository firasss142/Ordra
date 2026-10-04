"use client";

// Commandes répétées — prototypes/commandes-v4.html, screen « Commandes répétées »:
// the same client, several orders. Four tiles (Répétées · En double · À risque ·
// Fidèles). « En double » is a one-screen cleanup — sure copies pre-ticked, one
// red button; the others are one client at a time: the list left, the client
// right (numbers, duplicates, the trail of every order, what is in progress).
// Agents read it; only managers delete or dismiss.

import "./commandes.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Locale, Role } from "@/types";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { useRejectionBadge } from "@/hooks/useRejectionBadge";
import { useMaxCallAttempts } from "@/hooks/useMaxCallAttempts";
import type { DuplicateGroup, DuplicateGroupMember } from "@/lib/duplicate-orders/groups";
import { FINAL_STATUSES, buildCases, copiesOf, keepOf, type RepeatCase, type RepeatCustomerRow, type RepeatOrder } from "@/lib/orders/repeat-customers";
import { SHIPPED_STATUSES } from "@/lib/orders/row-signals";
import { makeFmt, type Fmt } from "@/components/performance/orders/ui";
import { Ic, StatusPill, Thumb, spanWords, useTip, useWhen, type When } from "./ui";

const OrderDetailPanel = dynamic(() => import("@/components/queue/OrderDetailPanel").then((m) => m.OrderDetailPanel), { ssr: false });

type Tile = "rep" | "dup" | "risk" | "ok";
const TILES: { k: Tile; icon: string; hue: string; f: (c: RepeatCase) => boolean }[] = [
  { k: "rep", icon: "repeat", hue: "violet", f: (c) => c.orders.length >= 2 },
  { k: "dup", icon: "copy", hue: "blue", f: (c) => !!c.group },
  { k: "risk", icon: "alert", hue: "red", f: (c) => c.rel === "risk" },
  { k: "ok", icon: "star", hue: "green", f: (c) => c.rel === "ok" },
];
const REL: Record<RepeatCase["rel"], [string, string]> = { risk: ["red", "alert"], ok: ["green", "check"], mid: ["amber", "help"], new: ["neutral", "user"] };
/** Only a clear verdict gets a badge; an in-between record (« mid ») says nothing. */
const SHOWN_REL = new Set<RepeatCase["rel"]>(["risk", "ok"]);

export interface RepeatedPageProps {
  role: Role;
  userId: string;
  locale: Locale;
  userMarketId: string;
  initialMarketId: string;
  currencyCode: string;
}

interface DupResponse {
  groups: DuplicateGroup[];
  window_hours: number;
  autoselect_window_hours: number;
}

const byTime = <T extends { created_at: string }>(a: T, b: T) => Date.parse(a.created_at) - Date.parse(b.created_at);

function outcome(status: string): [string, string] {
  if (status === "delivered") return ["green", "delivered"];
  if (status === "rejected") return ["red", "rejected"];
  if (status === "returned") return ["red", "returned"];
  if (status === "cancelled") return ["neutral", "cancelled"];
  if (SHIPPED_STATUSES.has(status)) return ["teal", "road"];
  return ["violet", "live"];
}

const phoneText = (p: string) => {
  const d = p.replace(/\s/g, "");
  return d.length >= 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d;
};

export function RepeatedPage({ role, userId, locale, userMarketId, initialMarketId, currencyCode }: RepeatedPageProps) {
  const t = useTranslations("commandes");
  const tr = useTranslations("commandes.repeated");
  const router = useRouter();
  const search = useSearchParams();
  const canClean = role === "super_admin" || role === "market_manager";
  const { scope, marketId: scopeMarketId } = useMarketScope();
  const marketId = role === "super_admin" ? (scope === "all" ? initialMarketId || null : scopeMarketId) : userMarketId || null;

  const f = useMemo(() => makeFmt(locale === "ar" ? "ar" : "fr", currencyCode), [locale, currencyCode]);
  const when = useWhen(marketId, locale);
  const maxAttempts = useMaxCallAttempts(marketId);
  const rejection = useRejectionBadge(marketId);

  const { data: custData, error: custError, mutate: mutateCust } = useSWR<{ data: { customers: RepeatCustomerRow[]; days_back: number } }>(
    marketId ? `/api/orders/repeat-customers?market_id=${marketId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const { data: dupData, error: dupError, mutate: mutateDup } = useSWR<{ data: DupResponse }>(marketId ? `/api/orders/duplicates?market_id=${marketId}` : null, fetcher, {
    revalidateOnFocus: false,
  });
  const loading = !!marketId && (!custData || !dupData) && !custError && !dupError;
  const groups = useMemo(() => dupData?.data.groups ?? [], [dupData]);
  const cases = useMemo(() => buildCases(custData?.data.customers ?? [], groups), [custData, groups]);

  const [tile, setTile] = useState<Tile>(() => {
    const q = search?.get("f");
    return q === "dup" || q === "risk" || q === "ok" ? q : "rep";
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tile === "rep") url.searchParams.delete("f");
    else url.searchParams.set("f", tile);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [tile]);
  const [caseKey, setCaseKey] = useState<string | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [dsel, setDsel] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  // The high-confidence copies come pre-ticked — once per group, so an untick sticks.
  const seeded = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!canClean) return;
    const add: string[] = [];
    for (const g of groups) {
      if (seeded.current.has(g.key)) continue;
      seeded.current.add(g.key);
      if (g.confidence === "high") add.push(...copiesOf(g, keep).map((m) => m.id));
    }
    if (add.length) setDsel((p) => new Set([...p, ...add]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, canClean]);

  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((c) => (c === m ? null : c)), 3200);
  }, []);
  const fail = useCallback((m: string) => {
    setError(m);
    window.setTimeout(() => setError((c) => (c === m ? null : c)), 5000);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([mutateDup(), mutateCust()]);
  }, [mutateDup, mutateCust]);

  /** Delete the ticked copies of these groups, each against the order the group keeps. */
  const deleteCopies = useCallback(
    async (gs: DuplicateGroup[]) => {
      const pairs = gs.flatMap((g) => copiesOf(g, keep).filter((m) => dsel.has(m.id)).map((m) => ({ anchor_id: keepOf(g, keep), sibling_id: m.id })));
      if (!pairs.length) return;
      if (!window.confirm(tr("clean.confirm", { n: pairs.length }))) return;
      let ok = 0;
      let ko = 0;
      for (let i = 0; i < pairs.length; i += 100) {
        const res = await fetch("/api/orders/bulk-delete-duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairs: pairs.slice(i, i + 100) }) });
        const body = await res.json().catch(() => null);
        if (!res.ok) ko += pairs.slice(i, i + 100).length;
        else {
          ok += body?.data?.succeeded?.length ?? 0;
          ko += body?.data?.failed?.length ?? 0;
        }
      }
      setDsel((p) => new Set([...p].filter((id) => !pairs.some((x) => x.sibling_id === id))));
      if (ok) say(tr("clean.deleted", { n: ok }));
      if (ko) fail(tr("clean.deleteFailed", { n: ko }));
      await refresh();
    },
    [keep, dsel, tr, say, fail, refresh],
  );

  const dismiss = useCallback(
    async (g: DuplicateGroup) => {
      const res = await fetch("/api/orders/duplicates/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_ids: g.members.map((m) => m.id) }) });
      if (!res.ok) return fail(t("toast.error"));
      setDsel((p) => new Set([...p].filter((id) => !g.members.some((m) => m.id === id))));
      say(tr("clean.dismissed"));
      await refresh();
    },
    [fail, say, t, tr, refresh],
  );

  const pickKeep = useCallback(
    (g: DuplicateGroup, id: string) => {
      const old = keepOf(g, keep);
      setKeep((k) => ({ ...k, [g.key]: id }));
      setDsel((p) => {
        const n = new Set(p);
        n.delete(id);
        const oldM = g.members.find((m) => m.id === old);
        if (oldM && !oldM.already_shipped && oldM.deletable) n.add(old);
        return n;
      });
    },
    [keep],
  );
  const tick = useCallback((id: string) => setDsel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const T = TILES.find((x) => x.k === tile)!;
  const shown = useMemo(() => cases.filter(T.f), [cases, T]);
  const sel = shown.find((c) => c.key === caseKey) ?? shown[0] ?? null;
  const tip = useTip();
  const daysBack = custData?.data.days_back ?? 90;
  const fallbackOpen = null;

  const ctx: Ctx = { t, tr, f, when, maxAttempts, rejection, keep, dsel, canClean, tick, pickKeep, open: setOpenId, dismiss, deleteCopies, autoselectHours: dupData?.data.autoselect_window_hours ?? 1 };

  return (
    <div className="cmd cmd-page" onMouseOver={tip.onOver} onMouseMove={tip.onMove} onMouseLeave={tip.onLeave}>
      <div className="page">
        <header className="ph">
          <div>
            <h1>{tr("title")}</h1>
            <div className="sub">
              <span>{tr("sub")}</span>
              <span className="sep" />
              <span>{tr("scope", { n: daysBack })}</span>
            </div>
          </div>
        </header>

        <section className="wts">
          {TILES.map((x) => {
            const n = cases.filter(x.f).length;
            const on = tile === x.k;
            return (
              <button
                key={x.k}
                type="button"
                className={`wt h-${x.hue}${on ? " on" : ""}${n ? "" : " zero"}`}
                aria-pressed={on}
                onClick={() => {
                  setTile(x.k);
                  setCaseKey(null);
                }}
              >
                <span className="hold">
                  <Ic n={x.icon} />
                </span>
                <span className="wt-t">
                  <b>{loading ? "—" : f.n(n)}</b>
                  <span>{tr(`tiles.${x.k}`)}</span>
                  <small>{tr(`tiles.${x.k}Hint`)}</small>
                </span>
              </button>
            );
          })}
        </section>

        {(custError || dupError) && <div className="err">{tr("error")}</div>}
        {error && (
          <div className="err" role="alert">
            {error}
          </div>
        )}
        {!canClean && <div className="note h-neutral">{tr("clean.readOnly")}</div>}

        {loading ? (
          <div className="sk" style={{ height: 420 }} aria-busy="true" />
        ) : tile === "dup" ? (
          <CleanView groups={cases.filter((c) => c.group).map((c) => c.group!)} cases={cases} ctx={ctx} />
        ) : (
          <div className="md">
            <aside className="mlist">
              <div className="mlh">{tr("listHead", { n: shown.length })}</div>
              <div className="mrows">
                {shown.length ? (
                  shown.map((c) => <CaseRow key={c.key} c={c} on={sel?.key === c.key} onPick={() => setCaseKey(c.key)} ctx={ctx} />)
                ) : (
                  <div className="empty">
                    <Ic n="check" />
                    <span>{tr("nobody")}</span>
                  </div>
                )}
              </div>
            </aside>
            {sel ? (
              <CaseDetail c={sel} ctx={ctx} onList={() => router.push(`/${locale}/orders?q=${encodeURIComponent(sel.phone)}`)} />
            ) : (
              <section className="cd">
                <div className="empty">
                  <Ic n="user" />
                  <span>{tr("pick")}</span>
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <OrderDetailPanel
        key={openId ?? "none"}
        orderId={openId}
        fallbackOrder={fallbackOpen}
        role={role}
        userId={userId}
        onClose={() => setOpenId(null)}
        onCallTerminated={() => {
          setOpenId(null);
          void refresh();
        }}
      />

      {toast && (
        <div className="tip on" role="status" style={{ left: "50%", top: 64, transform: "translateX(-50%)" }}>
          → {toast}
        </div>
      )}
      <div className="tip" ref={tip.ref} />
    </div>
  );
}

interface Ctx {
  t: ReturnType<typeof useTranslations>;
  tr: ReturnType<typeof useTranslations>;
  f: Fmt;
  when: When;
  maxAttempts: number | null;
  rejection: ReturnType<typeof useRejectionBadge>;
  keep: Record<string, string>;
  dsel: Set<string>;
  canClean: boolean;
  tick: (id: string) => void;
  pickKeep: (g: DuplicateGroup, id: string) => void;
  open: (id: string) => void;
  dismiss: (g: DuplicateGroup) => Promise<void>;
  deleteCopies: (gs: DuplicateGroup[]) => Promise<void>;
  autoselectHours: number;
}

function diffs(g: DuplicateGroup, tr: Ctx["tr"]): string[] {
  const out: string[] = [];
  if (!g.address_matches) out.push(tr("diffAddr"));
  if (new Set(g.members.map((m) => m.product_id ?? m.product_name)).size > 1) out.push(tr("diffProd"));
  return out;
}
const sameProducts = (g: DuplicateGroup) => new Set(g.members.map((m) => m.product_id ?? m.product_name)).size <= 1;

// ── one client in the list ──────────────────────────────────────────────────

function CaseRow({ c, on, onPick, ctx }: { c: RepeatCase; on: boolean; onPick: () => void; ctx: Ctx }) {
  const { tr, when, t } = ctx;
  const [hue] = REL[c.rel];
  const sum = c.group ? tr("inSpan", { n: c.group.members.length, span: spanWords(t, c.group.span_minutes) }) : tr("summary", { n: c.orders.length, d: c.delivered });
  return (
    <button type="button" className={`cr${on ? " on" : ""}`} aria-current={on} onClick={onPick}>
      <span className="gav">{c.name.slice(0, 1)}</span>
      <span className="cr-t">
        <b>
          <span dir="auto">{c.name}</span>
        </b>
        <small>
          {sum} · {when(c.lastAt)}
        </small>
        <span className="dots">
          {c.orders.map((o) => (
            <i key={o.id} className={`h-${outcome(o.status)[0]}${FINAL_STATUSES.has(o.status) ? "" : " now"}`} />
          ))}
        </span>
      </span>
      <span className="cr-b">
        {c.group && (
          <span className={`mc h-${c.group.members.some((m) => m.already_shipped) ? "red" : "blue"}`}>
            <Ic n="copy" />×{c.group.members.length}
          </span>
        )}
        {SHOWN_REL.has(c.rel) && <span className={`mc h-${hue}`}>{tr(`rel.${c.rel}`)}</span>}
      </span>
    </button>
  );
}

// ── one client, right ───────────────────────────────────────────────────────

function CaseDetail({ c, ctx, onList }: { c: RepeatCase; ctx: Ctx; onList: () => void }) {
  const { tr, f, when } = ctx;
  const [hue, icon] = REL[c.rel];
  const groupIds = new Set(c.group?.members.map((m) => m.id) ?? []);
  const live = c.orders.filter((o) => !FINAL_STATUSES.has(o.status) && !groupIds.has(o.id));
  const done = c.orders.filter((o) => FINAL_STATUSES.has(o.status)).length;
  const paid = c.orders.filter((o) => o.status === "delivered").reduce((a, o) => a + Number(o.total_price ?? 0), 0);
  return (
    <section className="cd">
      <header className="cdh">
        <span className="gav big">{c.name.slice(0, 1)}</span>
        <div className="gt">
          <h2>
            <span dir="auto">{c.name}</span>
          </h2>
          <small>
            <span className="num">{phoneText(c.phone)}</span>
            {c.city ? ` · ${c.city}` : ""}
            {c.address ? (
              <>
                {" · "}
                <span dir="auto">{c.address}</span>
              </>
            ) : null}
          </small>
        </div>
        {c.rel !== "mid" && (
          <span className={`conf h-${hue}`}>
            <Ic n={icon} />
            {tr(`rel.${c.rel}`)}
          </span>
        )}
        <span className="sp" />
        <button type="button" className="btn2" onClick={onList}>
          <Ic n="search" />
          {tr("seeInList")}
        </button>
      </header>
      {c.rel === "new" ? (
        <p className="shh">{tr("firstTime")}</p>
      ) : (
        <div className="kpis">
          <div>
            <b>{f.n(c.orders.length)}</b>
            <span>{tr("kpi.orders")}</span>
          </div>
          <div className="g">
            <b>{f.n(c.delivered)}</b>
            <span>{tr("kpi.delivered", { n: c.delivered })}</span>
          </div>
          <div className="r">
            <b>{f.n(c.bad)}</b>
            <span>{tr("kpi.lost")}</span>
          </div>
          <div>
            <b>{f.n(paid)}</b>
            <span>{tr("kpi.paid", { ccy: f.sym })}</span>
          </div>
        </div>
      )}
      {c.rel === "risk" && (
        <div className="note h-red" style={{ margin: "0 18px 6px" }}>
          <Ic n="alert" />
          <span>{tr("riskNote", { bad: c.bad, done })}</span>
        </div>
      )}
      {c.group && <DupBlock g={c.group} ctx={ctx} />}
      <div className="blk">
        <div className="sh">
          <Ic n="route" />
          {tr("trail")}
          <span className="shm">{tr("trailHint")}</span>
        </div>
        <div className="trail">
          {c.orders.map((o, i) => {
            const [h, k] = outcome(o.status);
            return (
              <span key={o.id} style={{ display: "contents" }}>
                {i > 0 && <span className="link" />}
                <button
                  type="button"
                  className={`stop h-${h}${FINAL_STATUSES.has(o.status) ? "" : " now"}`}
                  data-tip={`#${o.external_id ?? o.id.slice(0, 8)} · ${o.product_name ?? ""} · ${f.money(Number(o.total_price ?? 0))} · ${when(o.created_at)}`}
                  onClick={() => ctx.open(o.id)}
                >
                  <i />
                  <span>
                    {tr(`outcome.${k}`)} · {f.day(o.created_at.slice(0, 10))}
                  </span>
                </button>
              </span>
            );
          })}
        </div>
      </div>
      {live.length > 0 && (
        <div className="blk">
          <div className="sh">
            <Ic n="clock" />
            {tr("live")}
          </div>
          <div className="cps">
            {live.map((o) => (
              <LiveRow key={o.id} o={o} ctx={ctx} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function LiveRow({ o, ctx }: { o: RepeatOrder; ctx: Ctx }) {
  return (
    <div className="cp" role="button" tabIndex={0} onClick={() => ctx.open(o.id)}>
      <span className="locked">#{o.external_id ?? o.id.slice(0, 8)}</span>
      <span className="tm">{ctx.when(o.created_at)}</span>
      <span className="pr">
        <Thumb src={o.product_image_url} seed={o.product_id ?? o.product_name ?? o.id} />
        <span dir="auto">
          {o.product_name}
          {o.quantity > 1 ? ` ×${o.quantity}` : ""}
        </span>
      </span>
      <span>
        <StatusPill o={o} maxAttempts={ctx.maxAttempts} rejection={ctx.rejection} when={ctx.when} />
      </span>
      <span className="amt">
        {ctx.f.n(Number(o.total_price ?? 0))}
        <small>{ctx.f.sym}</small>
      </span>
      <span />
    </div>
  );
}

/** The duplicate block inside one client (prototype `caseDetail` › dup, `cpHTML`). */
function DupBlock({ g, ctx }: { g: DuplicateGroup; ctx: Ctx }) {
  const { tr, t } = ctx;
  const k = keepOf(g, ctx.keep);
  const dels = copiesOf(g, ctx.keep).filter((m) => ctx.dsel.has(m.id)).length;
  const d = diffs(g, tr);
  return (
    <div className="blk dupblk">
      <div className="sh">
        <Ic n="copy" />
        {tr("dupBlock")}
        <span className={`conf h-${g.confidence === "high" ? "green" : "amber"}`}>{g.confidence === "high" ? tr("high") : tr("review")}</span>
        <span className="shm">{tr("inSpan", { n: g.members.length, span: spanWords(t, g.span_minutes) })}</span>
        {d.map((x) => (
          <span key={x} className="diff">
            <Ic n="alert" />
            {x}
          </span>
        ))}
      </div>
      <p className="shh">{g.confidence === "high" ? tr("highNote") : tr("reviewNote")}</p>
      <div className="cps">
        {[...g.members].sort(byTime).map((m) => (
          <CopyRow key={m.id} g={g} m={m} keepId={k} ctx={ctx} />
        ))}
      </div>
      {ctx.canClean && (
        <footer className="gf">
          {!sameProducts(g) && (
            <button type="button" className="btn2" onClick={() => ctx.open(k)}>
              <Ic n="merge" />
              {tr("merge")}
            </button>
          )}
          <button type="button" className="btn2 neg" disabled={!dels} onClick={() => void ctx.deleteCopies([g])}>
            <Ic n="trash" />
            {tr("deleteN", { n: dels })}
          </button>
        </footer>
      )}
    </div>
  );
}

function CopyRow({ g, m, keepId, ctx }: { g: DuplicateGroup; m: DuplicateGroupMember; keepId: string; ctx: Ctx }) {
  const { tr } = ctx;
  const isKeep = m.id === keepId;
  const locked = m.already_shipped || !m.deletable;
  const on = ctx.dsel.has(m.id);
  const ctl = isKeep ? (
    <span className="keep">
      <Ic n="star" />
      {tr("keep")}
    </span>
  ) : locked ? (
    <span className="locked" data-tip={tr("shippedTip")}>
      <Ic n="lock" />
      {tr("shipped")}
    </span>
  ) : ctx.canClean ? (
    <button
      type="button"
      className={`dk${on ? " on" : ""}`}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        ctx.tick(m.id);
      }}
    >
      <span className={`ck${on ? " on" : ""}`}>{on && <Ic n="check" />}</span>
      {tr("delete")}
    </button>
  ) : (
    <span />
  );
  const shippedGroup = g.members.some((x) => x.already_shipped);
  return (
    <div className={`cp${isKeep ? " kept" : ""}`} role="button" tabIndex={0} onClick={() => ctx.open(m.id)}>
      {ctl}
      <span className="tm">{ctx.when(m.created_at)}</span>
      <span className="pr">
        <Thumb src={m.product_image_url} seed={m.product_id ?? m.product_name ?? m.id} />
        <span dir="auto">
          {m.product_name}
          {m.quantity > 1 ? ` ×${m.quantity}` : ""}
        </span>
      </span>
      <span>
        <StatusPill o={m} maxAttempts={ctx.maxAttempts} rejection={ctx.rejection} when={ctx.when} />
      </span>
      <span className="amt">
        {ctx.f.n(Number(m.total_price ?? 0))}
        <small>{ctx.f.sym}</small>
      </span>
      {ctx.canClean && !isKeep && !(shippedGroup && !m.already_shipped) && !locked ? (
        <button
          type="button"
          className="mk"
          data-tip={tr("keepInstead")}
          onClick={(e) => {
            e.stopPropagation();
            ctx.pickKeep(g, m.id);
          }}
        >
          <Ic n="star" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// ── « En double » — the cleanup ─────────────────────────────────────────────

function CleanView({ groups, cases, ctx }: { groups: DuplicateGroup[]; cases: RepeatCase[]; ctx: Ctx }) {
  const { tr, f } = ctx;
  if (!groups.length) {
    return (
      <section className="cd">
        <div className="empty">
          <Ic n="check" />
          <b>{tr("clean.allClean")}</b>
          <span>{tr("clean.whereDeleted")}</span>
        </div>
      </section>
    );
  }
  const sure = groups.filter((g) => g.confidence === "high");
  const check = groups.filter((g) => g.confidence !== "high");
  const all = groups.flatMap((g) => copiesOf(g, ctx.keep));
  const ticked = all.filter((m) => ctx.dsel.has(m.id));
  const value = ticked.reduce((a, m) => a + Number(m.total_price ?? 0), 0);
  const nameOf = (g: DuplicateGroup) => cases.find((c) => c.group === g);
  return (
    <>
      <section className="hero">
        <div className="hero-n">
          <b>{ticked.length}</b>
          <div>
            <strong>{tr("clean.ticked", { n: ticked.length, all: all.length })}</strong>
            <span>
              {tr("clean.keepRule")} {value ? tr("clean.value", { value: f.money(value) }) : ""}
            </span>
          </div>
        </div>
        {ctx.canClean && (
          <div className="hero-a">
            {all.length === 0 ? null : ticked.length < all.length ? (
              <button type="button" className="btn2" onClick={() => all.forEach((m) => !ctx.dsel.has(m.id) && ctx.tick(m.id))}>
                {tr("clean.tickAll")}
              </button>
            ) : (
              <button type="button" className="btn2" onClick={() => ticked.forEach((m) => ctx.tick(m.id))}>
                {tr("clean.untickAll")}
              </button>
            )}
            <button type="button" className="btn big" disabled={!ticked.length} onClick={() => void ctx.deleteCopies(groups)}>
              <Ic n="trash" />
              {tr("deleteN", { n: ticked.length })}
            </button>
          </div>
        )}
      </section>
      {sure.length > 0 && (
        <section className="dgs">
          <div className="sh">
            <Ic n="check" />
            {tr("clean.sure")}
            <span className="conf h-green">{sure.length}</span>
            <span className="shm">{tr("clean.sureHint", { h: ctx.autoselectHours })}</span>
          </div>
          {sure.map((g) => (
            <DupLine key={g.key} g={g} c={nameOf(g)} ctx={ctx} />
          ))}
        </section>
      )}
      {check.length > 0 && (
        <section className="dgs">
          <div className="sh">
            <Ic n="help" />
            {tr("clean.check")}
            <span className="conf h-amber">{check.length}</span>
            <span className="shm">{tr("clean.checkHint")}</span>
          </div>
          {check.map((g) => (
            <DupLine key={g.key} g={g} c={nameOf(g)} ctx={ctx} />
          ))}
        </section>
      )}
    </>
  );
}

function DupLine({ g, c, ctx }: { g: DuplicateGroup; c: RepeatCase | undefined; ctx: Ctx }) {
  const { tr, t } = ctx;
  const members = [...g.members].sort(byTime);
  const left = copiesOf(g, ctx.keep);
  const on = left.filter((m) => ctx.dsel.has(m.id)).length;
  const d = diffs(g, tr);
  const name = c?.name ?? members[0].customer_name ?? "—";
  const phone = c?.phone ?? g.key.split("|")[0];
  return (
    <div className="dg">
      <div className="dg-c">
        <b>
          <span dir="auto">{name}</span>
        </b>
        <small>
          <span className="num">{phoneText(phone)}</span> · {tr("inSpan", { n: g.members.length, span: spanWords(t, g.span_minutes) })}
        </small>
        {d.length > 0 && (
          <span className="diff">
            <Ic n="alert" />
            {d.join(" · ")}
          </span>
        )}
      </div>
      <div className="copies">
        {members.map((m) => (
          <CopyCard key={m.id} g={g} m={m} ctx={ctx} />
        ))}
      </div>
      {ctx.canClean && (
        <div className="dg-a">
          {g.confidence !== "high" && on < left.length && (
            <button type="button" className="btn2" onClick={() => left.forEach((m) => !ctx.dsel.has(m.id) && ctx.tick(m.id))}>
              <Ic n="check" />
              {tr("clean.isDup")}
            </button>
          )}
          {g.confidence !== "high" && !sameProducts(g) && (
            <button type="button" className="btn2" onClick={() => ctx.open(keepOf(g, ctx.keep))}>
              <Ic n="merge" />
              {tr("clean.merge")}
            </button>
          )}
          <button type="button" className="lnkb" onClick={() => void ctx.dismiss(g)}>
            {tr("clean.notDup")}
          </button>
        </div>
      )}
    </div>
  );
}

function CopyCard({ g, m, ctx }: { g: DuplicateGroup; m: DuplicateGroupMember; ctx: Ctx }) {
  const { tr, f } = ctx;
  const kp = keepOf(g, ctx.keep) === m.id;
  const sh = !kp && (m.already_shipped || !m.deletable);
  const on = ctx.dsel.has(m.id);
  const pickable = !kp && !sh && ctx.canClean;
  const label = kp ? (
    <span className="cl k">
      <Ic n="star" />
      {tr("clean.kept")}
    </span>
  ) : sh ? (
    <span className="cl s">
      <Ic n="lock" />
      {tr("clean.alreadySent")}
    </span>
  ) : on ? (
    <span className="cl d">
      <span className="ck on">
        <Ic n="check" />
      </span>
      {tr("clean.toDelete")}
    </span>
  ) : (
    <span className="cl n">
      <span className="ck" />
      {tr("clean.alsoKept")}
    </span>
  );
  return (
    <div
      className={`cpy${kp ? " k" : sh ? " s" : on ? " d" : ""}`}
      role={pickable ? "checkbox" : undefined}
      aria-checked={pickable ? on : undefined}
      tabIndex={pickable ? 0 : undefined}
      onClick={() => pickable && ctx.tick(m.id)}
      onKeyDown={(e) => {
        if (pickable && (e.key === " " || e.key === "Enter") && e.target === e.currentTarget) {
          e.preventDefault();
          ctx.tick(m.id);
        }
      }}
    >
      <div className="cpy-h">
        {label}
        <span className="tm">{ctx.when(m.created_at)}</span>
        {pickable && (
          <button
            type="button"
            className="mk"
            data-tip={tr("keepInstead")}
            onClick={(e) => {
              e.stopPropagation();
              ctx.pickKeep(g, m.id);
            }}
          >
            <Ic n="star" />
          </button>
        )}
        <button
          type="button"
          className="mk"
          data-tip={tr("clean.openOrder")}
          onClick={(e) => {
            e.stopPropagation();
            ctx.open(m.id);
          }}
        >
          <Ic n="ext" className="flip" />
        </button>
      </div>
      <div className="what">
        <span dir="auto">
          {m.product_name}
          {m.quantity > 1 ? ` ×${m.quantity}` : ""}
        </span>
        <b>
          {f.n(Number(m.total_price ?? 0))} <small>{f.sym}</small>
        </b>
      </div>
      <div className="cpy-f">
        <StatusPill o={m} maxAttempts={ctx.maxAttempts} rejection={ctx.rejection} when={ctx.when} />
        {m.customer_address && (
          <span className="q" dir="auto">
            {m.customer_address}
          </span>
        )}
      </div>
    </div>
  );
}
