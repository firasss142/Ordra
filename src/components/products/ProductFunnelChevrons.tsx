"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  CheckCircle2,
  ShoppingCart,
  Truck,
  UploadCloud,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────────────────
   ENTONNOIR DU PRODUIT — 5 chevrons.

   POURQUOI DES CHEVRONS ET PAS DES BARRES : les cinq étapes ne sont pas cinq
   catégories comparables, c'est une séquence. La pointe porte la direction, ce
   qu'une barre ne fait pas, et la saturation croissante dit « on se rapproche
   du résultat » sans écrire de légende.

   ÉTAPE 4 EN BLEU, PAS EN VERT. Un upload n'est pas un résultat acquis : la
   commande est chez le transporteur et peut encore revenir. La peindre en vert
   la ferait lire comme un gain, et le sous-titre (« N encore en cours ») serait
   pris pour un détail au lieu d'un avertissement.

   CONTRASTE : texte foncé sur les quatre premiers paliers, blanc sur le seul
   dernier — c'est le seul palier assez sombre pour porter du blanc (var(--brand)
   est à 5,0:1 blanc-sur-fond). Un texte blanc sur le palier 4 tomberait sous AA.

   AUCUN TAUX N'EST RECALCULÉ ICI. confirmationRate et deliveryRate arrivent du
   serveur (lib/calculations/product-profitability.ts) : deliveryRate vaut
   delivered / dispatched, dénominateur que le client ne connaît pas — il vient
   des lignes order_history status_to='uploaded'. Seule la conversion cumulée
   (part de l'étape sur les commandes reçues) est un rapport d'effectifs, pas un
   calcul financier.
   ────────────────────────────────────────────────────────────────────────── */

/** Tiret cadratin : « pas de donnée », qui n'est PAS « zéro ». */
const DASH = "—";

/** Le marché libyen lit l'arabe en chiffres latins — ar-LY, pas ar. */
export function toIntlLocale(locale: string): string {
  return locale === "ar" ? "ar-LY" : "fr-TN";
}

/**
 * Effectifs. Exporté ici plutôt que dans src/lib parce que ce lot n'est
 * propriétaire d'aucun fichier de lib ; à consolider dans
 * src/lib/products/format.ts quand la surface sera stabilisée.
 */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(toIntlLocale(locale)).format(value);
}

/** Pourcentage à une décimale, espace insécable avant le signe (typo FR). */
export function formatPercent(value: number, locale: string): string {
  const n = new Intl.NumberFormat(toIntlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
  return `${n} %`;
}

export interface ProductFunnelChevronsProps {
  leads: number;
  /** null tant que le serveur n'expose pas treatedCount — un tiret, jamais 0. */
  treated: number | null;
  confirmed: number;
  /** dispatchedCount — order_history status_to='uploaded'. */
  uploaded: number;
  delivered: number;
  /** Commandes au statut courant encore chez le transporteur. */
  inFlight: number | null;
  /** Serveur : confirmedCount / totalLeads × 100. */
  confirmationRate: number;
  /** Serveur : deliveredCount / dispatchedCount × 100. */
  deliveryRate: number;
}

type StepTone = 1 | 2 | 3 | 4 | 5;

/* Le dégradé vert est dérivé de --prod-brand par color-mix : ce lot ne possède
   ni globals.css ni tailwind.config.ts, et inventer #D2EEE0 / #A8DFC6 dans un
   composant serait exactement la couleur en dur que la refonte supprime. */
const TONE_SURFACE: Record<StepTone, string> = {
  1: "bg-[color-mix(in_srgb,var(--prod-brand)_8%,transparent)] text-ink-primary",
  2: "bg-[color-mix(in_srgb,var(--prod-brand)_18%,transparent)] text-ink-primary",
  3: "bg-[color-mix(in_srgb,var(--prod-brand)_32%,transparent)] text-ink-primary",
  4: "bg-status-action/15 text-ink-primary",
  5: "bg-prod-brand text-white",
};

const TONE_ICON: Record<StepTone, string> = {
  1: "bg-white/75 text-prod-brand",
  2: "bg-white/75 text-prod-brand",
  3: "bg-white/75 text-prod-brand",
  4: "bg-white/85 text-status-action",
  5: "bg-white/20 text-white",
};

const TONE_FOOT: Record<StepTone, string> = {
  1: "bg-black/[0.055]",
  2: "bg-black/[0.055]",
  3: "bg-black/[0.055]",
  4: "bg-black/[0.055]",
  5: "bg-black/[0.16]",
};

/* clip-path ne se mirroite pas tout seul : la variante rtl: porte le polygone
   symétrique, sinon la pointe de l'entonnoir désignerait la sortie en arabe. */
const CHEV_FIRST =
  "min-[1240px]:[clip-path:polygon(0_0,calc(100%_-_20px)_0,100%_50%,calc(100%_-_20px)_100%,0_100%)] " +
  "min-[1240px]:rtl:[clip-path:polygon(100%_0,20px_0,0_50%,20px_100%,100%_100%)]";
const CHEV_MID =
  "min-[1240px]:[clip-path:polygon(0_0,calc(100%_-_20px)_0,100%_50%,calc(100%_-_20px)_100%,0_100%,20px_50%)] " +
  "min-[1240px]:rtl:[clip-path:polygon(100%_0,20px_0,0_50%,20px_100%,100%_100%,calc(100%_-_20px)_50%)]";
const CHEV_LAST =
  "min-[1240px]:[clip-path:polygon(0_0,100%_0,100%_100%,0_100%,20px_50%)] " +
  "min-[1240px]:rtl:[clip-path:polygon(100%_0,0_0,0_100%,100%_100%,calc(100%_-_20px)_50%)]";

export function ProductFunnelChevrons({
  leads,
  treated,
  confirmed,
  uploaded,
  delivered,
  inFlight,
  confirmationRate,
  deliveryRate,
}: ProductFunnelChevronsProps) {
  const t = useTranslations("products.sheet");
  const locale = useLocale();

  const steps: {
    tone: StepTone;
    label: string;
    value: number | null;
    caption: string;
    icon: React.ReactNode;
  }[] = [
    {
      tone: 1,
      label: t("funnel.leads"),
      value: leads,
      caption: t("funnel.leadsSub"),
      icon: <ShoppingCart size={16} strokeWidth={2.1} aria-hidden />,
    },
    {
      tone: 2,
      label: t("funnel.treated"),
      value: treated,
      caption: treated === null ? t("funnel.unavailable") : t("funnel.treatedSub"),
      icon: <Check size={16} strokeWidth={2.4} aria-hidden />,
    },
    {
      tone: 3,
      label: t("funnel.confirmed"),
      value: confirmed,
      caption: t("funnel.confirmedSub", {
        value: formatPercent(confirmationRate, locale),
      }),
      icon: <CheckCircle2 size={16} strokeWidth={2.1} aria-hidden />,
    },
    {
      tone: 4,
      label: t("funnel.uploaded"),
      value: uploaded,
      caption:
        inFlight === null
          ? t("funnel.unavailable")
          : t("funnel.uploadedSub", { count: formatCount(inFlight, locale) }),
      icon: <UploadCloud size={16} strokeWidth={2.1} aria-hidden />,
    },
    {
      tone: 5,
      label: t("funnel.delivered"),
      value: delivered,
      caption: t("funnel.deliveredSub", {
        rate: formatPercent(deliveryRate, locale),
        count: formatCount(uploaded, locale),
      }),
      icon: <Truck size={16} strokeWidth={2.1} aria-hidden />,
    },
  ];

  return (
    <ol className="flex list-none flex-col gap-2 rounded-[16px] border border-line-subtle bg-surface-card p-3.5 shadow-hover-row min-[1240px]:flex-row min-[1240px]:gap-1">
      {steps.map((step, index) => {
        const shape =
          index === 0 ? CHEV_FIRST : index === steps.length - 1 ? CHEV_LAST : CHEV_MID;
        const share =
          leads > 0 && step.value !== null ? (step.value / leads) * 100 : null;

        return (
          <li
            key={step.label}
            className={[
              "flex min-w-0 flex-1 flex-col overflow-hidden rounded-card min-[1240px]:rounded-none",
              index === 0 ? "min-[1240px]:rounded-s-[12px]" : "",
              index === steps.length - 1 ? "min-[1240px]:rounded-e-[12px]" : "",
              TONE_SURFACE[step.tone],
              shape,
            ].join(" ")}
          >
            <div
              className={[
                "flex flex-1 items-start gap-3 px-4 py-3.5",
                index === 0
                  ? "min-[1240px]:ps-5 min-[1240px]:pe-8"
                  : "min-[1240px]:ps-9 min-[1240px]:pe-8",
              ].join(" ")}
            >
              <span
                className={`grid h-[34px] w-[34px] flex-none place-items-center rounded-card ${TONE_ICON[step.tone]}`}
              >
                {step.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold opacity-90">
                  {step.label}
                </span>
                <span className="block text-[26px] font-bold leading-[1.1] tracking-[-0.032em] tabular-nums">
                  {step.value === null ? DASH : formatCount(step.value, locale)}
                </span>
                <span className="block text-[11.5px] tabular-nums opacity-80">
                  {step.caption}
                </span>
              </span>
            </div>
            <div
              className={`px-4 py-1.5 text-center text-[12px] font-bold tabular-nums ${TONE_FOOT[step.tone]}`}
            >
              {share === null
                ? DASH
                : t("funnel.shareOfOrders", {
                    value: formatPercent(share, locale),
                  })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
