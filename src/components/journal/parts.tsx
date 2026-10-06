"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Clock, Inbox, Megaphone, MessageCircle, Settings, Shield, Truck, Users, X } from "lucide-react";
import type { HistoryCategory } from "@/lib/journal/categories";
import { Sheet } from "@/components/ui/Sheet";
import type { TileFamily } from "@/lib/journal/types";

/**
 * Atoms of Journaux, in the house language of Commandes (2026-10-06): they live
 * inside `.cmd` and read its tokens (--ink, --line, --good, --bad…). Sizes are px
 * on purpose: the root font is 14px, so rem sizes would render 12.5 % small.
 */

export type Sev = "ok" | "warn" | "fail" | "mute" | "off";

const AREA_ICON: Record<Exclude<HistoryCategory, "all">, typeof Inbox> = {
  intake: Inbox,
  carrier: Truck,
  ads: Megaphone,
  msg: MessageCircle,
  auto: Clock,
  app: Shield,
  team: Users,
};

/** The icon of an area (lib/journal/categories); its colour comes from the `jx-c-*` around it. */
export function AreaIcon({ cat, gear = false }: { cat: Exclude<HistoryCategory, "all">; gear?: boolean }) {
  const Icon = gear ? Settings : AREA_ICON[cat];
  return <Icon className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden />;
}

/** `.av` — a person's initials; a dashed ring when nobody is recorded. */
export function Avatar({ name, admin, unknown }: { name: string | null; admin?: boolean; unknown?: boolean }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={`grid h-[32px] w-[32px] flex-none place-items-center rounded-full text-[11px] font-extrabold ${
        unknown
          ? "border-[1.5px] border-dashed border-[#C9CED7] bg-white text-[var(--ink-3)]"
          : admin
            ? "bg-[#1F2328] text-white shadow-[0_0_0_2px_#fff]"
            : "bg-[#ECFDF3] text-[#067647] shadow-[inset_0_0_0_1px_#ABEFC6]"
      }`}
    >
      {unknown ? "?" : initials || "?"}
    </span>
  );
}

const PILL_HUE: Record<Sev, string> = { fail: "h-red", warn: "h-amber", ok: "h-green", mute: "h-neutral", off: "h-neutral" };

/** Commandes' `.pl` — a dot and a word. Colour is never alone. */
export function Pill({ sev, children }: { sev: Sev; children: ReactNode }) {
  return (
    <span className={`pl ${PILL_HUE[sev]}`}>
      <i className="inline-block h-[7px] w-[7px] rounded-full bg-current" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/** `.state` — a tile's status line: dot + word; success stays quiet green. */
export function StateLine({ sev, children }: { sev: Sev; children: ReactNode }) {
  const tone =
    sev === "ok" ? "text-[var(--good)]" : sev === "fail" ? "font-bold text-[var(--bad)]" : sev === "warn" ? "font-bold text-[var(--warn)]" : "text-[var(--ink-2)]";
  const dot =
    sev === "ok"
      ? "bg-[var(--live)]"
      : sev === "fail"
        ? "bg-[#E8385A]"
        : sev === "warn"
          ? "bg-[#F79009]"
          : sev === "off"
            ? "bg-white shadow-[inset_0_0_0_1.5px_#C9CED7]"
            : "bg-[#C9CED7]";
  return (
    <span className={`inline-flex items-center gap-[6px] whitespace-nowrap text-[12.5px] font-semibold ${tone}`}>
      <i className={`inline-block h-[8px] w-[8px] rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

/** `.dp` — the side panel: title, sub line, scrolling body, footer. */
export function Panel({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const t = useTranslations("journaux");
  return (
    <Sheet open={open} onClose={onClose} width={wide ? "w-full sm:w-[640px]" : "w-full sm:w-[560px]"} ariaLabel={typeof title === "string" ? title : undefined}>
      <header className="flex items-start gap-[12px] border-b border-[var(--line)] px-[24px] pb-[16px] pt-[20px]">
        <div className="min-w-0">
          <h3 className="m-0 text-[20px] font-extrabold leading-[1.25] tracking-[-0.02em] text-[var(--ink)]">{title}</h3>
          {sub && <div className="mt-[8px] flex flex-wrap items-center gap-[8px] text-[13px] font-medium text-[var(--ink-2)]">{sub}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="ms-auto grid h-[32px] w-[32px] flex-none place-items-center rounded-[9px] text-[var(--ink-2)] hover:bg-[var(--flat-bg)]"
        >
          <X className="h-[16px] w-[16px]" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] pb-[24px]">{children}</div>
      {footer && <footer className="flex flex-wrap items-center gap-[8px] border-t border-[var(--line)] px-[20px] py-[14px]">{footer}</footer>}
    </Sheet>
  );
}

export function H4({ children }: { children: ReactNode }) {
  return <h4 className="mb-[8px] mt-[22px] text-[11px] font-extrabold uppercase tracking-[.08em] text-[var(--ink-3)] rtl:text-[12px] rtl:normal-case rtl:tracking-normal">{children}</h4>;
}

export function P({ children, small }: { children: ReactNode; small?: boolean }) {
  return <p className={`m-0 mb-[8px] ${small ? "text-[13px] text-[var(--ink-2)]" : "text-[14px] font-medium leading-[1.6] text-[var(--ink)]"}`}>{children}</p>;
}

/** `.figs` — the « Combien » numbers. */
export function Figures({ items }: { items: { value: string; label: string; fail?: boolean }[] }) {
  return (
    <div className="my-[4px] grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-[10px]">
      {items.map((it) => (
        <div key={it.label} className="rounded-[14px] border border-[var(--line)] bg-[#F8F9FC] px-[14px] py-[12px]">
          <b className={`block text-[24px] font-extrabold leading-[1.15] tracking-[-0.025em] tabular-nums ${it.fail ? "text-[var(--bad)]" : "text-[var(--ink)]"}`}>
            {it.value}
          </b>
          <span className="text-[12.5px] font-semibold text-[var(--ink-3)]">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/** `.steps` — « Que faire », numbered. */
export function Steps({ items }: { items: string[] }) {
  return (
    <ol className="m-0 list-none p-0">
      {items.map((s, i) => (
        <li key={i} className="relative pb-[12px] ps-[34px] text-[14px] font-medium leading-[1.5]">
          <span className="absolute start-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full bg-[var(--brand-wash)] text-[12px] font-extrabold text-[var(--brand)]">
            {i + 1}
          </span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return <div className="mt-[14px] rounded-[14px] border border-[#FEDF89] bg-[var(--warn-bg)] px-[14px] py-[12px] text-[13.5px] font-medium leading-[1.55] text-[#7A2E0E]">{children}</div>;
}

/** `details.tech` — the technical part, folded. */
export function Tech({ children }: { children: ReactNode }) {
  const t = useTranslations("journaux");
  return (
    <details className="group mt-[22px] rounded-[14px] border border-[var(--line)] bg-[#F8F9FC]">
      <summary className="flex cursor-pointer list-none items-center gap-[8px] px-[14px] py-[11px] text-[13px] font-bold text-[var(--ink-2)] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-[16px] w-[16px] transition-transform group-open:rotate-90 rtl:-scale-x-100" aria-hidden />
        {t("common.tech")}
      </summary>
      <div className="px-[14px] pb-[14px]">{children}</div>
    </details>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <div dir="ltr" className="whitespace-pre-wrap break-words rounded-[10px] border border-[var(--line)] bg-white px-[12px] py-[10px] text-left font-mono text-[12px] leading-[1.6] text-[#344054]">
      {children}
    </div>
  );
}

export function MiniTable({ rows }: { rows: ReactNode[][] }) {
  return (
    <table className="w-full border-collapse text-[13.5px]">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-[var(--line)] last:border-b-0">
            {r.map((c, j) => (
              <td key={j} className={`py-[8px] ${j > 0 ? "text-end tabular-nums" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const BAR: Record<string, string> = {
  o: "bg-[#4DAE7E]",
  f: "bg-[#E46A7B]",
  i: "bg-[#DADDE2]",
  m: "bg-white shadow-[inset_0_0_0_1.5px_#F5B95C]",
  "-": "bg-[#F2F4F7]",
};

/** `.ub` — one bar per hour over 48 h; « expected, absent » is hollow, not just another colour. */
export function HourBars({ bars }: { bars: string }) {
  const t = useTranslations("journaux");
  return (
    <>
      <div className="mt-[4px] flex h-[24px] items-end gap-[2px]" dir="ltr" role="img" aria-label={t("bars.title")}>
        {[...bars].map((c, i) => (
          <i key={i} className={`h-[22px] flex-1 rounded-[2px] ${BAR[c] ?? BAR["-"]}`} title={t.has(`bars.${c}`) ? t(`bars.${c}`) : undefined} />
        ))}
      </div>
      <div className="mt-[3px] flex justify-between text-[11.5px] text-ink-muted" dir="ltr">
        <span>{t("bars.from")}</span>
        <span>{t("bars.to")}</span>
      </div>
      <p className="mb-0 mt-[8px] text-[13px] text-ink-secondary">{t("bars.legend")}</p>
    </>
  );
}

export function Btn({
  children,
  onClick,
  primary,
  quiet,
  href,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  quiet?: boolean;
  href?: string;
  disabled?: boolean;
}) {
  const cls = `${primary ? "btn" : "btn2"} [&>svg]:h-[15px] [&>svg]:w-[15px] disabled:opacity-60 ${quiet ? "!border-transparent !bg-transparent !text-[var(--ink-2)] hover:!bg-[var(--flat-bg)]" : ""}`;
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
