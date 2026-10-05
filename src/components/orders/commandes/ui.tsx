"use client";

// Commandes' small atoms, drawn as prototypes/commandes-v4.html draws them:
// icon, status pill, tag, agent avatar, store dot, product thumb, the tooltip,
// and the words for « when » and « how old ». Shared by the list, Archivées and
// Commandes répétées.

import { useCallback, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslations } from "next-intl";
import { presentStatus, type StatusHue } from "@/lib/orders/status-presentation";
import { AGENT_COLORS, agentColorKey } from "@/lib/team/agent-color";
import { hueOf, platformOf } from "@/lib/dashboard/stores/model";
import { HUES } from "@/components/dashboard/home/ui";
import { marketTimezone } from "@/lib/markets";
import type { RejectionBadge } from "@/hooks/useRejectionBadge";
import type { RowTag } from "@/lib/orders/row-signals";
import { ICON_PATHS } from "./icons";

export type T = ReturnType<typeof useTranslations>;

export function Ic({ n, className = "" }: { n: string; className?: string }) {
  return <svg className={`ic ${className}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_PATHS[n] ?? "" }} />;
}

// ── time words ──────────────────────────────────────────────────────────────

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string, loc: string, opts: Intl.DateTimeFormatOptions) {
  const k = `${tz}|${loc}|${JSON.stringify(opts)}`;
  let f = dtfCache.get(k);
  if (!f) dtfCache.set(k, (f = new Intl.DateTimeFormat(loc === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { ...opts, timeZone: tz })));
  return f;
}

/** The market-local day (YYYY-MM-DD) and « hh:mm » of an instant. */
export function marketParts(iso: string, marketId: string | null) {
  const tz = marketTimezone(marketId);
  const d = new Date(iso);
  const day = dtf(tz, "fr", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("/").reverse().join("-");
  const time = dtf(tz, "fr", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { day, time };
}

/**
 * « aujourd'hui 17:20 » · « hier 09:05 » · « 4 oct. 17:20 » (prototype `whenText`);
 * `short` drops « aujourd'hui » — a callback today reads « Rappel 18:10 ».
 */
export function useWhen(marketId: string | null, locale: string) {
  const t = useTranslations("commandes.when");
  return useCallback(
    (iso: string | null | undefined, opts: { short?: boolean; now?: Date } = {}) => {
      if (!iso) return "";
      const now = opts.now ?? new Date();
      const { day, time } = marketParts(iso, marketId);
      const today = marketParts(now.toISOString(), marketId).day;
      const yday = marketParts(new Date(now.getTime() - 86_400_000).toISOString(), marketId).day;
      if (day === today) return opts.short ? time : t("today", { time });
      if (day === yday) return t("yday", { time });
      const short = dtf("UTC", locale, { day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00Z`));
      return t("other", { day: short, time });
    },
    [marketId, locale, t],
  );
}
export type When = ReturnType<typeof useWhen>;

/** « 12 min » · « 3 h » · « 2 j » (prototype `ageText`). */
export function ageWords(t: T, minutes: number) {
  if (minutes < 60) return t("age.min", { n: Math.max(0, Math.floor(minutes)) });
  if (minutes < 1440) return t("age.h", { n: Math.floor(minutes / 60) });
  return t("age.d", { n: Math.floor(minutes / 1440) });
}

/** « 45 min » · « 3 h 05 » — the span of a duplicate group. */
export function spanWords(t: T, minutes: number) {
  if (minutes < 60) return t("age.min", { n: minutes });
  return `${t("age.h", { n: Math.floor(minutes / 60) })} ${String(minutes % 60).padStart(2, "0")}`;
}

// ── status pill (prototype `pillHTML`) ──────────────────────────────────────

export interface PillOrder {
  status: string;
  callback_scheduled_at?: string | null;
  attempts_count?: number | null;
  rejection_reason?: string | null;
  rejection_subreason?: string | null;
  rejection_note?: string | null;
}

/** The status icon the pill draws, per StatusIconName (lib/orders/status-presentation). */
export const STATUS_ICON: Record<string, string> = {
  waiting: "clock", assigned: "user", unverified: "help", calling: "phone", callback: "clock", scheduled: "cal",
  confirmed: "check", uploaded: "upload", scanned: "scan", atCarrier: "truck", outForDelivery: "route", delayed: "clock",
  returning: "back", dispatched: "truck", deposit: "pkg", inTransit: "truck", delivered: "check", received: "back",
  toReturn: "back", returned: "back", rejected: "xcircle", rejectedRefused: "thumbdown", rejectedUnreachable: "phoneoff",
  rejectedUndeliverable: "pinoff", rejectedInvalid: "xcircle", rejectedOther: "xcircle", cancelled: "x", deleted: "trash",
};

export function Pill({ hue, icon, text, tip }: { hue: StatusHue | "blue"; icon: string; text: string; tip?: string }) {
  return (
    <span className={`pl h-${hue}`} data-tip={tip}>
      <Ic n={icon} />
      <span>{text}</span>
    </span>
  );
}

export function StatusPill({
  o,
  maxAttempts,
  rejection,
  when,
  now = new Date(),
}: {
  o: PillOrder;
  maxAttempts: number | null;
  rejection: (o: PillOrder) => RejectionBadge | null;
  when: When;
  now?: Date;
}) {
  const t = useTranslations("commandes");
  const tS = useTranslations("orders.statuses");
  const p = presentStatus(o.status);
  if (o.status === "callback_scheduled" && o.callback_scheduled_at) {
    const at = o.callback_scheduled_at;
    const w = when(at, { now });
    if (Date.parse(at) < now.getTime()) {
      return <Pill hue="red" icon="clock" text={t("status.callbackLate")} tip={t("status.callbackWas", { when: w })} />;
    }
    return <Pill hue="violet" icon="clock" text={t("status.callback", { when: when(at, { short: true, now }) })} />;
  }
  if (o.status === "rejected") {
    const r = rejection(o);
    if (r) return <Pill hue="red" icon={STATUS_ICON[r.icon] ?? "xcircle"} text={r.text} tip={t("status.rejectedTip", { reason: r.detail ?? r.text })} />;
  }
  if (o.status.startsWith("attempt_")) {
    const n = o.attempts_count && o.attempts_count > 0 ? o.attempts_count : Number(o.status.slice(8)) || 1;
    return <Pill hue="amber" icon="phone" text={t("status.attempt", { n, max: maxAttempts ?? 3 })} />;
  }
  const label = tS.has(o.status) ? tS(o.status) : o.status;
  return <Pill hue={p.hue} icon={STATUS_ICON[p.icon] ?? "clock"} text={label} />;
}

// ── tags (prototype `tagsOf`) ───────────────────────────────────────────────

export function RowTags({ tags }: { tags: RowTag[] }) {
  const t = useTranslations("commandes.tags");
  return (
    <>
      {tags.map((g) => {
        // Icons only on the row; the words are the tooltip and the accessible name.
        const [icon, tip] =
          g.kind === "dup"
            ? ["copy", g.shipped ? t("dupShippedTip", { n: g.n }) : t("dupTip", { n: g.n })]
            : g.kind === "rejected"
              ? ["alert", t("rejectedTip", { n: g.n, of: g.of })]
              : ["star", t("loyalTip", { n: g.n })];
        return (
          <span key={g.kind} className={`tg ico h-${g.hue}`} data-tip={tip} role="img" aria-label={tip}>
            <Ic n={icon} />
          </span>
        );
      })}
    </>
  );
}

// ── people, stores, products ────────────────────────────────────────────────

export function agentHex(id: string) {
  const key = agentColorKey(null, id);
  return AGENT_COLORS.find((c) => c.key === key)?.hex ?? "#667085";
}

export function Avatar({ id, name, here }: { id: string; name: string; here?: boolean }) {
  return (
    <span className={`av${here ? " here" : ""}`} style={{ "--h": agentHex(id) } as CSSProperties}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function FreeAvatar() {
  return (
    <span className="av free">
      <Ic n="user" />
    </span>
  );
}

export interface StoreInfo {
  id: string;
  name: string;
  platform: string;
  accent_color: string | null;
  config?: Record<string, unknown> | null;
}

const PLATFORM_LABEL: Record<string, string> = {
  converty: "Converty", shopify: "Shopify", lightfunnels: "LightFunnels", youcan: "YouCan", woocommerce: "WooCommerce",
  easyorders: "EasyOrders", buybox: "BuyBox", sheets: "Google Sheets", other: "",
};

export function storeVars(s: StoreInfo | undefined): CSSProperties {
  const h = HUES[hueOf(s?.accent_color)];
  return { "--a5": h[0], "--a7": h[1] } as CSSProperties;
}

/** « Converty » · « Converty via Google Sheets » — the platform never colours anything. */
export function platformWords(s: StoreInfo): string {
  const adapter = typeof s.config?.sheet_adapter === "string" ? (s.config.sheet_adapter as string) : null;
  const p = platformOf(s.platform, adapter);
  const base = PLATFORM_LABEL[p.key] || s.platform;
  return p.sheets && p.key !== "sheets" ? `${base} via Google Sheets` : base;
}

export function StoreTag({ s, withPlatform }: { s: StoreInfo | undefined; withPlatform?: boolean }) {
  if (!s) return <span className="q">—</span>;
  return (
    <>
      <span className="shop" style={storeVars(s)} data-tip={platformWords(s)}>
        <i />
        <span>{s.name}</span>
      </span>
      {withPlatform && <span className="q"> · {platformWords(s)}</span>}
    </>
  );
}

const TINTS: [string, string][] = [
  ["#F4EDE2", "#8A5A1F"], ["#FDE8E8", "#B42318"], ["#E6F2EC", "#2F6B4F"], ["#EEF1E4", "#566428"], ["#FFF0D9", "#B54708"], ["#EEF2FF", "#3538CD"],
];

/** The product's image, or a tinted tile with a bag — the tint is stable per product. */
export function Thumb({ src, seed, size }: { src: string | null | undefined; seed: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const [bg, ink] = TINTS[h % TINTS.length];
  const style = { "--tb": bg, "--ti": ink, ...(size ? { width: size, height: size, borderRadius: size > 30 ? 10 : 7 } : {}) } as CSSProperties;
  return (
    <span className="thumb" style={style}>
      {src ? <img src={src} alt="" loading="lazy" width={size ?? 40} height={size ?? 40} /> : <Ic n="bag" />}
    </span>
  );
}

// ── the tooltip (prototype `.tip`, mouseover + mousemove) ───────────────────

export function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const onOver = useCallback((e: ReactMouseEvent) => {
    const tip = ref.current;
    if (!tip) return;
    const el = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
    if (!el?.dataset.tip) {
      tip.classList.remove("on");
      return;
    }
    tip.textContent = el.dataset.tip;
    tip.classList.add("on");
  }, []);
  const onMove = useCallback((e: ReactMouseEvent) => {
    const tip = ref.current;
    if (!tip || !tip.classList.contains("on")) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = e.clientX + 14;
    let y = e.clientY - h - 12;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 18;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }, []);
  const onLeave = useCallback(() => ref.current?.classList.remove("on"), []);
  return { ref, onOver, onMove, onLeave };
}
