"use client";

import type { ReactNode } from "react";
import { Lock, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { Sheet } from "@/components/ui/Sheet";
import { X } from "lucide-react";

/**
 * Presentational atoms of Réglages, copied from prototypes/reglages-v2.html.
 * Sizes are in px on purpose (root font is 14px — see RgButton).
 */

/** `.rg-card` (reglages.css): the Aurore card of Commandes — glass edge, crisp body, 20px radius. */
export function SettingsCard({
  title,
  description,
  end,
  children,
  footer,
  testId,
}: {
  title?: ReactNode;
  description?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="rg-card">
      {(title || end) && (
        <header>
          <div className="min-w-0">
            {title && <h3>{title}</h3>}
            {description && <p>{description}</p>}
          </div>
          {end && <div className="ms-auto flex flex-none items-center gap-[8px]">{end}</div>}
        </header>
      )}
      {children}
      {footer && (
        <div className="rg-card-foot">
          {footer}
        </div>
      )}
    </section>
  );
}

/** « 🔒 Modifiable par un administrateur » — a read-only card says who can. */
export function ReadOnlyLine({ text }: { text?: string }) {
  const t = useTranslations("reglages");
  return (
    <span className="inline-flex items-center gap-[6px] whitespace-nowrap text-[12.5px] text-ink-secondary">
      <Lock className="h-[14px] w-[14px]" aria-hidden />
      {text ?? t("readOnly")}
    </span>
  );
}

export type RgTone = "ok" | "warn" | "neutral" | "info" | "bad" | "plain";
const TONES: Record<RgTone, string> = {
  ok: "bg-[#ECFDF3] text-[#067647] shadow-[inset_0_0_0_1px_#ABEFC6]",
  warn: "bg-[#FFFAEB] text-[#B54708] shadow-[inset_0_0_0_1px_#FEDF89]",
  neutral: "bg-[#F2F4F7] text-[#344054] shadow-[inset_0_0_0_1px_#E4E7EC]",
  info: "bg-[#EFF8FF] text-[#175CD3] shadow-[inset_0_0_0_1px_#B2DDFF]",
  bad: "bg-[#FEF3F2] text-[#B42318] shadow-[inset_0_0_0_1px_#FECDCA]",
  plain: "bg-white text-[var(--ink-2)] shadow-[inset_0_0_0_1px_rgba(15,23,40,.1)]",
};

/** Commandes' `.pl`: a tinted pill with its hairline, ink and a dot — the owner's « gentle » tag. */
export function RgBadge({ tone = "neutral", dot = true, children }: { tone?: RgTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex h-[24px] items-center gap-[6px] whitespace-nowrap rounded-full px-[10px] text-[12px] font-bold ${TONES[tone]}`}>
      {dot && <i aria-hidden className="inline-block h-[6px] w-[6px] rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** A switch's read-only twin: the state as a badge, never a greyed control. */
export function StateBadge({ on }: { on: boolean }) {
  const t = useTranslations("reglages");
  return <RgBadge tone={on ? "ok" : "neutral"}>{on ? t("common.active") : t("common.inactive")}</RgBadge>;
}

/** `.rov`: a read-only value with its unit. */
export function ReadOnlyValue({ value, unit, prefix }: { value: ReactNode; unit?: string; prefix?: string }) {
  return (
    <span className="whitespace-nowrap text-[14px] font-semibold text-ink-primary">
      {prefix && <small className="text-[13px] font-normal text-ink-secondary">{prefix} </small>}
      <span dir="ltr" className="tabular-nums">
        {value}
      </span>
      {unit && <small className="text-[13px] font-normal text-ink-secondary"> {unit}</small>}
    </span>
  );
}

/** `.empty`: an icon, a sentence, an action. */
export function EmptyState({
  icon,
  title,
  text,
  actions,
  tone,
}: {
  icon: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  actions?: ReactNode;
  tone?: "ok";
}) {
  return (
    <div className="flex flex-col items-center gap-[6px] px-[20px] py-[28px] text-center">
      <span
        className={`mb-[4px] grid h-[44px] w-[44px] place-items-center rounded-[14px] [&>svg]:h-[18px] [&>svg]:w-[18px] ${tone === "ok" ? "bg-[var(--good-bg)] text-[var(--good)]" : "bg-[#F2F4F7] text-[var(--ink-2)] shadow-[inset_0_0_0_1px_#E4E7EC]"}`}
      >
        {icon}
      </span>
      <b className="text-[14.5px] font-extrabold text-ink-primary">{title}</b>
      {text && <p className="m-0 max-w-[56ch] text-[13px] text-ink-secondary">{text}</p>}
      {actions && <div className="mt-[8px] flex gap-[8px]">{actions}</div>}
    </div>
  );
}

/** `.notice`: a quiet info line above content. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-[16px] flex items-start gap-[10px] rounded-[14px] border border-[var(--card-bd)] bg-[var(--glass-in)] px-[14px] py-[11px] text-[13px] font-medium leading-[1.5] text-ink-primary shadow-[var(--card-sh)]">
      <Info className="mt-[1px] h-[16px] w-[16px] flex-none text-ink-secondary" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Market code chip (« LY »). */
export function CodeChip({ code, active = false }: { code: string; active?: boolean }) {
  return (
    <span
      className={`inline-grid h-[20px] min-w-[24px] place-items-center rounded-[6px] px-[5px] text-[10.5px] font-extrabold tracking-[.04em] ${active ? "bg-brand text-white" : "bg-[#F2F4F7] text-[var(--ink-2)]"}`}
    >
      {code}
    </span>
  );
}

/** Shop / carrier / site mark: a neutral 30px square. */
export function Mark({ children, size = 30, src }: { children: ReactNode; size?: number; /** An uploaded logo; the letters/icon stay the fallback. */ src?: string | null }) {
  if (src) {
    return (
      <span style={{ width: size, height: size }} className="grid flex-none place-items-center overflow-hidden rounded-[9px] border border-line-subtle bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- no images.remotePatterns configured */}
        <img src={src} alt="" className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="grid flex-none place-items-center rounded-[9px] bg-[#F2F4F7] text-[10.5px] font-extrabold tracking-[.02em] text-ink-secondary shadow-[inset_0_0_0_1px_#E4E7EC] [&>svg]:h-[16px] [&>svg]:w-[16px]"
    >
      {children}
    </span>
  );
}

/** `.pills`: a soft track of filters with counts. */
export function Pills<V extends string>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  items: { value: V; label: string; count: number }[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-[2px] rounded-[12px] bg-[#F2F4F7] p-[3px]">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(it.value)}
            className={`inline-flex h-[30px] items-center gap-[6px] rounded-[9px] px-[12px] text-[13px] font-bold ${on ? "bg-white text-ink-primary shadow-[0_1px_3px_rgba(15,23,40,.14)]" : "text-ink-secondary hover:text-ink-primary"}`}
          >
            {it.label}
            <b className={`text-[11.5px] font-bold tabular-nums ${on ? "text-ink-secondary" : "text-[var(--ink-q)]"}`}>{it.count}</b>
          </button>
        );
      })}
    </div>
  );
}

/** Table cells as in the prototype (`table.t`). */
export const th =
  "whitespace-nowrap border-b border-line-subtle px-[18px] py-[11px] text-start text-[10.5px] font-extrabold uppercase tracking-[.09em] text-ink-muted rtl:text-[12px] rtl:normal-case rtl:tracking-normal";
export const td = "border-b border-line-subtle px-[18px] py-[12px] align-middle text-[13.5px] font-medium text-ink-primary";
export const trClick = "cursor-pointer hover:[&>td]:bg-[#F8F9FC] [&:last-child>td]:border-b-0";
export const trPlain = "[&:last-child>td]:border-b-0";

/** `.dp`: the 500px side panel with a header, scrolling sections and a footer. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations("reglages");
  return (
    <Sheet open={open} onClose={onClose} width="w-full sm:w-[500px]" ariaLabel={typeof title === "string" ? title : undefined}>
      <header className="flex items-start gap-[12px] border-b border-line-subtle px-[22px] py-[18px]">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-[20px] font-extrabold tracking-[-.02em] text-ink-primary">{title}</h3>
          {subtitle && <div className="mt-[4px] flex flex-wrap items-center gap-[6px] text-[13px] font-medium text-ink-secondary">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="ms-auto grid h-[32px] w-[32px] flex-none place-items-center rounded-[9px] text-ink-secondary hover:bg-[rgba(15,23,40,.05)]"
        >
          <X className="h-[16px] w-[16px]" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <footer className="flex items-center gap-[8px] border-t border-line-subtle bg-white px-[20px] py-[14px]">{footer}</footer>}
    </Sheet>
  );
}

export function DrawerSection({ title, end, children }: { title?: ReactNode; end?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-line-subtle px-[22px] py-[18px] last:border-b-0">
      {(title || end) && (
        <h4 className="m-0 mb-[12px] flex items-center gap-[8px] text-[11px] font-extrabold uppercase tracking-[.08em] text-ink-muted rtl:text-[12px] rtl:normal-case rtl:tracking-normal [&>svg]:h-[14px] [&>svg]:w-[14px]">
          {title}
          {end && <span className="ms-auto">{end}</span>}
        </h4>
      )}
      {children}
    </div>
  );
}

/** `.f`: label above, control, help below. */
export function Field({ label, htmlFor, help, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-[14px] flex flex-col gap-[5px] last:mb-0">
      <label htmlFor={htmlFor} className="text-[13px] font-bold text-ink-primary">
        {label}
      </label>
      {children}
      {help && <div className="text-[12.5px] leading-[1.45] text-ink-secondary">{help}</div>}
    </div>
  );
}

export const inputClass =
  "h-[40px] w-full rounded-[11px] border border-[rgba(15,23,40,.12)] bg-white px-[12px] text-[14px] font-medium text-ink-primary outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(21,128,61,.12)] read-only:bg-surface-sunken read-only:text-ink-secondary";

/** `.swrow`: a switch with its label and a line of help. */
export function SwitchRow({ label, help, control }: { label: ReactNode; help?: ReactNode; control: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[12px] border-b border-line-subtle py-[10px] last:border-b-0">
      <div>
        <b className="block text-[14px] font-bold text-ink-primary">{label}</b>
        {help && <small className="text-[12.5px] text-ink-secondary">{help}</small>}
      </div>
      {control}
    </div>
  );
}
