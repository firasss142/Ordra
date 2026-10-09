"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { ChevronRight, Inbox, Megaphone, MessageCircle, Settings, Shield, Truck, X } from "lucide-react";
import type { TileFamily } from "@/lib/journal/types";

/**
 * Atoms of Journaux v3 — prototypes/journaux-v3.html (« Aurore calme »). They
 * render the prototype's classes, styled by journal.css under `.jx`, so every
 * panel takes the /feedback drawer and its glass blocks without changing shape.
 */

export type Sev = "ok" | "warn" | "fail" | "mute" | "off";

const AREA_ICON: Record<TileFamily, typeof Inbox> = {
  carrier: Truck,
  intake: Inbox,
  ads: Megaphone,
  msg: MessageCircle,
  auto: Settings,
  app: Shield,
};
/** One Commandes hue per area (`.h-*` in journal.css). */
export const AREA_HUE: Record<TileFamily, string> = {
  carrier: "h-blue",
  intake: "h-green",
  ads: "h-pink",
  msg: "h-teal",
  auto: "h-violet",
  app: "h-neutral",
};

/** `.thumb` — the soft square that says which area a problem, a system or a line belongs to. */
export function FamilyIcon({ family, small = false }: { family: TileFamily; small?: boolean; size?: number; gear?: boolean }) {
  const Icon = AREA_ICON[family];
  return (
    <span aria-hidden className={`thumb ${small ? "sm" : ""} ${AREA_HUE[family]}`}>
      <Icon className="ic" strokeWidth={1.9} />
    </span>
  );
}

/** `.area` — dot + area name, the Catégorie column. */
export function AreaPill({ family }: { family: TileFamily }) {
  const t = useTranslations("journaux.v3.areas");
  return (
    <span className={`area ${AREA_HUE[family]}`}>
      <i aria-hidden />
      {t(family)}
    </span>
  );
}

const AVATAR_TONES: [string, string][] = [
  ["#7A4BD8", "#5925DC"],
  ["#2E6BD9", "#175CD3"],
  ["#E46A7B", "#C11574"],
  ["#2F9E7A", "#107569"],
  ["#E9A23B", "#B54708"],
  ["#475467", "#1D2939"],
];
function toneOf(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

/** `.av` — a person's initials on their own colour; a dashed ring when nobody is recorded. */
export function Avatar({ name, seed, unknown, large }: { name: string | null; seed?: string | null; admin?: boolean; unknown?: boolean; large?: boolean }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (unknown) {
    return (
      <span aria-hidden className={`av unknown ${large ? "lg" : ""}`}>
        ?
      </span>
    );
  }
  const [a5, a7] = toneOf(seed ?? name ?? "?");
  return (
    <span aria-hidden className={`av ${large ? "lg" : ""}`} style={{ "--a5": a5, "--a7": a7 } as CSSProperties}>
      {initials || "?"}
    </span>
  );
}

/** `.st` — a dot and a word. Colour is never alone. */
export function Pill({ sev, children }: { sev: Sev; children: ReactNode }) {
  return (
    <span className={`st ${sev}`}>
      <i aria-hidden />
      {children}
    </span>
  );
}

/** A system's state — the same pill. */
export function StateLine({ sev, children }: { sev: Sev; children: ReactNode }) {
  return <Pill sev={sev}>{children}</Pill>;
}

/** « Échec » / « À vérifier » in a history line's Résultat column. */
export function Flag({ sev, children }: { sev: "fail" | "warn"; children: ReactNode }) {
  return <Pill sev={sev}>{children}</Pill>;
}

export function Chevron() {
  return <ChevronRight className="chv flip" aria-hidden />;
}

/** `.drawer` — the floating glass panel of /feedback: icon, eyebrow, title, sub line, blocks, foot. */
export function Panel({
  onClose,
  title,
  sub,
  children,
  footer,
  wide,
  icon,
  eyebrow,
}: {
  open?: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const t = useTranslations("journaux");
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: false, fallbackFocus: () => ref.current ?? document.body }}>
      <div>
        <div className="scrim" aria-hidden onClick={onClose} />
        <aside ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={`drawer ${wide ? "wide" : ""}`}>
          <div className="dh">
            {icon}
            <div className="min-w-0">
              {eyebrow && <div className="eyebrow">{eyebrow}</div>}
              <h2>{title}</h2>
              {sub && <div className="s">{sub}</div>}
            </div>
            <button type="button" className="x" onClick={onClose} aria-label={t("common.close")}>
              <X className="ic" aria-hidden />
            </button>
          </div>
          <div className="db">{children}</div>
          {footer && <div className="df">{footer}</div>}
        </aside>
      </div>
    </FocusTrap>
  );
}

/** `.gl` — one glass block of a drawer, with its small-caps heading. */
export function Block({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="gl">
      {title && <h4>{title}</h4>}
      {children}
    </section>
  );
}

export function H4({ children }: { children: ReactNode }) {
  return <h4>{children}</h4>;
}

export function P({ children, strong }: { children: ReactNode; small?: boolean; strong?: boolean }) {
  return <p className={strong ? "strong" : undefined}>{children}</p>;
}

/** `.figs` — the « Combien » numbers, one white card each. */
export function Figures({ items }: { items: { value: string; label: string; fail?: boolean }[] }) {
  return (
    <div className="figs">
      {items.map((it) => (
        <div key={it.label} className={`fig ${it.fail ? "bad" : ""}`}>
          <b>{it.value}</b>
          <small>{it.label}</small>
        </div>
      ))}
    </div>
  );
}

/** `.steps` — « Que faire », numbered in brand green. */
export function Steps({ items }: { items: string[] }) {
  return (
    <ol className="steps">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return <div className="callout">{children}</div>;
}

/** `details.tech` — the technical part, folded, in its own block. */
export function Tech({ children }: { children: ReactNode }) {
  const t = useTranslations("journaux");
  return (
    <details className="gl tech">
      <summary>
        <ChevronRight className="ic flip" aria-hidden />
        {t("common.tech")}
      </summary>
      <div className="tb">{children}</div>
    </details>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <div dir="ltr" className="code">
      {children}
    </div>
  );
}

export function MiniTable({ rows }: { rows: ReactNode[][] }) {
  return (
    <table className="mt">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const BAR: Record<string, string> = { o: "o", f: "f", i: "i", m: "m", "-": "x" };

/** `.hb` — one bar per hour over 48 h; « expected, absent » is amber, « not expected » a dotted floor. */
export function Bars({ bars, label }: { bars: string; label?: string }) {
  const t = useTranslations("journaux");
  return (
    <span className="hb" dir="ltr" role="img" aria-label={label ?? t("bars.title")}>
      {[...bars].map((c, i) => (
        <i key={i} className={BAR[c] ?? "x"} title={t.has(`bars.${c}`) ? t(`bars.${c}`) : undefined} />
      ))}
    </span>
  );
}

export function HourBars({ bars }: { bars: string }) {
  const t = useTranslations("journaux");
  return (
    <>
      <div style={{ height: 30 }}>
        <Bars bars={bars} />
      </div>
      <div className="bars-axis" dir="ltr">
        <span>{t("bars.from")}</span>
        <span>{t("bars.to")}</span>
      </div>
      <p style={{ marginTop: 8, fontSize: 12.5 }}>{t("bars.legend")}</p>
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
  const cls = primary ? "btn" : quiet ? "btn ghost" : "btn2";
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
