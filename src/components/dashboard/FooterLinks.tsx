"use client";

import { useState } from "react";

interface FooterLinksProps {
  items: Array<{
    key: string;
    label: string;
    value: string;
    href?: string;
  }>;
}

export function FooterLinks({ items }: FooterLinksProps) {
  if (items.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      {items.map((it) => (
        <Pill key={it.key} label={it.label} value={it.value} href={it.href} />
      ))}
    </div>
  );
}

function Pill({ label, value, href }: { label: string; value: string; href?: string }) {
  const [hover, setHover] = useState(false);
  const content = (
    <>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </>
  );
  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    background: hover && href ? "#F7F7F7" : "#FFFFFF",
    border: "1px solid #E1E3E5",
    borderRadius: 9999,
    cursor: href ? "pointer" : "default",
    textDecoration: "none",
    transition: "background-color 120ms ease",
  };

  if (href) {
    return (
      <a
        href={href}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={baseStyle}
      >
        {content}
      </a>
    );
  }
  return <span style={baseStyle}>{content}</span>;
}
