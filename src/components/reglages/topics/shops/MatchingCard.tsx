"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Check, Search } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { MarketCode } from "@/lib/markets";
import { SettingsCard, RgBadge, Drawer, DrawerSection } from "../../kit/parts";
import { RgButton } from "../../kit/RgButton";
import type { ShopRow } from "./common";

interface UnmatchedOrder {
  id: string;
  storefront_id: string;
  product_name: string;
  external_variant_id: string | null;
  external_product_id: string | null;
  customer_city: string | null;
}
interface ProductGroup {
  key: string;
  storefront_id: string;
  external_variant_id: string;
  external_product_id: string | null;
  name: string;
  count: number;
}
interface CityGroup {
  city: string;
  orderIds: string[];
}
type Option = { id: string; label: string; sub?: string };

/**
 * « Produits et villes à associer » — what used to be Correspondances, side by
 * side, without a nested tab. A product is matched once per shop and
 * reference; a city is set on each waiting order. A manager does it.
 */
export function MatchingCard({ marketId, marketCode, shops, editable }: { marketId: string; marketCode: MarketCode | null; shops: ShopRow[]; editable: boolean }) {
  const t = useTranslations("reglages");
  const toast = useToast();
  const { data: prodData, mutate: mutateProducts } = useSWR<{ data: UnmatchedOrder[] }>(`/api/mappings/unmatched?type=products&market_id=${marketId}`);
  const { data: cityData, mutate: mutateCities } = useSWR<{ data: UnmatchedOrder[] }>(`/api/mappings/unmatched?type=cities&market_id=${marketId}`);
  const [binding, setBinding] = useState<{ kind: "product"; group: ProductGroup } | { kind: "city"; group: CityGroup } | null>(null);

  const products = useMemo(() => {
    const map = new Map<string, ProductGroup>();
    for (const o of prodData?.data ?? []) {
      if (!o.external_variant_id) continue;
      const key = `${o.storefront_id}:${o.external_variant_id}`;
      const g = map.get(key) ?? { key, storefront_id: o.storefront_id, external_variant_id: o.external_variant_id, external_product_id: o.external_product_id, name: o.product_name, count: 0 };
      g.count += 1;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [prodData]);
  const cities = useMemo(() => {
    const map = new Map<string, CityGroup>();
    for (const o of cityData?.data ?? []) {
      if (!o.customer_city) continue;
      const g = map.get(o.customer_city) ?? { city: o.customer_city, orderIds: [] };
      g.orderIds.push(o.id);
      map.set(o.customer_city, g);
    }
    return Array.from(map.values()).sort((a, b) => b.orderIds.length - a.orderIds.length);
  }, [cityData]);

  const pending = (n: number) => (n === 1 ? t("matching.pendingOne") : t("matching.pendingMany", { n }));
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? "—";
  const allMatched = (text: string) => (
    <div className="grid grid-cols-[auto_1fr] items-center gap-[10px] border-t border-line-subtle px-[16px] py-[10px]">
      <RgBadge tone="ok" dot={false}>
        <Check className="h-[12px] w-[12px]" aria-hidden />
        {t("matching.allMatched")}
      </RgBadge>
      <small className="text-[12.5px] text-ink-secondary">{text}</small>
    </div>
  );

  return (
    <SettingsCard title={t("matching.title")} description={t("matching.desc")}>
      <div className="grid md:grid-cols-2">
        <div className="min-w-0">
          <h4 className="m-0 flex items-center gap-[8px] px-[16px] pb-[4px] pt-[12px] text-[13.5px] font-semibold">
            {t("matching.products")}
            <RgBadge tone={products.length ? "warn" : "neutral"} dot={false}>{products.length}</RgBadge>
          </h4>
          {prodData && products.length === 0
            ? allMatched(t("matching.noProduct"))
            : products.map((g) => (
                <div key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[10px] border-t border-line-subtle px-[16px] py-[10px]">
                  <div className="min-w-0">
                    <b className="block truncate font-semibold">{g.name}</b>
                    <small className="text-[12.5px] text-ink-secondary">
                      {shopName(g.storefront_id)} · {t("matching.ref", { ref: g.external_variant_id })} · {pending(g.count)}
                    </small>
                  </div>
                  {editable && (
                    <RgButton size="sm" onClick={() => setBinding({ kind: "product", group: g })}>
                      {t("matching.associate")}
                    </RgButton>
                  )}
                </div>
              ))}
        </div>
        <div className="min-w-0 border-line-subtle md:border-s">
          <h4 className="m-0 flex items-center gap-[8px] px-[16px] pb-[4px] pt-[12px] text-[13.5px] font-semibold">
            {t("matching.cities")}
            <RgBadge tone={cities.length ? "warn" : "neutral"} dot={false}>{cities.length}</RgBadge>
          </h4>
          {cityData && cities.length === 0
            ? allMatched(t("matching.noCity"))
            : cities.map((g) => (
                <div key={g.city} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[10px] border-t border-line-subtle px-[16px] py-[10px]">
                  <div className="min-w-0">
                    <b className="block truncate font-semibold">{g.city}</b>
                    <small className="text-[12.5px] text-ink-secondary">{pending(g.orderIds.length)}</small>
                  </div>
                  {editable && (
                    <RgButton size="sm" onClick={() => setBinding({ kind: "city", group: g })}>
                      {t("matching.associate")}
                    </RgButton>
                  )}
                </div>
              ))}
        </div>
      </div>
      {binding && (
        <BindDrawer
          marketId={marketId}
          kind={binding.kind}
          title={binding.kind === "product" ? t("matching.productTitle") : t("matching.cityTitle")}
          subtitle={
            binding.kind === "product"
              ? t("matching.productSubtitle", { name: binding.group.name, shop: shopName(binding.group.storefront_id), pending: pending(binding.group.count) })
              : t("matching.citySubtitle", { name: binding.group.city, pending: pending(binding.group.orderIds.length) })
          }
          onClose={() => setBinding(null)}
          onBind={async (optionId) => {
            let ok = true;
            if (binding.kind === "product") {
              const g = binding.group;
              const res = await fetch("/api/mappings/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ storefront_id: g.storefront_id, external_variant_id: g.external_variant_id, external_product_id: g.external_product_id, product_id: optionId }),
              });
              ok = res.ok;
              await mutateProducts();
            } else {
              const field = marketCode === "ly" ? "darb_destination_id" : "city_id";
              const value = marketCode === "ly" ? Number(optionId) : optionId;
              const results = await Promise.all(
                binding.group.orderIds.map((orderId) =>
                  fetch("/api/mappings/cities", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ order_id: orderId, [field]: value }),
                  }),
                ),
              );
              ok = results.every((r) => r.ok);
              await mutateCities();
            }
            toast.show({ message: ok ? t("matching.done") : t("common.error"), tone: ok ? "info" : "critical" });
            if (ok) setBinding(null);
          }}
        />
      )}
    </SettingsCard>
  );
}

function BindDrawer({
  marketId,
  kind,
  title,
  subtitle,
  onClose,
  onBind,
}: {
  marketId: string;
  kind: "product" | "city";
  title: string;
  subtitle: string;
  onClose: () => void;
  onBind: (optionId: string) => Promise<void>;
}) {
  const t = useTranslations("reglages");
  const { data: products } = useSWR<{ data: { id: string; name: string; sku?: string | null }[] }>(kind === "product" ? `/api/products?market_id=${marketId}` : null);
  const { data: destinations } = useSWR<{ data: { id: string | number; city?: string; area?: string; name?: string; name_ar?: string }[] }>(
    kind === "city" ? `/api/mappings/cities?market_id=${marketId}` : null,
  );
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: Option[] =
    kind === "product"
      ? (products?.data ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.sku ?? undefined }))
      : (destinations?.data ?? []).map((d) => ({ id: String(d.id), label: d.city ? (d.area ? `${d.city} — ${d.area}` : d.city) : d.name ?? "", sub: d.name_ar }));
  const needle = q.trim().toLowerCase();
  const shown = (needle ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(needle)) : options).slice(0, 50);

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          {error && (
            <span role="alert" className="text-[12.5px] text-status-critical">
              {error}
            </span>
          )}
          <span className="flex-1" />
          <RgButton onClick={onClose}>{t("common.cancel")}</RgButton>
          <RgButton
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (!picked) {
                setError(t("matching.pick"));
                return;
              }
              setBusy(true);
              await onBind(picked);
              setBusy(false);
            }}
          >
            {t("matching.associate")}
          </RgButton>
        </>
      }
    >
      <DrawerSection>
        <label className="mb-[12px] flex h-[40px] items-center gap-[8px] rounded-[11px] border border-[rgba(15,23,40,.12)] bg-white px-[12px] focus-within:border-brand">
          <Search className="h-[16px] w-[16px] text-ink-secondary" aria-hidden />
          <input
            className="flex-1 border-0 bg-transparent outline-none"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={kind === "product" ? t("matching.searchProduct") : t("matching.searchCity")}
            aria-label={kind === "product" ? t("matching.searchProduct") : t("matching.searchCity")}
          />
        </label>
        <div role="radiogroup" aria-label={title}>
          {shown.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-secondary">{t("matching.nothingFound")}</p>
          ) : (
            shown.map((o) => (
              <label key={o.id} className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-[12px] border-b border-line-subtle py-[10px] last:border-b-0">
                <span>
                  <b className="block font-medium">{o.label}</b>
                  {o.sub && <small className="text-[12.5px] text-ink-secondary">{o.sub}</small>}
                </span>
                <input type="radio" name="rg-bind" className="h-[18px] w-[18px] accent-[var(--brand)]" checked={picked === o.id} onChange={() => setPicked(o.id)} aria-label={o.label} />
              </label>
            ))
          )}
        </div>
      </DrawerSection>
      <DrawerSection>
        <p className="m-0 text-[13px] text-ink-secondary">{kind === "product" ? t("matching.productEffect") : t("matching.cityEffect")}</p>
      </DrawerSection>
    </Drawer>
  );
}
