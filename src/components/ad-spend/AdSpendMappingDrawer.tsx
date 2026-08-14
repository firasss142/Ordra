"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { useMetaCampaigns } from "@/hooks/useMetaCampaigns";
import type { CampaignsProduct } from "@/hooks/useAdSpendCampaigns";

/**
 * Campaign → product, declared once by a human.
 *
 * This drawer exists because no order in this system carries ad attribution —
 * all 7,137 production orders were checked and there is no utm_*, no fbclid and
 * no campaign id anywhere, in columns or in `raw_payload`, for either storefront
 * platform. There is no click-level join to be had, so attribution has to be
 * asserted rather than derived, and campaign → product is the honest ceiling.
 *
 * Saving re-stamps that campaign's existing `ad_spend` rows, so a mapping
 * corrects history rather than only affecting the next sync. Leaving a campaign
 * unmapped is not a hole: its spend already counts at market level in the P&L,
 * and only its per-product attribution is pending.
 */

interface Props {
  marketId: string;
  fromDate: string;
  toDate: string;
  currency: string;
  products: CampaignsProduct[];
  onClose: () => void;
  onSaved: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

export function AdSpendMappingDrawer({
  marketId,
  fromDate,
  toDate,
  currency,
  products,
  onClose,
  onSaved,
}: Props) {
  const t = useTranslations("adSpend.economics");
  const { campaigns, isLoading, mutate } = useMetaCampaigns({ marketId, fromDate, toDate });

  // "" means market-level, which is a real decision and not an empty field.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(
      Object.fromEntries(campaigns.map((c) => [c.external_campaign_id, c.product_id ?? ""])),
    );
  }, [campaigns]);

  const dirty = campaigns.filter(
    (c) => (draft[c.external_campaign_id] ?? "") !== (c.product_id ?? ""),
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      for (const c of dirty) {
        const res = await fetch("/api/meta/campaigns/mappings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ad_account_id: c.ad_account_id,
            external_campaign_id: c.external_campaign_id,
            campaign_name: c.campaign_name,
            market_id: marketId,
            product_id: draft[c.external_campaign_id] || null,
          }),
        });
        if (!res.ok) throw new Error(`mapping ${res.status}`);
      }
      await mutate();
      onSaved();
      onClose();
    } catch {
      setError(t("mappingSaveError"));
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, marketId, mutate, onSaved, onClose, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(26,26,26,0.4)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("mapCampaigns")}
        className="bg-surface-card w-[640px] max-w-full h-full flex flex-col shadow-floating"
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-ads-line">
          <div>
            <h2 className="text-[15px] font-semibold text-ads-ink-1">{t("mapCampaigns")}</h2>
            <p className="text-[12px] text-ads-ink-2 mt-0.5 leading-relaxed max-w-[60ch]">
              {t("mappingHint")}
            </p>
          </div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="p-1.5 rounded-[6px] text-ads-ink-2 hover:bg-surface-selected hover:text-ads-ink-1"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="px-5 py-6 text-[13px] text-ads-ink-2">{t("loading")}</p>
          ) : campaigns.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-ads-ink-2 leading-relaxed">
              {t("mappingEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-ads-line">
              {campaigns.map((c) => (
                <li key={c.external_campaign_id} className="px-5 py-3.5 flex flex-col gap-2">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-ads-ink-1">
                      {c.campaign_name ?? c.external_campaign_id}
                    </span>
                    {c.product_id === null && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-[6px] bg-ads-orange-bg text-ads-orange-ink">
                        {t("verdictAttach")}
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-ads-ink-2 tabular-nums">
                    {fmt(c.spend)} {currency} · {c.days} {t("days")} · {fmt(c.impressions)}{" "}
                    {t("impressions")} · {c.external_campaign_id}
                  </p>
                  <select
                    value={draft[c.external_campaign_id] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [c.external_campaign_id]: e.target.value }))
                    }
                    className="border border-line rounded-[6px] px-2.5 py-2 text-[13px] bg-surface-card text-ads-ink-1"
                  >
                    <option value="">{t("marketLevel")}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-ads-line px-5 py-3.5 flex items-center gap-3">
          {error && (
            <p role="alert" className="text-[12.5px] text-ads-red-ink">
              {error}
            </p>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="border border-ads-line-2 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold bg-surface-card text-ads-ink-1 hover:bg-surface-sunken"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || dirty.length === 0}
            className="inline-flex items-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold bg-ads-green-ink text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t("saveMappings", { count: dirty.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
