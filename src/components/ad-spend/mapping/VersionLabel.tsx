"use client";

import { useTranslations } from "next-intl";
import { CircleHelp, CornerDownRight, Globe } from "lucide-react";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import type { MappingProductDTO, MappingVersionDTO } from "@/lib/ad-spend/mapping-types";

/**
 * What a campaign or ad set sells, in pictures first — the three boxing dolls
 * differ only by one Arabic word, their photos do not.
 */

export function ProductThumb({ id, products, size }: { id: string; products: Map<string, MappingProductDTO>; size: number }) {
  const p = products.get(id);
  return (
    <span className={`inline-flex flex-none ${p && !p.is_active ? "grayscale opacity-55" : ""}`}>
      <ProductAvatar imageUrl={p?.image_url ?? null} productName={p?.name ?? id} size={size} />
    </span>
  );
}

/** Two products, overlapped corner to corner. */
export function ProductStack({ ids, products, box, size }: { ids: string[]; products: Map<string, MappingProductDTO>; box: [number, number]; size: number }) {
  return (
    <span className="relative inline-block flex-none" style={{ width: box[0], height: box[1] }} aria-hidden>
      <span className="absolute top-0 start-0 rounded-md ring-2 ring-white">
        <ProductThumb id={ids[0]} products={products} size={size} />
      </span>
      <span className="absolute bottom-0 end-0 rounded-md ring-2 ring-white">
        <ProductThumb id={ids[1]} products={products} size={size} />
      </span>
    </span>
  );
}

/** The 36 px picture at the start of a campaign row. */
export function CampaignThumb({
  version,
  waiting,
  products,
}: {
  version: MappingVersionDTO | null;
  /** Money is waiting: the empty slot turns amber. */
  waiting: boolean;
  products: Map<string, MappingProductDTO>;
}) {
  if (!version || version.kind === "inherit") {
    return (
      <span
        aria-hidden
        className={`w-9 h-9 flex-none grid place-items-center rounded-[10px] border-[1.5px] border-dashed ${
          waiting ? "border-[#E8B44A] text-ads-orange-ink bg-[#FFFBEB]" : "border-line-strong text-ink-muted"
        }`}
      >
        <CircleHelp size={17} />
      </span>
    );
  }
  if (version.kind === "market_level" || version.lines.length === 0) {
    return (
      <span aria-hidden className="w-9 h-9 flex-none grid place-items-center rounded-[10px] bg-line-subtle text-ink-secondary">
        <Globe size={17} />
      </span>
    );
  }
  if (version.lines.length === 1) return <ProductThumb id={version.lines[0].product_id} products={products} size={36} />;
  return <ProductStack ids={version.lines.map((l) => l.product_id)} products={products} box={[36, 36]} size={26} />;
}

/** One line: what a version sells, or that it follows its campaign. */
export function VersionLabel({
  version,
  products,
}: {
  /** null = follows its campaign. */
  version: MappingVersionDTO | null;
  products: Map<string, MappingProductDTO>;
}) {
  const t = useTranslations("adSpend.mapping");

  if (!version || version.kind === "inherit") {
    return (
      <>
        <CornerDownRight size={13} className="flex-none rtl:-scale-x-100" aria-hidden />
        <span>{t("sameAsCampaign")}</span>
      </>
    );
  }
  if (version.kind === "market_level" || version.lines.length === 0) {
    return (
      <>
        <Globe size={13} className="flex-none" aria-hidden />
        <span>{t("general")}</span>
      </>
    );
  }
  if (version.lines.length === 1) {
    const id = version.lines[0].product_id;
    return (
      <>
        <ProductThumb id={id} products={products} size={18} />
        <bdi className="truncate">{products.get(id)?.name ?? id}</bdi>
      </>
    );
  }
  return (
    <>
      <ProductStack ids={version.lines.map((l) => l.product_id)} products={products} box={[26, 18]} size={16} />
      <span className="truncate">
        {t("multi", { count: version.lines.length, mode: version.split_mode === "manual" ? t("modeManual") : t("modeAuto") })}
      </span>
    </>
  );
}
