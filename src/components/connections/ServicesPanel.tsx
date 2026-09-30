"use client";

import { MetaAdsSection } from "@/components/settings/MetaAdsSection";
import { WhatsAppSection } from "@/components/connections/WhatsAppSection";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Props {
  markets: Market[];
  readOnly?: boolean;
}

/**
 * Services tiers — the third-party half of Connexions. Meta Ads reuses the
 * existing (already token-based) MetaAdsSection; WhatsApp Business has its
 * own per-market cards (WhatsAppSection); Google Sheets and Meta Leads are
 * surfaced as status cards (Leads is a placeholder for a connector that does
 * not exist yet — shown honestly rather than faked as active).
 */
export function ServicesPanel({ markets, readOnly = false }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <MetaAdsSection markets={markets} />

      <WhatsAppSection markets={markets} readOnly={readOnly} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-neutral-bg text-ink-secondary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-[18px] w-[18px]">
                <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" />
              </svg>
            </span>
            <div>
              <h3 className="text-[14.5px] font-semibold text-ink-primary">Google Sheets</h3>
              <p className="text-[12.5px] text-ink-secondary">Compte de service partagé par les sources feuille</p>
            </div>
            <Badge tone="success" dot className="ms-auto">Connecté</Badge>
          </CardHeader>
          <CardBody className="text-[12.5px] text-ink-secondary">
            Les sources Google Sheets se gèrent depuis l'onglet <b>Storefronts</b> (mode « sync »).
            Leur historique d'exécution apparaîtra dans <b>Journaux → Synchronisations</b>.
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-status-warningBg text-status-warning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-[18px] w-[18px]">
                <path d="M4 4h16v12H7l-3 3z" />
              </svg>
            </span>
            <div>
              <h3 className="text-[14.5px] font-semibold text-ink-primary">Meta Leads</h3>
              <p className="text-[12.5px] text-ink-secondary">Commentaires Facebook, messages Instagram et Messenger</p>
            </div>
            <Badge tone="warning" dot className="ms-auto">Non implémenté</Badge>
          </CardHeader>
          <CardBody className="text-[12.5px] text-ink-secondary">
            L'endpoint répond <span className="font-mono">501</span> — affiché tel quel plutôt que présenté comme actif.
            Callback&nbsp;: <span className="font-mono">/api/webhooks/meta/…</span>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
