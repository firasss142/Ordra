"use client";

import { useTranslations } from "next-intl";

interface Variant {
  id: string;
  label: string;
  quantity: number;
  display_price: number;
  is_active: boolean;
}

interface ProductCostsReferenceCardProps {
  unitCogs: number;
  packingCost: number;
  cpl: number;
  processingCost: number;
  variants: Variant[];
}

function formatCost(value: number): string {
  return value.toFixed(3);
}

export function ProductCostsReferenceCard({
  unitCogs,
  packingCost,
  cpl,
  processingCost,
  variants,
}: ProductCostsReferenceCardProps) {
  const t = useTranslations("productPnl.costsReference");

  const stats = [
    { label: t("cogs"), value: formatCost(unitCogs) },
    { label: t("packing"), value: formatCost(packingCost) },
    { label: t("cpl"), value: formatCost(cpl) },
    { label: t("processing"), value: formatCost(processingCost) },
  ];

  const activeVariants = variants.filter((v) => v.is_active);

  return (
    <section className="mb-6 rounded-card border border-line-subtle bg-surface-card p-5">
      <h2 className="mb-4 text-[13px] font-medium uppercase tracking-[0.05em] text-ink-secondary">
        {t("title")}
      </h2>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
              {s.label}
            </div>
            <div className="mt-1 text-[18px] font-semibold tabular-nums text-ink-primary">
              {s.value}
            </div>
          </div>
        ))}
      </div>
      {activeVariants.length > 0 ? (
        <div className="mt-5 border-t border-line-subtle pt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
            {t("variants")}
          </div>
          <div className="flex flex-wrap gap-2">
            {activeVariants.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center gap-1.5 rounded-card border border-line-subtle bg-surface-page px-3 py-1 text-[13px] text-ink-primary"
              >
                <span className="font-medium">{v.label}</span>
                <span className="text-ink-secondary">·</span>
                <span className="tabular-nums text-ink-secondary">
                  ×{v.quantity}
                </span>
                <span className="text-ink-secondary">·</span>
                <span className="tabular-nums">
                  {Number(v.display_price).toFixed(3)}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
