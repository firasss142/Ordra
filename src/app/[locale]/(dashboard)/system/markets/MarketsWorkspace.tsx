"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { MarketCard, type MarketRow, type MarketMetrics } from "@/components/markets/MarketCard";
import type { AuthUser } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props {
  user: AuthUser;
}

export function MarketsWorkspace({ user }: Props) {
  const isRtl = user.direction === "rtl";
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "fr";
  const canEdit = user.role === "super_admin";

  const { data: marketsData, mutate } = useSWR<{ data: MarketRow[] }>("/api/markets", fetcher);
  const today = new Date().toISOString().slice(0, 10);
  const { data: metricsData } = useSWR<{ data: MarketMetrics[] }>(
    `/api/metrics/cross-market?from_date=${today}&to_date=${today}`,
    fetcher,
  );

  const markets = marketsData?.data ?? [];
  const metricsMap = Object.fromEntries((metricsData?.data ?? []).map((m) => [m.market_id, m]));

  const [editing, setEditing] = useState<MarketRow | null>(null);

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-surface-page p-4 sm:p-6">
      <SettingsPageHeader
        title="Marchés"
        description="Chaque marché possède ses connexions, ses réglages et ses journaux. Cette page répond à une seule question : lequel demande votre attention ?"
        isRtl={isRtl}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {markets.map((m) => (
          <MarketCard
            key={m.id}
            market={m}
            metrics={metricsMap[m.id]}
            locale={locale}
            canEdit={canEdit}
            onEdit={setEditing}
          />
        ))}
        {marketsData && markets.length === 0 && (
          <div className="rounded-card border border-dashed border-line-strong bg-surface-sunken p-10 text-center text-[13px] text-ink-secondary">
            Aucun marché configuré.
          </div>
        )}

        {/* add-market impossibility note */}
        <div className="flex flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-line-strong bg-surface-sunken p-8 text-center text-ink-muted">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-6 w-6"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
          <b className="text-[13.5px] text-ink-secondary">Ajouter un marché</b>
          <span className="max-w-[36ch] text-[12.5px]">
            Indisponible : <span className="font-mono">markets.code</span> est contraint à <span className="font-mono">tn</span> et <span className="font-mono">ly</span>. Un nouveau marché passe par une migration.
          </span>
        </div>
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} placement="center" width="sm:w-[520px]" ariaLabel="Modifier le marché">
        {editing && (
          <EditMarketForm
            market={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); mutate(); }}
          />
        )}
      </Sheet>
    </div>
  );
}

function EditMarketForm({ market, onCancel, onSaved }: { market: MarketRow; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(market.name);
  const [language, setLanguage] = useState(market.language ?? (market.code === "ly" ? "ar" : "fr"));
  const [isActive, setIsActive] = useState(market.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/markets/${market.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, language, is_active: isActive }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Erreur lors de l'enregistrement");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-[16px] font-semibold text-ink-primary">Modifier le marché</h2>

      <Field label="Nom">
        <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-md border border-line px-3 text-[13.5px]" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Langue">
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-9 cursor-pointer rounded-md border border-line px-3 pe-8 text-[13.5px]">
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
          </select>
        </Field>
        <Field label="Devise 🔒 verrouillée">
          <input value={market.currency ?? (market.code === "ly" ? "LYD" : "TND")} disabled className="h-9 rounded-md border border-line bg-surface-hover px-3 text-[13.5px] text-ink-muted" />
        </Field>
      </div>
      <p className="-mt-2 text-[12px] text-ink-secondary">
        Modifier la devise réécrirait l'historique des commandes. Verrouillée dès la première commande.
      </p>

      <label className="flex items-center gap-3 text-[13px] text-ink-primary">
        <button
          type="button" role="switch" aria-checked={isActive} aria-label="Marché actif"
          onClick={() => setIsActive((v) => !v)}
          className={`relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors ${isActive ? "bg-brand" : "bg-line-strong"}`}
        >
          <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-pill bg-white shadow-hover-row transition-all ${isActive ? "start-[18px]" : "start-0.5"}`} />
        </button>
        <span>Marché actif</span>
      </label>

      {error && <p className="text-[13px] text-status-critical">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>Annuler</Button>
        <Button variant="primary" size="sm" disabled={saving} onClick={save}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-ink-secondary">{label}</span>
      {children}
    </div>
  );
}
