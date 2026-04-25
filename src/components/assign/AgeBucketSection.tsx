"use client";

import { useTranslations } from "next-intl";
import type { AgeBucket } from "@/lib/assign/age-bucket";
import { getBucketAccent } from "@/lib/assign/age-bucket";

const ACCENT_COLOR: Record<string, string> = {
  neutral: "#6D7175",
  action: "#2C6ECB",
  success: "#008060",
  warning: "#B98900",
  critical: "#D72C0D",
};

interface Props {
  bucket: AgeBucket;
  count: number;
  selectedCount?: number;
  onToggleAll?: (checked: boolean) => void;
  children: React.ReactNode;
}

export function AgeBucketSection({
  bucket,
  count,
  selectedCount = 0,
  onToggleAll,
  children,
}: Props) {
  const t = useTranslations("assign.bucket");
  const tAssign = useTranslations("assign");
  const accent = getBucketAccent(bucket);
  const color = ACCENT_COLOR[accent];

  if (count === 0) return null;

  const allSelected = count > 0 && selectedCount === count;

  return (
    <section style={{ marginBottom: 20 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        {onToggleAll ? (
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = selectedCount > 0 && !allSelected;
            }}
            onChange={(e) => onToggleAll(e.target.checked)}
            aria-label={tAssign("selectBucket", { bucket: t(bucket) })}
            style={{ cursor: "pointer" }}
          />
        ) : null}
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 9999,
            background: color,
          }}
        />
        <h2 style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t(bucket)}
        </h2>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "#6D7175",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </section>
  );
}
