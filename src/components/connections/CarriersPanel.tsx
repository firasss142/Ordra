"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { canManageCarriers } from "@/lib/settings-permissions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import {
  computeCarrierHealth,
  formatDeliveryRate,
  type CarrierHealthState,
} from "@/components/settings/carriers/CarrierHealthBadge";
import type { Role } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Carrier {
  id: string;
  market_id: string;
  name: string;
  code: string;
  api_endpoint: string;
  delivery_fee: number;
  return_fee: number;
  is_active: boolean;
}

interface PerfRow {
  carrier_id: string;
  delivered: number;
  returned: number;
  delivery_rate_30d: number | null;
  median_transit_hours: number | null;
  sample_size: number;
}

const HEALTH_TONE: Record<CarrierHealthState, { tone: "success" | "warning" | "critical" | "neutral"; label: string }> = {
  connected: { tone: "success", label: "Actif" },
  failing: { tone: "critical", label: "En erreur" },
  idle: { tone: "warning", label: "Silencieux" },
  inactive: { tone: "neutral", label: "Archivé" },
  unknown: { tone: "neutral", label: "Non testé" },
};

interface Props {
  role: Role;
  marketId: string;
  currency?: string;
  readOnly?: boolean;
}

export function CarriersPanel({ role, marketId, currency = "", readOnly = false }: Props) {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "fr";
  const { data, mutate, isLoading } = useSWR<{ data: Carrier[] }>(
    marketId ? `/api/carriers?market_id=${marketId}` : null,
    fetcher,
  );
  const { data: perfData } = useSWR<{ data: PerfRow[] }>(
    marketId ? `/api/carriers/performance?market_id=${marketId}` : null,
    fetcher,
    { refreshInterval: 60_000 },
  );
  const canManage = canManageCarriers(role) && !readOnly;
  const carriers = data?.data ?? [];
  const perfByCarrier = useMemo(() => {
    const m: Record<string, PerfRow> = {};
    for (const p of perfData?.data ?? []) m[p.carrier_id] = p;
    return m;
  }, [perfData]);

  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Carrier | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Carrier | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const rows = carriers
    .map((c) => {
      const perf = perfByCarrier[c.id];
      const health = computeCarrierHealth({
        is_active: c.is_active,
        reachable: null,
        delivery_rate_30d: perf?.delivery_rate_30d ?? null,
        sample_size: perf?.sample_size ?? 0,
      });
      return { c, perf, health };
    })
    .filter(({ c }) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.code.includes(search.toLowerCase()));

  async function toggleActive(c: Carrier) {
    if (!canManage) return;
    await mutate(
      (prev) => ({ data: (prev?.data ?? []).map((x) => (x.id === c.id ? { ...x, is_active: !c.is_active } : x)) }),
      false,
    );
    await fetch(`/api/carriers/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !c.is_active }),
    });
    mutate();
  }

  async function test(c: Carrier) {
    setTestResult((p) => ({ ...p, [c.id]: "…" }));
    try {
      const res = await fetch(`/api/carriers/${c.id}/test?mode=reachability`, { method: "POST" });
      const body = await res.json();
      setTestResult((p) => ({ ...p, [c.id]: body?.reachable ? "Accessible ✓" : `Injoignable — ${body?.error ?? "erreur"}` }));
    } catch {
      setTestResult((p) => ({ ...p, [c.id]: "Erreur réseau" }));
    }
  }

  async function archive(c: Carrier) {
    if (!canManage) return;
    await fetch(`/api/carriers/${c.id}`, { method: "DELETE" });
    mutate();
  }

  async function hardDelete(c: Carrier) {
    setBusy(true);
    try {
      const res = await fetch(`/api/carriers/${c.id}?hard=true`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert((body as { error?: string }).error ?? "Suppression impossible.");
        return;
      }
      setConfirmDelete(null);
      mutate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle bg-surface-sunken px-4 py-3">
        <div className="relative">
          <svg className="pointer-events-none absolute inset-inline-start-2.5 top-2 h-4 w-4 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un transporteur…"
            className="h-8 w-[240px] rounded-md border border-line ps-8 pe-3 text-[13px] text-ink-primary placeholder:text-ink-muted"
          />
        </div>
        {canManage && (
          <Link
            href={`/${locale}/settings/carriers`}
            className="ms-auto inline-flex h-8 items-center gap-2 rounded-lg border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover"
          >
            + Ajouter un transporteur
          </Link>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              {["Transporteur", "Marché", "État", "Livraison", "Retour", "Livraison 30 j", "Actif", ""].map((h, i) => (
                <th key={i} className={`whitespace-nowrap border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary ${i === 3 || i === 4 || i === 5 ? "text-end" : "text-start"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="px-4 py-8 text-center text-ink-secondary">Chargement…</td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-secondary">Aucun transporteur.</td></tr>}
            {rows.map(({ c, perf, health }) => {
              const meta = HEALTH_TONE[health];
              const menuItems: MenuItem[] = [
                { id: "detail", label: "Ouvrir le détail", onSelect: () => setDetail(c) },
                { id: "test", label: "Tester (accessibilité)", onSelect: () => test(c) },
              ];
              if (canManage) {
                if (c.is_active) menuItems.push({ id: "archive", label: "Archiver", destructive: true, onSelect: () => archive(c) });
                else menuItems.push({ id: "reactivate", label: "Réactiver", onSelect: () => toggleActive(c) });
                menuItems.push({ id: "delete", label: "Supprimer définitivement", destructive: true, onSelect: () => setConfirmDelete(c) });
              }
              return (
                <tr key={c.id} className={`border-b border-line-subtle hover:bg-surface-hover ${!c.is_active ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => setDetail(c)} className="text-start">
                      <span className="block font-semibold text-ink-primary">{c.name}</span>
                      <span className="block font-mono text-[12px] text-ink-secondary">{c.code}</span>
                      {testResult[c.id] && <span className="block text-[11px] text-ink-secondary">{testResult[c.id]}</span>}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">{c.market_id.endsWith("0001") ? "Tunisie" : "Libye"}</td>
                  <td className="px-4 py-2.5"><Badge tone={meta.tone} dot>{meta.label}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-end tabular-nums">{c.delivery_fee.toFixed(3)} {currency}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-end tabular-nums">{c.return_fee.toFixed(3)} {currency}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{formatDeliveryRate(perf?.delivery_rate_30d ?? null)}</td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button" role="switch" aria-checked={c.is_active} aria-label={`Actif ${c.name}`}
                      disabled={!canManage} onClick={() => toggleActive(c)}
                      className={`relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors ${c.is_active ? "bg-brand" : "bg-line-strong"} ${!canManage ? "opacity-50" : ""}`}
                    >
                      <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-pill bg-white shadow-hover-row transition-all ${c.is_active ? "start-[18px]" : "start-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Menu ariaLabel={`Actions ${c.name}`} trigger={<button type="button" aria-label={`Actions ${c.name}`} className="grid h-7 w-7 place-items-center rounded-md text-ink-secondary hover:bg-surface-selected">⋯</button>} items={menuItems} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line-subtle bg-surface-sunken px-4 py-2.5 text-[12.5px] text-ink-secondary">
        <b>Les frais vivent ici, pas dans les réglages du marché.</b> Chaque société de livraison porte ses frais de livraison et de retour.
      </div>

      <CarrierDrawer carrier={detail} currency={currency} onClose={() => setDetail(null)} canManage={canManage} onSaved={() => { setDetail(null); mutate(); }} />

      <Sheet open={!!confirmDelete} onClose={() => setConfirmDelete(null)} placement="center" width="sm:w-[460px]" ariaLabel="Supprimer">
        {confirmDelete && (
          <DeleteConfirm name={confirmDelete.name} busy={busy} onCancel={() => setConfirmDelete(null)} onConfirm={() => hardDelete(confirmDelete)} />
        )}
      </Sheet>
    </Card>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-ink-secondary">{label}</span>
      {children}
    </div>
  );
}

function DeleteConfirm({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-[15.5px] font-semibold text-ink-primary">Supprimer {name}</h2>
      <p className="text-[13.5px] text-ink-secondary">
        Suppression définitive, possible uniquement si aucune commande ne référence ce transporteur.
        Pour un transporteur qui a livré des commandes, utilisez plutôt <b>Archiver</b> (réversible).
      </p>
      <Labelled label={`Saisissez « ${name} » pour confirmer`}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 rounded-md border border-line px-3 text-[13.5px]" placeholder={name} />
      </Labelled>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>Annuler</Button>
        <Button variant="destructive" size="sm" disabled={typed !== name || busy} onClick={onConfirm}>{busy ? "Suppression…" : "Supprimer définitivement"}</Button>
      </div>
    </div>
  );
}

function CarrierDrawer({
  carrier, currency, onClose, canManage, onSaved,
}: {
  carrier: Carrier | null;
  currency: string;
  onClose: () => void;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [delivery, setDelivery] = useState("");
  const [ret, setRet] = useState("");
  const [saving, setSaving] = useState(false);
  const currentId = carrier?.id;

  useEffect(() => {
    if (carrier) {
      setDelivery(String(carrier.delivery_fee));
      setRet(String(carrier.return_fee));
    }
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!carrier) return;
    setSaving(true);
    try {
      await fetch(`/api/carriers/${carrier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_fee: parseFloat(delivery) || 0, return_fee: parseFloat(ret) || 0 }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={!!carrier} onClose={onClose} width="sm:w-[560px]" ariaLabel="Détail du transporteur">
      {carrier && (
        <div className="flex h-full flex-col">
          <div className="flex items-start gap-3 border-b border-line-subtle px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-ink-primary">{carrier.name}</h2>
              <p className="font-mono text-[12.5px] text-ink-secondary">{carrier.code}</p>
            </div>
            <button type="button" onClick={onClose} className="ms-auto grid h-8 w-8 place-items-center rounded-md text-ink-secondary hover:bg-surface-selected">✕</button>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            <div className="grid grid-cols-2 gap-4">
              <Labelled label={`Frais de livraison (${currency})`}>
                <input type="number" step="0.001" value={delivery} onChange={(e) => setDelivery(e.target.value)} disabled={!canManage} className="h-9 rounded-md border border-line px-3 text-[13.5px] tabular-nums" />
              </Labelled>
              <Labelled label={`Frais de retour (${currency})`}>
                <input type="number" step="0.001" value={ret} onChange={(e) => setRet(e.target.value)} disabled={!canManage} className="h-9 rounded-md border border-line px-3 text-[13.5px] tabular-nums" />
              </Labelled>
            </div>
            <div className="rounded-md border border-dashed border-line-strong bg-surface-sunken p-3 text-[12.5px] text-ink-secondary">
              Les identifiants (rotation), les tarifs relevés et les correspondances arrivent dans la suite du chantier Connexions. Les secrets ne sont jamais renvoyés — remplacement uniquement.
            </div>
          </div>
          {canManage && (
            <div className="flex justify-end gap-2 border-t border-line-subtle bg-surface-sunken px-5 py-3">
              <Button variant="secondary" size="sm" onClick={onClose}>Annuler</Button>
              <Button variant="primary" size="sm" disabled={saving} onClick={save}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
