"use client";

import React from "react";

/* Chrome partagé par les formulaires produit (création et édition).
   Extrait de ProductEditForm : les deux pages doivent porter le même
   système visuel, sinon la page de création redevient l'ancienne. */

export type Tone = "brand" | "info" | "warn" | "neutral";
export type Permission = "superAdmin" | "marketManager";

export const ICON_TONE: Record<Tone, string> = {
  brand: "bg-prod-brand-soft text-prod-brand",
  info: "bg-prod-info-bg text-status-action",
  warn: "bg-status-warningBg text-hue-amber-ink",
  neutral: "bg-prod-neutral-bg text-ink-secondary",
};

export const CHIP_TONE: Record<Permission, string> = {
  superAdmin: "bg-status-warningBg text-hue-amber-ink",
  marketManager: "bg-prod-info-bg text-status-action",
};

/* Field chrome — 12px radius, green focus ring, logical padding throughout. */
export const CONTROL =
  "w-full rounded-xl border border-line bg-surface-card px-3.5 py-2.5 text-[13.5px] text-ink-primary " +
  "transition-colors duration-fast placeholder:text-ink-muted hover:border-line-strong " +
  "focus:border-prod-brand focus:outline-none focus:ring-[3px] focus:ring-prod-brand-soft " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted";
export const TEXTAREA = `${CONTROL} min-h-[76px] resize-y leading-relaxed`;
export const SELECT = `${CONTROL} appearance-none pe-9`;

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function Svg({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ICONS = {
  identity: (s: number) => (
    <Svg size={s}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Svg>
  ),
  sheet: (s: number) => (
    <Svg size={s}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </Svg>
  ),
  composition: (s: number) => (
    <Svg size={s}>
      <path d="M21 8v8l-9 5-9-5V8l9-5 9 5Z" />
      <path d="m3 8 9 5 9-5" />
    </Svg>
  ),
  cost: (s: number) => (
    <Svg size={s}>
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </Svg>
  ),
  stock: (s: number) => (
    <Svg size={s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  margin: (s: number) => (
    <Svg size={s}>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 5-6" />
    </Svg>
  ),
  agent: (s: number) => (
    <Svg size={s}>
      <circle cx="12" cy="8" r="4" />
      <path d="M18 20a6 6 0 0 0-12 0" />
    </Svg>
  ),
  warning: (s: number) => (
    <Svg size={s}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  ),
  info: (s: number) => (
    <Svg size={s}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </Svg>
  ),
  save: (s: number) => (
    <Svg size={s}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </Svg>
  ),
  chevron: (s: number) => (
    <Svg size={s}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
};

/* ── primitives de formulaire ───────────────────────────────────────── */

export function FieldShell({
  id,
  label,
  hint,
  required,
  footer,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  required?: boolean;
  footer?: React.ReactNode;
  children: (a: { id: string; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-ink-primary">
        {label}
        {required && (
          <span aria-hidden="true" className="ms-1 text-status-critical">
            *
          </span>
        )}
      </label>
      {children({ id, "aria-describedby": hintId })}
      {footer}
      {hint && (
        <p id={hintId} className="text-[11.5px] leading-normal text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Native select with a token-coloured chevron instead of the OS triangle. */
export function SelectShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-ink-secondary">
        {ICONS.chevron(16)}
      </span>
    </div>
  );
}

/** Number input carrying its currency on the inline-end edge. */
export function UnitShell({
  suffix,
  children,
}: {
  suffix?: string;
  children: React.ReactNode;
}) {
  if (!suffix) return <>{children}</>;
  return (
    <div className="relative">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 end-3.5 flex items-center text-xs font-medium text-ink-muted"
      >
        {suffix}
      </span>
    </div>
  );
}

export function FormSection({
  id,
  title,
  icon,
  tone,
  permission,
  permissionLabel,
  permissionTitle,
  hint,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  tone: Tone;
  permission: Permission;
  permissionLabel: string;
  permissionTitle: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-line-subtle px-6 py-[22px] last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "grid h-[30px] w-[30px] flex-none place-items-center rounded-card",
            ICON_TONE[tone],
          )}
        >
          {icon}
        </span>
        <h3 className="text-[15.5px] font-semibold tracking-[-0.014em] text-ink-primary">
          {title}
        </h3>
        <span
          title={permissionTitle}
          className={cx(
            "ms-auto inline-flex h-6 flex-none items-center rounded-lg px-2.5 text-[11.5px] font-semibold",
            CHIP_TONE[permission],
          )}
        >
          {permissionLabel}
        </span>
      </div>
      <p className="mb-[17px] ms-[42px] mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
        {hint}
      </p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function AsideCard({
  label,
  icon,
  tone,
  className,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  tone: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "rounded-card border border-line-subtle bg-surface-card px-5 py-[17px] shadow-hover-row",
        className,
      )}
    >
      <h4 className="flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.09em] text-ink-secondary">
        <span
          className={cx(
            "grid h-[25px] w-[25px] flex-none place-items-center rounded-lg",
            ICON_TONE[tone],
          )}
        >
          {icon}
        </span>
        {label}
      </h4>
      {children}
    </div>
  );
}
