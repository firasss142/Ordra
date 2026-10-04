"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, Plus, Search, TriangleAlert, Warehouse } from "lucide-react";
import type { ProjectedReception } from "@/lib/receptions/project";
import {
  pickEntries,
  type PickEntry,
  type SearchableProduct,
} from "./ProductSearchPanel";

/**
 * LE QUAI — maquette v4 §2.
 *
 * DEUX CHAMPS : le produit et la quantité. Le bâtiment vient de l'agent, le
 * marché du bâtiment, le jour de la base, et le document se trouve ou se crée
 * tout seul. Un agent debout devant une palette n'a ni fournisseur, ni
 * référence, ni date à saisir — c'est exactement la paperasse qui a arrêté à
 * zéro ligne la seule réception jamais créée en production.
 *
 * AVEUGLE PAR CONSTRUCTION. Cette surface n'affiche ni prix, ni fournisseur, ni
 * quantité attendue. Il n'y a aucune ancre à retirer, donc aucune à remettre un
 * jour par commodité.
 *
 * LE STOCK ENTRE ICI, et l'écran le prouve : après chaque arrivage il montre les
 * trois chiffres qui ont changé — le bâtiment, le total du marché, le non
 * ventilé. C'est la seule version honnête : à ce moment-là, le carton EST au sol.
 */

type Screen = "list" | "pick" | "qty" | "done" | "correct";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Moved {
  label: string;
  qty: number;
  productTotal: number | null;
  siteTotal: number | null;
  /**
   * Ce qui était commandé pour cet article dans ce bâtiment. `null` quand rien
   * ne l'était — l'écran se tait alors, au lieu de reprocher un écart contre un
   * plan inexistant. Ne peut PAS être lu avant : la RLS de `purchase_orders`
   * est fermée au quai, et ce chiffre arrive par la valeur de retour de la RPC.
   */
  ordered: number | null;
  /** Le cumul de la ligne après ce comptage, tel que la base le voit. */
  counted: number | null;
}

export function ReceptionDockFlow({
  reception,
  warehouseId,
  marketId,
  warehouseName,
  onClose,
  onChanged,
}: {
  /** Le groupe ouvert du jour. `null` tant que rien n'est arrivé. */
  reception: ProjectedReception | null;
  warehouseId: string;
  marketId: string | null;
  warehouseName: string | null;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations("warehouse.receptions");
  const [screen, setScreen] = useState<Screen>("list");
  const [query, setQuery] = useState("");
  const [entry, setEntry] = useState<PickEntry | null>(null);
  const [typed, setTyped] = useState("");
  const [damaged, setDamaged] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [correcting, setCorrecting] = useState<ProjectedReception["lines"][number] | null>(null);

  const trimmed = query.trim();
  const { data: catalogue } = useSWR<{ data: SearchableProduct[] }>(
    marketId && screen === "pick"
      ? `/api/products/search?market_id=${marketId}${trimmed.length >= 2 ? `&q=${encodeURIComponent(trimmed)}` : ""}`
      : null,
    fetcher,
    { keepPreviousData: true },
  );

  const results = useMemo(() => catalogue?.data ?? [], [catalogue]);
  const entries = useMemo(() => pickEntries(results), [results]);

  const lines = reception?.lines ?? [];
  const unitsToday = lines.reduce((a, l) => a + (l.received_qty ?? 0), 0);

  function back() {
    setError(null);
    if (screen === "pick") setScreen("list");
    else if (screen === "qty") setScreen("pick");
    else if (screen === "correct") setScreen("list");
    else onClose();
  }

  function digit(d: string) {
    setTyped((prev) => (prev === "0" ? d : `${prev}${d}`).slice(0, 6));
  }

  async function submitArrival() {
    const qty = Number.parseInt(typed, 10);
    if (!entry || !Number.isInteger(qty) || qty <= 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/arrivals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: entry.product.id,
          variant_id: entry.variant?.id ?? null,
          qty,
          damaged_qty: damaged,
          warehouse_id: warehouseId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        product_total?: number;
        site_total?: number;
        ordered?: number | null;
        counted?: number | null;
      };
      if (!res.ok) {
        setError(body.error ?? String(res.status));
        return;
      }
      setMoved({
        label: entry.variant ? `${entry.product.name} · ${entry.variant.label}` : entry.product.name,
        qty,
        productTotal: body.product_total ?? null,
        siteTotal: body.site_total ?? null,
        ordered: body.ordered ?? null,
        counted: body.counted ?? null,
      });
      await onChanged();
      setScreen("done");
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection() {
    const qty = Number.parseInt(typed, 10);
    if (!correcting || !Number.isInteger(qty) || qty < 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/arrivals/${correcting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? String(res.status));
        return;
      }
      await onChanged();
      setCorrecting(null);
      setScreen("list");
    } finally {
      setBusy(false);
    }
  }

  const header = (title: string, sub?: string | null) => (
    <header className="flex flex-none items-center gap-2.5 border-b border-wh-border bg-wh-surface px-3.5 py-3">
      <button
        type="button"
        aria-label={t("back")}
        onClick={back}
        className="grid h-9 w-9 flex-none place-items-center rounded-[8px] bg-wh-job-receive-bg text-wh-job-receive-ink"
      >
        {screen === "list" ? <Warehouse size={17} /> : <ChevronLeft size={18} className="rtl:-scale-x-100" />}
      </button>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-bold leading-tight">{title}</div>
        {sub ? <div className="truncate text-[11.5px] text-wh-ink-3">{sub}</div> : null}
      </div>
    </header>
  );

  const errorBar = error ? (
    <p className="mx-3 mb-2 rounded-[8px] border border-wh-bad-edge bg-wh-bad-bg px-3 py-2 text-[12.5px] font-medium text-wh-bad">
      {error}
    </p>
  ) : null;

  /* ── A · Les arrivages du jour ─────────────────────────────────────────── */
  if (screen === "list") {
    return (
      <Shell>
        {header(t("dockTitle"), warehouseName)}
        <div className="flex-1 overflow-auto p-3">
          <div className="mb-2.5 flex items-baseline justify-between gap-3 rounded-[10px] border border-wh-border bg-wh-surface px-3.5 py-3">
            <span className="text-[12px] font-semibold text-wh-ink-2">{t("dockEnteredToday")}</span>
            <span className="font-mono text-[20px] font-bold tabular-nums">{unitsToday}</span>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-wh-border-strong px-3.5 py-6 text-center text-[12.5px] text-wh-ink-3">
              {t("dockEmpty")}
            </p>
          ) : (
            lines.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setCorrecting(l);
                  setTyped(String(l.received_qty ?? 0));
                  setScreen("correct");
                }}
                className="mb-2 flex w-full items-center gap-3 rounded-[10px] border border-wh-border bg-wh-surface px-3 py-2.5 text-start"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold" dir="auto">
                    {l.product_name}
                    {l.variant_label ? (
                      <span className="ms-1.5 rounded-[4px] border border-wh-border bg-wh-sunken px-1.5 py-px text-[10.5px] font-semibold text-wh-ink-2">
                        {l.variant_label}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-wh-ink-3">
                    {l.product_sku ?? ""}
                    {l.damaged_qty > 0 ? ` · ${t("dockDamagedCount", { count: l.damaged_qty })}` : ""}
                  </span>
                </span>
                <span className="flex-none text-end">
                  <span className="block font-mono text-[17px] font-bold tabular-nums">
                    {l.received_qty ?? 0}
                  </span>
                </span>
              </button>
            ))
          )}

          {/* La surface du quai n'a rien d'autre à montrer, et le dit. */}
          <p className="mt-3 flex items-start gap-2 rounded-[8px] border border-dashed border-wh-border-strong px-3 py-2.5 text-[11.5px] text-wh-ink-3">
            <TriangleAlert size={14} className="mt-px flex-none" />
            {t("dockBlindNote")}
          </p>
        </div>
        {errorBar}
        <footer className="flex-none border-t border-wh-border bg-wh-surface p-3">
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setScreen("pick");
            }}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-wh-ok text-[15px] font-bold text-white"
          >
            <Plus size={19} strokeWidth={2.6} />
            {t("dockAddArrival")}
          </button>
        </footer>
      </Shell>
    );
  }

  /* ── B · Choisir le produit ────────────────────────────────────────────── */
  if (screen === "pick") {
    return (
      <Shell>
        {header(t("dockWhatArrived"), warehouseName)}
        <div className="flex-1 overflow-auto p-3">
          <div className="mb-2.5 flex items-center gap-2.5 rounded-[10px] border border-wh-ok bg-wh-surface px-3 py-2.5 shadow-[0_0_0_3px_rgba(21,128,61,.16)]">
            <Search size={16} className="flex-none text-wh-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchProduct")}
              dir="auto"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
            />
          </div>

          <ul className="overflow-hidden rounded-[10px] border border-wh-border bg-wh-surface">
            {entries.length === 0 ? (
              <li className="px-3 py-6 text-center text-[12.5px] text-wh-ink-3">{t("noResults")}</li>
            ) : (
              entries.map((e) => (
                <li key={e.key} className="border-b border-wh-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEntry(e);
                      setTyped("");
                      setDamaged(0);
                      setScreen("qty");
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-start"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold" dir="auto">
                        {e.label}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-wh-ink-3">
                        {e.variant ? e.product.name : (e.product.sku ?? "")}
                      </span>
                    </span>
                    <span className="flex-none font-mono text-[12.5px] font-semibold tabular-nums text-wh-ink-2">
                      {e.stock}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {/* Le grain où vit le stock, dit une fois. */}
          <p className="mt-3 rounded-[8px] border border-dashed border-wh-border-strong px-3 py-2.5 text-[11.5px] text-wh-ink-3">
            {t("dockVariantNote")}
          </p>
        </div>
      </Shell>
    );
  }

  /* ── C/E · La quantité (arrivage ou correction) ────────────────────────── */
  if (screen === "qty" || screen === "correct") {
    const isCorrection = screen === "correct";
    const title = isCorrection ? t("dockCorrectCount") : t("dockHowMany");
    const name = isCorrection
      ? `${correcting?.product_name ?? ""}${correcting?.variant_label ? ` · ${correcting.variant_label}` : ""}`
      : (entry?.label ?? "");

    return (
      <Shell>
        {header(title, name)}
        <div className="flex-1 overflow-auto p-3">
          {isCorrection && correcting ? (
            <div className="mb-3 overflow-hidden rounded-[10px] border border-wh-border bg-wh-surface">
              <div className="flex justify-between border-b border-wh-border px-3 py-2 text-[12.5px]">
                <span className="text-wh-ink-2">{t("dockCountedBefore")}</span>
                <span className="font-mono font-bold">{correcting.received_qty ?? 0}</span>
              </div>
              <div className="flex justify-between bg-wh-warn-bg px-3 py-2 text-[12.5px]">
                <span className="font-semibold text-wh-warn">{t("dockWrittenToLedger")}</span>
                <span className="font-mono font-bold text-wh-warn">
                  {(() => {
                    const d = (Number.parseInt(typed, 10) || 0) - (correcting.received_qty ?? 0);
                    return d > 0 ? `+${d}` : String(d);
                  })()}
                </span>
              </div>
            </div>
          ) : null}

          <div className="py-3 text-center">
            <div className="font-mono text-[52px] font-bold leading-none tracking-tight">
              {typed === "" ? <span className="text-wh-ink-3">0</span> : typed}
            </div>
            <div className="mt-1 text-[11.5px] font-semibold text-wh-ink-3">{t("dockUnits")}</div>
          </div>

          {/*
           * LE PAVÉ NE SE MIROITE PAS. En RTL le texte s'inverse, mais un clavier
           * de chiffres reste 1-2-3 — c'est la règle de tous les claviers
           * téléphoniques, y compris sur un appareil en arabe.
           */}
          <div className="grid grid-cols-3 gap-2" dir="ltr">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => digit(d)}
                className="grid min-h-[52px] place-items-center rounded-[10px] border border-wh-border bg-wh-surface font-mono text-[20px] font-semibold"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTyped("")}
              className="grid min-h-[52px] place-items-center rounded-[10px] border border-wh-border bg-wh-sunken text-[16px] font-semibold"
            >
              C
            </button>
            <button
              type="button"
              onClick={() => digit("0")}
              className="grid min-h-[52px] place-items-center rounded-[10px] border border-wh-border bg-wh-surface font-mono text-[20px] font-semibold"
            >
              0
            </button>
            <button
              type="button"
              aria-label={t("dockBackspace")}
              onClick={() => setTyped((p) => p.slice(0, -1))}
              className="grid min-h-[52px] place-items-center rounded-[10px] border border-wh-border bg-wh-sunken text-[16px]"
            >
              ⌫
            </button>
          </div>

          {/*
           * L'AVARIE EST UN GESTE, PAS UN CHAMP. Elle n'arrive presque jamais ;
           * un encadré ambre sur chaque arrivage finirait par ne plus rien
           * signaler. Et les unités abîmées N'ENTRENT PAS en stock : elles
           * n'étaient jamais vendables et ne sont pas à nous.
           */}
          {!isCorrection ? (
            <button
              type="button"
              onClick={() => setDamaged((d) => (d === 0 ? 1 : 0))}
              aria-pressed={damaged > 0}
              className={`mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] border border-dashed text-[12.5px] font-semibold ${
                damaged > 0
                  ? "border-wh-warn bg-wh-warn-bg text-wh-warn"
                  : "border-wh-warn-edge bg-wh-surface text-wh-warn"
              }`}
            >
              <TriangleAlert size={15} />
              {damaged > 0 ? t("dockDamagedCount", { count: damaged }) : t("dockReportDamaged")}
            </button>
          ) : null}
        </div>
        {errorBar}
        <footer className="flex-none border-t border-wh-border bg-wh-surface p-3">
          <button
            type="button"
            disabled={busy || typed === ""}
            onClick={() => void (isCorrection ? submitCorrection() : submitArrival())}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-wh-ok text-[15px] font-bold text-white disabled:opacity-50"
          >
            <Check size={18} strokeWidth={2.4} />
            {isCorrection ? t("dockConfirmCorrection") : t("dockEnterStock")}
          </button>
        </footer>
      </Shell>
    );
  }

  /* ── D · Le reçu ───────────────────────────────────────────────────────── */
  return (
    <Shell>
      <div className="flex-1 overflow-auto p-3 text-center">
        <div className="mx-auto mt-6 grid h-[62px] w-[62px] place-items-center rounded-full border border-wh-ok-edge bg-wh-ok-bg">
          <Check size={30} strokeWidth={2.6} className="text-wh-ok" />
        </div>
        <div className="mt-3.5 font-mono text-[27px] font-bold tabular-nums">+{moved?.qty ?? 0}</div>
        <div className="mt-0.5 text-[13px] font-semibold text-wh-ink-2">{t("dockEntered")}</div>
        <div className="mt-0.5 text-[12.5px] text-wh-ink-3" dir="auto">
          {moved?.label}
        </div>

        {/* LES TROIS CHIFFRES QUI ONT CHANGÉ. C'est la preuve que le stock a
            bougé, et c'est la récompense du geste. */}
        <div className="mt-4 overflow-hidden rounded-[10px] border border-wh-border bg-wh-surface text-start">
          <Row k={warehouseName ?? t("dockSite")} v={moved?.siteTotal} />
          <Row k={t("dockMarketTotal")} v={moved?.productTotal} />
        </div>

        {/* ── LA RÉVÉLATION ──────────────────────────────────────────────
            Elle arrive APRÈS l'engagement, et c'est tout l'intérêt. Montrer
            « attendu 150 » avant le comptage ne fait pas gagner du temps : ça
            fait ÉCRIRE 150. Ici l'écart est une information sur le
            FOURNISSEUR, et non sur la mémoire de l'agent.

            Silencieux quand `ordered` est null : il n'y a pas de plan contre
            lequel mesurer, et un reproche inventé est pire qu'un silence. */}
        {moved?.ordered !== null && moved?.ordered !== undefined ? (
          <div className="mt-3 overflow-hidden rounded-[10px] border border-wh-border bg-wh-surface text-start">
            <div className="border-b border-wh-border bg-wh-sunken px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-wh-ink-2">
              {t("dockVsOrder")}
            </div>
            <Row k={t("dockOrdered")} v={moved.ordered} />
            <Row k={t("dockCounted")} v={moved.counted} />
            {gapOf(moved) === 0 ? (
              <div className="flex items-center justify-between px-3 py-2.5 text-[12.5px] font-semibold text-wh-ok">
                <span>{t("dockComplete")}</span>
                <Check size={15} strokeWidth={2.6} />
              </div>
            ) : (
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-[12.5px] font-semibold text-wh-warn">{t("dockGap")}</span>
                {/* LE SIGNE EST PORTÉ PAR LE CHIFFRE, et le « moins » est un
                    vrai U+2212 : un trait d'union se lit mal en chiffres
                    tabulaires, et se perd complètement en RTL. */}
                <span className="font-mono text-[14px] font-bold tabular-nums text-wh-warn" dir="ltr">
                  {gapOf(moved)! > 0 ? "+" : "\u2212"}
                  {Math.abs(gapOf(moved)!)}
                </span>
              </div>
            )}
          </div>
        ) : null}

        <p className="mt-3 text-[11.5px] text-wh-ink-3">{t("dockCorrectableUntilSettled")}</p>
      </div>
      <footer className="flex-none border-t border-wh-border bg-wh-surface p-3">
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setScreen("pick");
          }}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-wh-ok text-[15px] font-bold text-white"
        >
          <Plus size={19} strokeWidth={2.6} />
          {t("dockAnotherProduct")}
        </button>
        <button
          type="button"
          onClick={() => setScreen("list")}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-[10px] border border-wh-border-strong bg-wh-surface text-[14.5px] font-semibold"
        >
          {t("dockDone")}
        </button>
      </footer>
    </Shell>
  );
}

/**
 * L'écart, ou `null` quand il n'y a rien à comparer. Compté − commandé : un
 * surplus est positif, un manque négatif, et personne n'a à deviner le sens.
 */
function gapOf(m: Moved): number | null {
  if (m.ordered === null || m.counted === null) return null;
  return m.counted - m.ordered;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-wh-bg md:inset-y-0 md:end-0 md:start-auto md:w-[420px] md:border-s md:border-wh-border">
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: number | null | undefined }) {
  return (
    <div className="flex items-center justify-between border-b border-wh-border px-3 py-2.5 last:border-b-0">
      <span className="text-[12.5px] text-wh-ink-2">{k}</span>
      <span className="font-mono text-[14px] font-bold tabular-nums">
        {v === null || v === undefined ? <span className="text-wh-ink-3">—</span> : v}
      </span>
    </div>
  );
}
