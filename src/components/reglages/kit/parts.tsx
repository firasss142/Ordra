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

/** `.card` + `.ch`: white, 1px line-subtle, 10px radius, no resting shadow. */
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
    <section data-testid={testId} className="mb-[16px] rounded-[10px] border border-line-subtle bg-white">
      {(title || end) && (
        <header className="flex items-start gap-[12px] border-b border-line-subtle px-[16px] py-[14px]">
          <div className="min-w-0">
            {title && <h3 className="m-0 flex items-center gap-[8px] text-[16px] font-semibold text-ink-primary">{title}</h3>}
            {description && <p className="m-0 mt-[3px] max-w-[72ch] text-[13px] text-ink-secondary">{description}</p>}
          </div>
          {end && <div className="ms-auto flex flex-none items-center gap-[8px]">{end}</div>}
        </header>
      )}
      {children}
      {footer && (
        <div className="flex items-center gap-[8px] rounded-b-[10px] border-t border-line-subtle bg-surface-sunken px-[16px] py-[10px] text-[12.5px] text-ink-secondary [&>svg]:h-[14px] [&>svg]:w-[14px]">
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
  ok: "bg-status-successBg text-status-success",
  warn: "bg-status-warningBg text-status-warning",
  neutral: "bg-[#F1F2F3] text-ink-secondary",
  info: "bg-prod-info-bg text-status-action",
  bad: "bg-status-criticalBg text-status-critical",
  plain: "border border-line bg-white font-medium text-ink-secondary",
};

/** `.badge`: flat tint, ink and a dot — the owner's « gentle » tag. */
export function RgBadge({ tone = "neutral", dot = true, children }: { tone?: RgTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-full px-[9px] py-[2px] text-[12px] font-semibold leading-[1.6] ${TONES[tone]}`}>
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
        className={`mb-[4px] grid h-[40px] w-[40px] place-items-center rounded-full [&>svg]:h-[16px] [&>svg]:w-[16px] ${tone === "ok" ? "bg-status-successBg text-status-success" : "bg-[#F1F2F3] text-ink-secondary"}`}
      >
        {icon}
      </span>
      <b className="text-[14.5px] font-semibold text-ink-primary">{title}</b>
      {text && <p className="m-0 max-w-[56ch] text-[13px] text-ink-secondary">{text}</p>}
      {actions && <div className="mt-[8px] flex gap-[8px]">{actions}</div>}
    </div>
  );
}

/** `.notice`: a quiet info line above content. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-[16px] flex items-start gap-[10px] rounded-[10px] border border-line-subtle bg-white px-[14px] py-[11px] text-[13px] leading-[1.5] text-ink-primary">
      <Info className="mt-[1px] h-[16px] w-[16px] flex-none text-ink-secondary" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Market code chip (« LY »). */
export function CodeChip({ code, active = false }: { code: string; active?: boolean }) {
  return (
    <span
      className={`inline-grid h-[20px] min-w-[24px] place-items-center rounded-[5px] px-[5px] text-[10.5px] font-bold tracking-[.04em] ${active ? "bg-brand-bg text-brand" : "bg-[#F1F2F3] text-ink-secondary"}`}
    >
      {code}
    </span>
  );
}

/** Shop / carrier / site mark: a neutral 30px square. */
export function Mark({ children, size = 30, src }: { children: ReactNode; size?: number; /** An uploaded logo; the letters/icon stay the fallback. */ src?: string | null }) {
  if (src) {
    return (
      <span style={{ width: size, height: size }} className="grid flex-none place-items-center overflow-hidden rounded-[7px] border border-line-subtle bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- no images.remotePatterns configured */}
        <img src={src} alt="" className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="grid flex-none place-items-center rounded-[7px] border border-line-subtle bg-[#F1F2F3] text-[10.5px] font-bold tracking-[.02em] text-ink-secondary [&>svg]:h-[16px] [&>svg]:w-[16px]"
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
    <div role="group" aria-label={label} className="inline-flex gap-[2px] rounded-[9px] bg-[#EEEFF1] p-[3px]">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(it.value)}
            className={`inline-flex items-center gap-[6px] rounded-[7px] px-[11px] py-[5px] text-[13px] ${on ? "bg-white font-semibold text-ink-primary shadow-[0_0_0_1px_#E1E3E5]" : "font-medium text-ink-secondary"}`}
          >
            {it.label}
            <b className={`text-[11.5px] font-semibold tabular-nums ${on ? "text-ink-secondary" : "text-[#8C9196]"}`}>{it.count}</b>
          </button>
        );
      })}
    </div>
  );
}

/** Table cells as in the prototype (`table.t`). */
export const th =
  "whitespace-nowrap border-b border-line-subtle bg-surface-sunken px-[16px] py-[9px] text-start text-[12px] font-semibold uppercase tracking-[.04em] text-ink-secondary rtl:text-[12.5px] rtl:normal-case rtl:tracking-normal";
export const td = "border-b border-line-subtle px-[16px] py-[11px] align-middle text-[14px] text-ink-primary";
export const trClick = "cursor-pointer hover:[&>td]:bg-surface-hover [&:last-child>td]:border-b-0";
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
      <header className="flex items-start gap-[12px] border-b border-line-subtle px-[20px] py-[16px]">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-[17px] font-semibold text-ink-primary">{title}</h3>
          {subtitle && <div className="mt-[2px] flex flex-wrap items-center gap-[6px] text-[13px] text-ink-secondary">{subtitle}</div>}
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
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <footer className="flex items-center gap-[8px] border-t border-line-subtle bg-surface-sunken px-[20px] py-[12px]">{footer}</footer>}
    </Sheet>
  );
}

export function DrawerSection({ title, end, children }: { title?: ReactNode; end?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-line-subtle px-[20px] py-[16px] last:border-b-0">
      {(title || end) && (
        <h4 className="m-0 mb-[12px] flex items-center gap-[8px] text-[14px] font-semibold text-ink-primary [&>svg]:h-[16px] [&>svg]:w-[16px]">
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
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-primary">
        {label}
      </label>
      {children}
      {help && <div className="text-[12.5px] leading-[1.45] text-ink-secondary">{help}</div>}
    </div>
  );
}

export const inputClass =
  "h-[38px] w-full rounded-[7px] border border-[#D2D5D9] bg-white px-[11px] text-[14px] text-ink-primary outline-none focus:border-brand focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-brand read-only:bg-surface-sunken read-only:text-ink-secondary";

/** `.swrow`: a switch with its label and a line of help. */
export function SwitchRow({ label, help, control }: { label: ReactNode; help?: ReactNode; control: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[12px] border-b border-line-subtle py-[10px] last:border-b-0">
      <div>
        <b className="block text-[14px] font-medium text-ink-primary">{label}</b>
        {help && <small className="text-[12.5px] text-ink-secondary">{help}</small>}
      </div>
      {control}
    </div>
  );
}
