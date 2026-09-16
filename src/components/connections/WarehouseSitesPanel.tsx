"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Sheet } from "@/components/ui/Sheet";
import { canManageCarriers } from "@/lib/settings-permissions";
import type { Role } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Site {
  id: string;
  code: string;
  nameFr: string;
  nameAr: string;
  marketId: string;
  isDefault: boolean;
  isActive: boolean;
  assignedAgents: Array<{ id: string; name: string }>;
  stockUnits: number;
}

interface PendingWarning {
  site: Site;
  message: string;
  agents: Array<{ id: string; name: string }>;
  stockUnits: number;
}

interface Props {
  role: Role;
  marketId: string;
  readOnly?: boolean;
}

/**
 * Les bâtiments physiques d'un marché — la Libye en a deux, Tripoli et
 * Benghazi, un par compte Darb Assabil.
 *
 * `warehouses.is_active` était déjà respecté partout (stock, ramassage, scan)
 * mais aucun écran ne l'éditait. Désactiver un site n'est pas anodin : l'agent
 * qui y est affecté ne voit plus rien, et le stock qui y reste disparaît des
 * écrans d'entrepôt. Les deux sont annoncés avant, pas découverts après.
 */
export function WarehouseSitesPanel({ role, marketId, readOnly = false }: Props) {
  const { data, mutate, isLoading } = useSWR<{ data: Site[] }>(
    marketId ? `/api/admin/warehouse-sites?market_id=${marketId}` : null,
    fetcher,
  );
  const canManage = canManageCarriers(role) && !readOnly;
  const sites = data?.data ?? [];

  const [pending, setPending] = useState<PendingWarning | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle(site: Site, confirmed = false) {
    if (!canManage) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/warehouse-sites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: site.id, is_active: !site.isActive, confirmed }),
      });

      if (res.status === 409) {
        const body = await res.json();
        if (body.code === "needs_confirmation") {
          setPending({
            site,
            message: body.error,
            agents: body.agents ?? [],
            stockUnits: body.stockUnits ?? 0,
          });
          return;
        }
        // Site par défaut : aucun « confirmer » ne débloque, donc on le dit et
        // on s'arrête.
        setPending({ site, message: body.error, agents: [], stockUnits: 0 });
        return;
      }

      setPending(null);
      mutate();
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="mt-4 text-[13px] text-ink-secondary">Chargement des sites…</div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-line-subtle px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ink-primary">
            Sites d&apos;entrepôt
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-secondary">
            Les bâtiments d&apos;où part la marchandise. Désactiver un site le retire
            du scan, du stock et du ramassage — sans rien supprimer.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-sunken text-[11px] uppercase tracking-[0.06em] text-ink-secondary">
                <th className="px-4 py-2.5 text-start font-bold">Site</th>
                <th className="px-4 py-2.5 text-start font-bold">Agents affectés</th>
                <th className="px-4 py-2.5 text-end font-bold">Stock</th>
                <th className="w-[100px] px-4 py-2.5 text-center font-bold">Actif</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t border-line-subtle ${!s.isActive ? "opacity-60" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink-primary">{s.nameFr}</span>
                      {s.isDefault && <Badge tone="neutral">Par défaut</Badge>}
                    </div>
                    <span className="font-mono text-[12px] text-ink-secondary">
                      {s.code}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-ink-secondary">
                    {s.assignedAgents.length === 0
                      ? "—"
                      : s.assignedAgents.map((a) => a.name).join(", ")}
                  </td>

                  <td className="px-4 py-3 text-end tabular-nums text-ink-primary">
                    {s.stockUnits.toLocaleString("fr")}
                  </td>

                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.isActive}
                      aria-label={`Actif ${s.nameFr}`}
                      disabled={!canManage || busy}
                      onClick={() => toggle(s)}
                      className={`relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors ${
                        s.isActive ? "bg-brand" : "bg-line-strong"
                      } ${!canManage ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`absolute top-0.5 h-[18px] w-[18px] rounded-pill bg-white shadow-hover-row transition-all ${
                          s.isActive ? "start-[18px]" : "start-0.5"
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              ))}

              {sites.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-ink-secondary">
                    Aucun site pour ce marché.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-line-subtle bg-surface-sunken px-4 py-2.5 text-[12.5px] text-ink-secondary">
          <b>Un agent sans site actif ne voit rien.</b> C&apos;est voulu — non
          assigné ne doit jamais vouloir dire non restreint. Réaffectez-le depuis
          Équipe → Accès avant sa prochaine journée.
        </div>
      </Card>

      <Sheet
        open={!!pending}
        onClose={() => setPending(null)}
        placement="center"
        width="sm:w-[480px]"
        ariaLabel="Confirmer la désactivation"
      >
        {pending && (
          <div className="flex flex-col gap-4 p-5">
            <h3 className="text-[15px] font-semibold text-ink-primary">
              Désactiver {pending.site.nameFr} ?
            </h3>

            <p className="text-[13px] leading-relaxed text-ink-secondary">
              {pending.message}
            </p>

            {pending.agents.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-md border border-status-warning/30 bg-status-warningBg p-3">
                {pending.agents.map((a) => (
                  <li key={a.id} className="text-[12.5px] text-ink-primary">
                    {a.name}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPending(null)}>
                Annuler
              </Button>
              {/* Le site par défaut ne propose pas de « confirmer » : le refus
                  est définitif tant qu'un autre site n'a pas pris le relais. */}
              {pending.agents.length > 0 || pending.stockUnits > 0 ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => toggle(pending.site, true)}
                >
                  {busy ? "…" : "Désactiver quand même"}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
