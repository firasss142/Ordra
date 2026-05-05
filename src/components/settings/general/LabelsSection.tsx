"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { StatusLabelWysiwyg } from "../StatusLabelWysiwyg";
import { SectionShell } from "./SectionShell";

interface Props {
  marketId: string;
}

export function LabelsSection({ marketId }: Props) {
  const locale = useLocale();
  return (
    <SectionShell
      title="Libellés des statuts"
      description="Nom affiché pour chaque statut. L'aperçu est identique à ce que verront agents et managers."
      hideFooter
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 text-[13px] text-ink-secondary">
            Pour ajouter, supprimer ou réordonner les statuts, ouvrez l&apos;éditeur complet.
          </p>
          <Link
            href={`/${locale}/settings/statuses`}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-card px-3 py-1.5 text-[13px] font-medium text-ink-primary no-underline hover:bg-surface-hover transition-colors duration-fast"
          >
            Gérer les statuts →
          </Link>
        </div>
        <LabelScopePanel
          marketId={marketId}
          scope="prospect"
          defaultOpen={true}
        />
        <LabelScopePanel
          marketId={marketId}
          scope="follow_up"
          defaultOpen={false}
        />
      </div>
    </SectionShell>
  );
}

function LabelScopePanel({
  marketId,
  scope,
  defaultOpen,
}: {
  marketId: string;
  scope: "prospect" | "follow_up";
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex-1 overflow-hidden rounded-md border border-line-subtle bg-surface-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          "w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-transparent border-0 text-start text-[14px] font-medium text-ink-primary cursor-pointer hover:bg-surface-hover transition-colors duration-fast " +
          (open ? "border-b border-line-subtle" : "")
        }
      >
        <span>{scope === "prospect" ? "Prospection" : "Suivi"}</span>
        <span aria-hidden className="text-ink-secondary">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="p-3">
          <StatusLabelWysiwyg marketId={marketId} scope={scope} />
        </div>
      )}
    </div>
  );
}
