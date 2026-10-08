"use client";

import type { ReactNode } from "react";
import { Lock, Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Sheet } from "@/components/ui/Sheet";

/**
 * Presentational atoms of Réglages in « Aurore calme » (prototypes/reglages-v4.html).
 * The look lives in reglages.css under `.rgc`; these keep the props the topics use.
 */

/** A glass card: title + one sentence, an end slot, rows, an optional footer line. */
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
  const hasHeader = Boolean(title || end);
  return (
    <section data-testid={testId} className="rg-card">
      {hasHeader && (
        <header>
          <div className="min-w-0 flex-1">
            {title && <h3>{title}</h3>}
            {description && <p>{description}</p>}
          </div>
          {end && <div className="flex flex-none items-center gap-[8px]">{end}</div>}
        </header>
      )}
      {children && <div className={hasHeader ? "rg-card-body" : undefined}>{children}</div>}
      {footer && <div className="rg-card-foot">{footer}</div>}
    </section>
  );
}

/** « 🔒 Modifiable par un administrateur » — a read-only card says who can. */
export function ReadOnlyLine({ text }: { text?: string }) {
  const t = useTranslations("reglages");
  return (
    <span className="inline-flex items-center gap-[6px] whitespace-nowrap text-[12.5px] font-medium text-ink-secondary">
      <Lock className="h-[14px] w-[14px]" aria-hidden />
      {text ?? t("readOnly")}
    </span>
  );
}

export type RgTone = "ok" | "warn" | "neutral" | "info" | "bad" | "plain";

/** A status pill: soft tint, ink and a dot. */
export function RgBadge({ tone = "neutral", dot = true, children }: { tone?: RgTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`rg-st ${tone}`}>
      {dot && <i aria-hidden />}
      {children}
    </span>
  );
}

/** A switch's read-only twin: the state as a badge, never a greyed control. */
export function StateBadge({ on }: { on: boolean }) {
  const t = useTranslations("reglages");
  return <RgBadge tone={on ? "ok" : "neutral"}>{on ? t("common.active") : t("common.inactive")}</RgBadge>;
}

/** A read-only value with its unit. */
export function ReadOnlyValue({ value, unit, prefix }: { value: ReactNode; unit?: string; prefix?: string }) {
  return (
    <span className="rg-rov">
      {prefix && <small>{prefix} </small>}
      <span dir="ltr" className="num">
        {value}
      </span>
      {unit && <small> {unit}</small>}
    </span>
  );
}

/** An icon, a sentence, an action. */
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
    <div className="rg-empty">
      <span className={`ico${tone === "ok" ? " ok" : ""}`}>{icon}</span>
      <b>{title}</b>
      {text && <p>{text}</p>}
      {actions && <div className="mt-[8px] flex gap-[8px]">{actions}</div>}
    </div>
  );
}

/** A quiet info line above content. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rg-notice">
      <Info aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Market code chip (« LY »). */
export function CodeChip({ code, active = false }: { code: string; active?: boolean }) {
  return <span className={`rg-cc${active ? " on" : ""}`}>{code}</span>;
}

/** Shop / carrier / site mark: a soft square, or the uploaded logo. */
export function Mark({ children, size = 32, src }: { children: ReactNode; size?: number; /** An uploaded logo; the letters/icon stay the fallback. */ src?: string | null }) {
  return (
    <span style={{ width: size, height: size }} className="rg-mark">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- no images.remotePatterns configured
        <img src={src} alt="" />
      ) : (
        children
      )}
    </span>
  );
}

/** View pills: filters with counts, the current one in ink. */
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
    <div role="group" aria-label={label} className="rg-views">
      {items.map((it) => (
        <button key={it.value} type="button" aria-pressed={it.value === value} onClick={() => onChange(it.value)}>
          {it.label}
          <b className="n num">{it.count}</b>
        </button>
      ))}
    </div>
  );
}

/** Table cells. */
export const th = "rg-th";
export const td = "rg-td";
export const trClick = "rg-click";
export const trPlain = "";

/** The floating side panel: a header, scrolling sections, a footer. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations("reglages");
  return (
    <Sheet open={open} onClose={onClose} width="rg-drawer" ariaLabel={typeof title === "string" ? title : undefined}>
      <header>
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h3>{title}</h3>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="x">
          <X aria-hidden />
        </button>
      </header>
      <div className="db">{children}</div>
      {footer && <footer>{footer}</footer>}
    </Sheet>
  );
}

/** A section of a drawer: a soft glass box with an optional heading. */
export function DrawerSection({ title, end, children }: { title?: ReactNode; end?: ReactNode; children: ReactNode }) {
  return (
    <div className="rg-gl">
      {(title || end) && (
        <h4>
          {title}
          {end && <span className="end">{end}</span>}
        </h4>
      )}
      {children}
    </div>
  );
}

/** Label above, control, help below. */
export function Field({ label, htmlFor, help, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="rg-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

export const inputClass = "rg-input";

/** A switch with its label and a line of help. */
export function SwitchRow({ label, help, control }: { label: ReactNode; help?: ReactNode; control: ReactNode }) {
  return (
    <div className="rg-swrow">
      <div>
        <b>{label}</b>
        {help && <small>{help}</small>}
      </div>
      {control}
    </div>
  );
}
