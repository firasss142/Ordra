"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import { Num, Sparkline, Thumb, isLow } from "@/components/warehouse/product/stock-bits";

/**
 * One product on the agent's phone — prototypes/entrepot-day-loop-agent-v3.html,
 * `R.stock` › `.prod`, drawn in px (Ordra's root font is 14px).
 *
 * The whole row is the door to the product's page: thumb, the name, one line
 * « Registre 943 · Engagé 29 · sous le seuil », fourteen days of the balance in
 * the job's hue, and the FREE figure in bold — what can be promised. Reserved
 * units, the split by building, the movements and the count action all live on
 * the product's page; the row used to expand into them and push the next
 * product off the screen.
 */
export function StockCard({ row, locale }: { row: WarehouseStockRow; locale: string }) {
  const t = useTranslations("warehouse.stock");
  const low = isLow(row);

  return (
    <Link
      href={`/${locale}/warehouse/stock/${row.product_id}`}
      data-testid="wh-stock-card"
      data-low={low ? "true" : "false"}
      className="flex min-h-[72px] w-full items-center gap-[12px] border-t border-line-subtle p-[14px] text-start text-wh-ink-1 no-underline first:border-t-0 active:bg-wh-surface-2"
    >
      <Thumb src={row.image_url} size={40} radius={10} icon={<Boxes size={18} strokeWidth={2} />} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold" dir="auto">{row.name}</p>
        <p data-testid="wh-stock-meta" className="truncate text-[12.5px] text-wh-ink-2">
          {t("register")} <Num>{row.current_stock}</Num>
          {row.engaged > 0 ? (
            <>
              {" · "}
              {t("engaged")} <Num>{row.engaged}</Num>
            </>
          ) : null}
          {low ? (
            <>
              {" · "}
              <span className="text-status-critical">{t("low")}</span>
            </>
          ) : null}
        </p>
      </div>
      <Sparkline values={row.series} width={56} />
      <div className="shrink-0">
        <p
          data-testid="wh-stock-free"
          className={`text-end text-[20px] font-bold leading-[1.5] tracking-[-0.01em] ${
            row.free < 0 ? "text-status-critical" : ""
          }`}
        >
          <Num>{row.free}</Num>
        </p>
        <p className="text-end text-[12.5px] text-wh-ink-2">{t("free")}</p>
      </div>
    </Link>
  );
}
