"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Clock, Inbox, Megaphone, MessageCircle, Settings, Shield, Truck, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import type { TileFamily } from "@/lib/journal/types";

/**
 * Atoms of Journaux, copied from prototypes/journaux-v2.html. Sizes are px on
 * purpose: the root font is 14px, so rem sizes would render 12.5 % small.
 * Colours are the --jx-* tokens (design-system §4.24).
 */

export type Sev = "ok" | "warn" | "fail" | "mute" | "off";

const FAMILY_ICON: Record<TileFamily, typeof Inbox> = {
  intake: Inbox,
  carrier: Truck,
  ads: Megaphone,
  msg: MessageCircle,
  auto: Clock,
  app: Shield,
};
const FAMILY_TONE: Record<TileFamily, string> = {
  intake: "bg-[var(--jx-intake-bg)] text-[var(--jx-intake-ink)]",
  carrier: "bg-[var(--jx-carrier-bg)] text-[var(--jx-carrier-ink)]",
  ads: "bg-[var(--jx-ads-bg)] text-[var(--jx-ads-ink)]",
  msg: "bg-[var(--jx-msg-bg)] text-[var(--jx-msg-ink)]",
  auto: "bg-[var(--jx-auto-bg)] text-[var(--jx-auto-ink)]",
  app: "bg-[var(--jx-app-bg)] text-[var(--jx-app-ink)]",
};

/** `.tile` — the soft square that says which family a system or a row is. */
export function FamilyIcon({ family, size = 34, gear = false }: { family: TileFamily; size?: number; gear?: boolean }) {
  const Icon = gear ? Settings : FAMILY_ICON[family];
  return (
    <span
      aria-hidden
      className={`grid flex-none place-items-center ${FAMILY_TONE[family]}`}
      style={{ width: size, height: size, borderRadius: size > 32 ? 9 : 9 }}
    >
      <Icon className="h-[17px] w-[17px]" strokeWidth={2} />
    </span>
  );
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
      className={`grid h-[32px] w-[32px] flex-none place-items-center rounded-full text-[11.5px] font-bold ${
        unknown
          ? "border-[1.5px] border-dashed border-[#B6BBC1] bg-white text-ink-muted"
          : admin
            ? "bg-[#1F2328] text-white"
            : "bg-[var(--jx-mute-bg)] text-ink-secondary"
      }`}
    >
      {unknown ? "?" : initials || "?"}
    </span>
  );
}

const PILL: Record<Sev, string> = {
  fail: "bg-[var(--jx-fail-bg)] text-[var(--jx-fail-ink)]",
  warn: "bg-[var(--jx-warn-bg)] text-[var(--jx-warn-ink)]",
  ok: "bg-[var(--jx-ok-bg)] text-[var(--jx-ok-ink)]",
  mute: "bg-[var(--jx-mute-bg)] text-ink-secondary",
  off: "bg-[var(--jx-mute-bg)] text-ink-secondary",
};

/** `.pill` — a dot and a word. Colour is never alone. */
export function Pill({ sev, children }: { sev: Sev; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-full px-[10px] py-[2px] text-[12.5px] font-semibold ${PILL[sev]}`}>
      <i className="inline-block h-[7px] w-[7px] rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

/** `.state` — a tile's status line: dot + word; success stays quiet green. */
export function StateLine({ sev, children }: { sev: Sev; children: ReactNode }) {
  const tone =
    sev === "ok"
      ? "text-[var(--jx-ok-ink)]"
      : sev === "fail"
        ? "font-semibold text-[var(--jx-fail-ink)]"
        : sev === "warn"
          ? "font-semibold text-[var(--jx-warn-ink)]"
          : "text-ink-secondary";
  const dot =
    sev === "ok"
      ? "bg-[var(--jx-ok)]"
      : sev === "fail"
        ? "bg-[var(--jx-fail)]"
        : sev === "warn"
          ? "bg-[var(--jx-warn)]"
          : sev === "off"
            ? "bg-white shadow-[inset_0_0_0_1.5px_#B6BBC1]"
            : "bg-[var(--jx-mute)]";
  return (
    <span className={`mt-[6px] inline-flex items-center gap-[6px] text-[13px] font-medium ${tone}`}>
      <i className={`inline-block h-[8px] w-[8px] rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

/** `.flag` — « Échec » / « À vérifier » after a feed line. */
export function Flag({ sev, children }: { sev: "fail" | "warn"; children: ReactNode }) {
  return (
    <span
      className={`ms-[6px] inline-block rounded-full bg-white px-[8px] align-[1px] text-[12px] font-semibold ${
        sev === "fail"
          ? "text-[var(--jx-fail-ink)] shadow-[inset_0_0_0_1px_var(--jx-fail-line)]"
          : "text-[var(--jx-warn-ink)] shadow-[inset_0_0_0_1px_var(--jx-warn-line)]"
      }`}
    >
      {children}
    </span>
  );
}

export function Chevron() {
  return <ChevronRight className="h-[16px] w-[16px] text-ink-muted rtl:rotate-180" aria-hidden />;
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
    <Sheet open={open} onClose={onClose} width={wide ? "w-full sm:w-[640px]" : "w-full sm:w-[540px]"} ariaLabel={typeof title === "string" ? title : undefined}>
      <header className="flex items-start gap-[12px] px-[26px] pb-[16px] pt-[22px]">
        <div className="min-w-0">
          <h3 className="m-0 text-[19px] font-[650] leading-[1.3] tracking-[-0.01em] text-ink-primary">{title}</h3>
          {sub && <div className="mt-[6px] flex flex-wrap items-center gap-[10px] text-[13.5px] text-ink-secondary">{sub}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="ms-auto grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px] border border-line bg-white"
        >
          <X className="h-[16px] w-[16px]" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[26px] pb-[24px]">{children}</div>
      {footer && <footer className="flex items-center gap-[8px] border-t border-line-subtle px-[26px] py-[14px]">{footer}</footer>}
    </Sheet>
  );
}

export function H4({ children }: { children: ReactNode }) {
  return <h4 className="mb-[8px] mt-[22px] text-[13px] font-semibold text-ink-secondary">{children}</h4>;
}

export function P({ children, small }: { children: ReactNode; small?: boolean }) {
  return <p className={`m-0 mb-[8px] ${small ? "text-[13px] text-ink-secondary" : "text-[14.5px] leading-[1.6] text-ink-primary"}`}>{children}</p>;
}

/** `.figs` — the « Combien » numbers. */
export function Figures({ items }: { items: { value: string; label: string; fail?: boolean }[] }) {
  return (
    <div className="my-[4px] flex flex-wrap gap-[28px]">
      {items.map((it) => (
        <div key={it.label}>
          <b className={`block text-[26px] font-[650] leading-[1.2] tracking-[-0.015em] tabular-nums ${it.fail ? "text-[var(--jx-fail-ink)]" : "text-ink-primary"}`}>
            {it.value}
          </b>
          <span className="text-[13px] text-ink-secondary">{it.label}</span>
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
        <li key={i} className="relative pb-[12px] ps-[34px] text-[14.5px] leading-[1.5]">
          <span className="absolute start-0 top-0 grid h-[22px] w-[22px] place-items-center rounded-full bg-[var(--jx-mute-bg)] text-[12px] font-bold text-ink-secondary">
            {i + 1}
          </span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return <div className="mt-[14px] rounded-[10px] bg-[var(--jx-warn-bg)] px-[14px] py-[12px] text-[14px] leading-[1.55] text-[#5C4400]">{children}</div>;
}

/** `details.tech` — the technical part, folded. */
export function Tech({ children }: { children: ReactNode }) {
  const t = useTranslations("journaux");
  return (
    <details className="group mt-[22px] rounded-[10px] border border-line-subtle">
      <summary className="flex cursor-pointer list-none items-center gap-[8px] px-[14px] py-[11px] text-[13.5px] font-medium text-ink-secondary [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-[16px] w-[16px] transition-transform group-open:rotate-90 rtl:-scale-x-100" aria-hidden />
        {t("common.tech")}
      </summary>
      <div className="px-[14px] pb-[14px]">{children}</div>
    </details>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <div dir="ltr" className="whitespace-pre-wrap break-words rounded-[8px] border border-line-subtle bg-surface-sunken px-[12px] py-[10px] text-left font-mono text-[12px] leading-[1.6] text-[#374151]">
      {children}
    </div>
  );
}

export function MiniTable({ rows }: { rows: ReactNode[][] }) {
  return (
    <table className="w-full border-collapse text-[13.5px]">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line-subtle last:border-b-0">
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
  o: "bg-[var(--jx-ok)]",
  f: "bg-[var(--jx-fail)]",
  i: "bg-[var(--jx-mute)]",
  m: "bg-white shadow-[inset_0_0_0_1px_var(--jx-warn-line)]",
  "-": "bg-[var(--jx-mute-bg)]",
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
  const cls = `inline-flex h-[38px] items-center gap-[7px] whitespace-nowrap rounded-[8px] border px-[14px] text-[14px] [&>svg]:h-[15px] [&>svg]:w-[15px] disabled:opacity-60 ${
    primary
      ? "border-brand bg-brand font-semibold text-white hover:bg-brand-hover"
      : quiet
        ? "border-transparent font-medium text-ink-secondary hover:bg-surface-hover"
        : "border-[#D2D5D9] bg-white font-medium text-ink-primary hover:bg-surface-hover"
  }`;
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
