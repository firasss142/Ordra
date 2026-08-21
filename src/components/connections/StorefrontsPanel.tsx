"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { canManageStorefronts } from "@/lib/settings-permissions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import {
  computeHealthState,
  formatRelative,
  type HealthState,
} from "@/components/settings/storefronts/HealthBadge";
import { PlatformIcon } from "@/components/settings/storefronts/PlatformIcon";
import { ConnectionWizard } from "@/components/settings/storefronts/ConnectionWizard";
import type { Role } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Storefront {
  id: string;
  market_id: string;
  platform: string;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
  last_webhook_received_at: string | null;
  last_webhook_status: "processed" | "ignored" | "error" | null;
  last_webhook_error: string | null;
  webhook_failure_count: number;
}

const HEALTH_TONE: Record<HealthState, { tone: "success" | "warning" | "critical" | "neutral"; label: string }> = {
  ok: { tone: "success", label: "Actif" },
  stale: { tone: "warning", label: "Silencieux" },
  failing: { tone: "critical", label: "En erreur" },
  never: { tone: "neutral", label: "Jamais utilisé" },
  inactive: { tone: "neutral", label: "Archivé" },
};

type Filter = "all" | "active" | "stale" | "never" | "archived";

interface Props {
  role: Role;
  marketId: string;
  marketName: string;
  readOnly?: boolean;
}

export function StorefrontsPanel({ role, marketId, marketName, readOnly = false }: Props) {
  const { data, mutate, isLoading } = useSWR<{ data: Storefront[] }>(
    marketId ? `/api/storefronts?market_id=${marketId}` : null,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const canManage = canManageStorefronts(role) && !readOnly;
  const storefronts = data?.data ?? [];

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<Storefront | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ webhookUrl: string; secret: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Storefront | null>(null);
  const [busy, setBusy] = useState(false);

  const withHealth = useMemo(
    () =>
      storefronts.map((s) => ({
        s,
        health: computeHealthState({
          is_active: s.is_active,
          last_webhook_received_at: s.last_webhook_received_at,
          last_webhook_status: s.last_webhook_status,
          webhook_failure_count: s.webhook_failure_count,
        }),
      })),
    [storefronts],
  );

  const counts = useMemo(() => {
    const c = { all: withHealth.length, active: 0, stale: 0, never: 0, archived: 0 };
    for (const { health } of withHealth) {
      if (health === "ok") c.active++;
      else if (health === "stale" || health === "failing") c.stale++;
      else if (health === "never") c.never++;
      else if (health === "inactive") c.archived++;
    }
    return c;
  }, [withHealth]);

  const rows = withHealth.filter(({ s, health }) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.platform.includes(search.toLowerCase()))
      return false;
    if (filter === "all") return true;
    if (filter === "active") return health === "ok";
    if (filter === "stale") return health === "stale" || health === "failing";
    if (filter === "never") return health === "never";
    if (filter === "archived") return health === "inactive";
    return true;
  });

  async function toggleActive(s: Storefront) {
    if (!canManage) return;
    await mutate(
      (prev) => ({ data: (prev?.data ?? []).map((x) => (x.id === s.id ? { ...x, is_active: !s.is_active } : x)) }),
      false,
    );
    await fetch(`/api/storefronts/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !s.is_active }),
    });
    mutate();
  }

  async function archive(s: Storefront) {
    if (!canManage) return;
    await fetch(`/api/storefronts/${s.id}`, { method: "DELETE" });
    mutate();
  }

  async function hardDelete(s: Storefront) {
    setBusy(true);
    try {
      const res = await fetch(`/api/storefronts/${s.id}?hard=true`, { method: "DELETE" });
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

  const FILTERS: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "Tous", n: counts.all },
    { key: "active", label: "Actifs", n: counts.active },
    { key: "stale", label: "Silencieux", n: counts.stale },
    { key: "never", label: "Jamais utilisés", n: counts.never },
    { key: "archived", label: "Archivés", n: counts.archived },
  ];

  return (
    <Card>
      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle bg-surface-sunken px-4 py-3">
        <div className="relative">
          <svg className="pointer-events-none absolute inset-inline-start-2.5 top-2 h-4 w-4 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un storefront…"
            className="h-8 w-[240px] rounded-md border border-line ps-8 pe-3 text-[13px] text-ink-primary placeholder:text-ink-muted"
          />
        </div>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-pill border px-2.5 py-1 text-[12.5px] transition-colors ${
              filter === f.key
                ? "border-transparent bg-brand-bg font-semibold text-brand"
                : "border-line bg-surface-card text-ink-secondary hover:bg-surface-hover"
            }`}
          >
            {f.label} {f.n}
          </button>
        ))}
        {canManage && (
          <Button variant="primary" size="sm" className="ms-auto" onClick={() => setWizardOpen(true)}>
            + Ajouter
          </Button>
        )}
      </div>

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              {["Storefront", "Marché", "Plateforme", "État", "Dernier événement", "Actif", ""].map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-line px-4 py-2.5 text-start text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-secondary">Chargement…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-secondary">Aucun storefront.</td></tr>
            )}
            {rows.map(({ s, health }) => {
              const meta = HEALTH_TONE[health];
              const menuItems: MenuItem[] = [
                { id: "detail", label: "Ouvrir le détail", onSelect: () => setDetail(s) },
              ];
              if (canManage) {
                if (s.is_active) menuItems.push({ id: "archive", label: "Archiver", destructive: true, onSelect: () => archive(s) });
                else menuItems.push({ id: "reactivate", label: "Réactiver", onSelect: () => toggleActive(s) });
                menuItems.push({ id: "delete", label: "Supprimer définitivement", destructive: true, onSelect: () => setConfirmDelete(s) });
              }
              return (
                <tr key={s.id} className={`border-b border-line-subtle hover:bg-surface-hover ${!s.is_active ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => setDetail(s)} className="flex items-center gap-2.5 text-start">
                      <PlatformIcon platform={s.platform} size={28} />
                      <span>
                        <span className="block font-semibold text-ink-primary">{s.name}</span>
                        <span className="block text-[12px] text-ink-secondary">{s.platform}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">{s.market_id.endsWith("0001") ? "Tunisie" : "Libye"}</td>
                  <td className="px-4 py-2.5">{s.platform}</td>
                  <td className="px-4 py-2.5"><Badge tone={meta.tone} dot>{meta.label}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-secondary">{formatRelative(s.last_webhook_received_at)}</td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.is_active}
                      aria-label={`Actif ${s.name}`}
                      disabled={!canManage}
                      onClick={() => toggleActive(s)}
                      className={`relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors ${s.is_active ? "bg-brand" : "bg-line-strong"} ${!canManage ? "opacity-50" : ""}`}
                    >
                      <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-pill bg-white shadow-hover-row transition-all ${s.is_active ? "start-[18px]" : "start-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Menu
                      ariaLabel={`Actions ${s.name}`}
                      trigger={
                        <button type="button" aria-label={`Actions ${s.name}`} className="grid h-7 w-7 place-items-center rounded-md text-ink-secondary hover:bg-surface-selected">⋯</button>
                      }
                      items={menuItems}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* detail drawer */}
      <StorefrontDrawer storefront={detail} health={detail ? computeHealthState({ is_active: detail.is_active, last_webhook_received_at: detail.last_webhook_received_at, last_webhook_status: detail.last_webhook_status, webhook_failure_count: detail.webhook_failure_count }) : "ok"} onClose={() => setDetail(null)} canManage={canManage} onSaved={() => { setDetail(null); mutate(); }} />

      {/* wizard */}
      {wizardOpen && (
        <ConnectionWizard
          marketId={marketId}
          marketName={marketName}
          onCancel={() => setWizardOpen(false)}
          onComplete={(r) => {
            setWizardOpen(false);
            setCreatedInfo({ webhookUrl: r.webhook_url, secret: r.secret });
            mutate();
          }}
        />
      )}

      {/* one-time secret sheet */}
      <Sheet open={!!createdInfo} onClose={() => setCreatedInfo(null)} placement="center" width="sm:w-[520px]" ariaLabel="Connexion créée">
        {createdInfo && (
          <div className="flex flex-col gap-4 p-6">
            <h2 className="text-[16px] font-semibold text-ink-primary">Storefront créé</h2>
            <p className="text-[13px] text-ink-secondary">Notez ce secret — il ne sera plus affiché.</p>
            <Labelled label="URL du webhook"><code className="block break-all rounded-md bg-surface-sunken px-3 py-2 font-mono text-[12px]">{createdInfo.webhookUrl}</code></Labelled>
            <Labelled label="Secret"><code className="block break-all rounded-md bg-surface-sunken px-3 py-2 font-mono text-[12px]">{createdInfo.secret}</code></Labelled>
            <div className="flex justify-end"><Button variant="primary" size="sm" onClick={() => setCreatedInfo(null)}>J'ai noté</Button></div>
          </div>
        )}
      </Sheet>

      {/* hard-delete confirm */}
      <Sheet open={!!confirmDelete} onClose={() => setConfirmDelete(null)} placement="center" width="sm:w-[460px]" ariaLabel="Supprimer">
        {confirmDelete && (
          <DeleteConfirm
            name={confirmDelete.name}
            busy={busy}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => hardDelete(confirmDelete)}
          />
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
        Suppression définitive, possible uniquement si aucune commande ne référence ce storefront.
        Pour une source qui porte des commandes, utilisez plutôt <b>Archiver</b> (réversible).
      </p>
      <Labelled label={`Saisissez « ${name} » pour confirmer`}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 rounded-md border border-line px-3 text-[13.5px]" placeholder={name} />
      </Labelled>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>Annuler</Button>
        <Button variant="destructive" size="sm" disabled={typed !== name || busy} onClick={onConfirm}>
          {busy ? "Suppression…" : "Supprimer définitivement"}
        </Button>
      </div>
    </div>
  );
}

/** Detail drawer — Général tab (edit name/platform) + Webhook/Activité placeholders. */
function StorefrontDrawer({
  storefront,
  onClose,
  canManage,
  onSaved,
}: {
  storefront: Storefront | null;
  health: HealthState;
  onClose: () => void;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed form when a storefront opens.
  const currentId = storefront?.id;
  useEffect(() => {
    if (storefront) {
      setName(storefront.name);
      setPlatform(storefront.platform);
    }
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!storefront) return;
    setSaving(true);
    try {
      await fetch(`/api/storefronts/${storefront.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, platform, config: storefront.config }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={!!storefront} onClose={onClose} width="sm:w-[560px]" ariaLabel="Détail du storefront">
      {storefront && (
        <div className="flex h-full flex-col">
          <div className="flex items-start gap-3 border-b border-line-subtle px-5 py-4">
            <PlatformIcon platform={storefront.platform} size={36} />
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-ink-primary">{storefront.name}</h2>
              <p className="text-[12.5px] text-ink-secondary">{storefront.platform}</p>
            </div>
            <button type="button" onClick={onClose} className="ms-auto grid h-8 w-8 place-items-center rounded-md text-ink-secondary hover:bg-surface-selected">✕</button>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            <Labelled label="Nom">
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="h-9 rounded-md border border-line px-3 text-[13.5px]" />
            </Labelled>
            <Labelled label="Plateforme">
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={!canManage} className="h-9 cursor-pointer rounded-md border border-line px-3 pe-8 text-[13.5px]">
                {["easy_orders", "shopify", "woocommerce", "lightfunnels", "buybox", "google_sheets", "converty"].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Labelled>
            <div className="rounded-md border border-dashed border-line-strong bg-surface-sunken p-3 text-[12.5px] text-ink-secondary">
              L'onglet Webhook (URL, rotation du secret, mode d'authentification) et l'onglet Produits (correspondances) arrivent dans la suite du chantier Connexions.
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
