"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Globe2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMarketScope } from "@/context/market-scope";
import { marketFlag, type MarketScope } from "@/lib/markets";
import type { AuthUser } from "@/types";

const OPTIONS: readonly MarketScope[] = ["tn", "ly", "all"];

/**
 * A market's mark: its flag, or a globe for the cross-market scope.
 *
 * The coloured-dot branch this used to carry was unreachable — every real
 * market had a flag and "all" had the globe — so it was a third vocabulary that
 * only ever cost a reader time working out whether it meant something.
 */
function ScopeGlyph({ scope, size = 14 }: { scope: MarketScope; size?: number }) {
  const flag = marketFlag(scope);

  if (!flag) {
    return (
      <Globe2
        size={size}
        strokeWidth={1.75}
        aria-hidden="true"
        style={{ color: "var(--sidebar-text-secondary)", flexShrink: 0 }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        fontSize: size,
        lineHeight: 1,
        flexShrink: 0,
        // Colour emoji ignore `color`, so no theming is needed or possible.
        fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
      }}
    >
      {flag}
    </span>
  );
}

export function MarketScopeSwitcher({ user }: { user: AuthUser }) {
  const t = useTranslations("nav");
  const { scope, setScope } = useMarketScope();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  if (user.role !== "super_admin") return null;

  const isRtl = user.direction === "rtl";
  const active = OPTIONS.includes(scope) ? scope : OPTIONS[0];
  const triggerActive = open || hovered;

  return (
    <div ref={ref} style={{ position: "relative", direction: isRtl ? "rtl" : "ltr" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("markets.label", { default: "Marché" })}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 28,
          paddingInlineStart: 10,
          paddingInlineEnd: 8,
          borderRadius: 9999,
          border: `1px solid ${
            triggerActive
              ? "var(--sidebar-text-muted)"
              : "var(--sidebar-border-strong)"
          }`,
          backgroundColor: triggerActive
            ? "var(--sidebar-hover-strong)"
            : "var(--sidebar-bg-elevated)",
          color: "var(--sidebar-text-strong)",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1,
          whiteSpace: "nowrap",
          transition:
            "background-color 140ms ease, border-color 140ms ease, color 140ms ease",
        }}
      >
        <ScopeGlyph scope={active} />
        <span style={{ letterSpacing: "0.01em" }}>{t(`markets.${active}`)}</span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          aria-hidden="true"
          style={{
            color: "var(--sidebar-text-muted)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 160ms cubic-bezier(0.4, 0, 0.2, 1)",
            marginInlineStart: 1,
          }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="market-scope-menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            insetInlineStart: 0,
            minWidth: 188,
            padding: 6,
            borderRadius: 10,
            backgroundColor: "var(--sidebar-bg-elevated)",
            border: "1px solid var(--sidebar-border-strong)",
            boxShadow:
              "0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)",
            zIndex: 30,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--sidebar-text-muted)",
              padding: "6px 10px 4px",
            }}
          >
            {t("markets.label", { default: "Marché" })}
          </div>
          {OPTIONS.map((opt) => (
            <MenuOption
              key={opt}
              scope={opt}
              label={t(`markets.${opt}`)}
              selected={scope === opt}
              isRtl={isRtl}
              onClick={() => {
                setScope(opt);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
      <style>{`
        .market-scope-menu {
          animation: market-scope-menu-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
          transform-origin: top ${isRtl ? "right" : "left"};
        }
        @keyframes market-scope-menu-in {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(-4px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function MenuOption({
  label,
  scope,
  selected,
  isRtl,
  onClick,
}: {
  label: string;
  scope: MarketScope;
  selected: boolean;
  isRtl: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const highlight = hovered || selected;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        all: "unset",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        height: 34,
        padding: "0 10px",
        borderRadius: 7,
        cursor: "pointer",
        color: selected
          ? "var(--sidebar-text-strong)"
          : "var(--sidebar-text)",
        fontSize: 13,
        fontWeight: selected ? 500 : 400,
        backgroundColor: highlight
          ? selected
            ? "var(--sidebar-hover-strong)"
            : "var(--sidebar-hover)"
          : "transparent",
        transition: "background-color 120ms ease, color 120ms ease",
        textAlign: isRtl ? "right" : "left",
      }}
    >
      <ScopeGlyph scope={scope} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {selected ? (
        <Check
          size={14}
          strokeWidth={2.25}
          aria-hidden="true"
          style={{ color: "var(--sidebar-text-strong)", flexShrink: 0 }}
        />
      ) : (
        <span aria-hidden="true" style={{ width: 14, flexShrink: 0 }} />
      )}
    </button>
  );
}
