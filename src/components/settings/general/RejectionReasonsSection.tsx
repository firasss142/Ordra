"use client";

// Hardcoded French, like the rest of settings/general — see the note at the top
// of GeneralSettingsGroups.

import { useState } from "react";
import { Plus, Trash2, RotateCcw, ChevronUp, ChevronDown } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useRejectionReasons } from "@/hooks/useRejectionReasons";
import { buildRejectionTree } from "@/lib/orders/rejection-config";
import {
  REJECTION_HUES,
  REJECTION_KEY_REGEX,
  type RejectionReasonConfig,
} from "@/types/rejection-config";
import type { StatusHue } from "@/lib/orders/status-presentation";
import { inputClass, selectClass } from "./SectionShell";

/**
 * Système › Paramètres › Motifs de rejet.
 *
 * The two levels are deliberately not symmetrical, and the screen says so
 * rather than pretending otherwise:
 *
 *   groups      — fixed. Their keys are values of the `rejection_reason`
 *                 Postgres enum and 1,800 orders carry one, so there is no
 *                 "add" and no "delete" here. Label, colour and order are
 *                 editable, and the colour is the one that matters: it is what
 *                 separates four kinds of failure down a thousand-row column.
 *   sub-reasons — fully editable, because this is the list that has to keep up
 *                 with the ways an order actually dies.
 *
 * Deleting a sub-reason that orders already carry would make their history
 * unreadable, so delete asks the API how many orders use it first and says
 * plainly which of the two things is about to happen.
 */

const HUE_LABEL: Record<StatusHue, string> = {
  red: "Rouge — le client a dit non",
  amber: "Ambre — on n'a pas pu le joindre",
  violet: "Violet — livraison impossible",
  neutral: "Ardoise — la commande n'existait pas",
  teal: "Bleu-vert",
  green: "Vert",
};

/** The badge preview, so a colour is chosen against what it will look like. */
const SWATCH: Record<StatusHue, string> = {
  neutral: "bg-hue-neutral-fill-soft text-hue-neutral-ink",
  amber: "bg-hue-amber-fill-soft text-hue-amber-ink",
  violet: "bg-hue-violet-fill-soft text-hue-violet-ink",
  teal: "bg-hue-teal-fill-soft text-hue-teal-ink",
  green: "bg-hue-green-fill-soft text-hue-green-ink",
  red: "bg-hue-red-fill-soft text-hue-red-ink",
};

interface Props {
  marketId: string;
  readOnly?: boolean;
}

interface DraftSub {
  parentKey: string;
  key: string;
  label_fr: string;
  label_ar: string;
  short_fr: string;
  short_ar: string;
}

const emptyDraft = (parentKey: string): DraftSub => ({
  parentKey,
  key: "",
  label_fr: "",
  label_ar: "",
  short_fr: "",
  short_ar: "",
});

export function RejectionReasonsSection({ marketId, readOnly = false }: Props) {
  const { rows, isLoading, mutate } = useRejectionReasons(marketId);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSub | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    row: RejectionReasonConfig;
    usage: number;
  } | null>(null);

  // `activeOnly: false` — a retired reason stays on this screen, marked. It is
  // still the truth about past orders, and hiding it is how a manager ends up
  // recreating it under a second key.
  const tree = buildRejectionTree(rows, { activeOnly: false });

  async function send(url: string, init: RequestInit) {
    setError(null);
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError((body as { error?: string }).error ?? "Échec de l'enregistrement");
      return null;
    }
    await mutate();
    return res.json().catch(() => ({}));
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    send(`/api/settings/rejection-reasons/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

  /** Saves only when the value actually moved — blur fires on every tab-out. */
  const saveField = (
    row: RejectionReasonConfig,
    field: keyof RejectionReasonConfig,
    value: string,
  ) => {
    if (readOnly) return;
    const next = value.trim();
    if (!next || next === row[field]) return;
    void patch(row.id, { [field]: next });
  };

  async function createSub() {
    if (!draft) return;
    if (!REJECTION_KEY_REGEX.test(draft.key)) {
      setError(
        "Clé invalide : minuscules, chiffres et tirets bas, commençant par une lettre (ex. boite_vocale). Elle est écrite dans chaque commande et ne peut plus changer.",
      );
      return;
    }
    if (
      !draft.label_fr.trim() ||
      !draft.label_ar.trim() ||
      !draft.short_fr.trim() ||
      !draft.short_ar.trim()
    ) {
      setError("Les quatre libellés sont requis.");
      return;
    }

    const parent = tree.find((g) => g.key === draft.parentKey);
    const ok = await send("/api/settings/rejection-reasons", {
      method: "POST",
      body: JSON.stringify({
        market_id: marketId,
        parent_key: draft.parentKey,
        key: draft.key,
        label_fr: draft.label_fr,
        label_ar: draft.label_ar,
        short_fr: draft.short_fr,
        short_ar: draft.short_ar,
        sort_order: parent?.subreasons.length ?? 0,
      }),
    });
    if (ok) setDraft(null);
  }

  /** Asks the API how many orders use it, then tells the manager the truth. */
  async function askDelete(row: RejectionReasonConfig) {
    setError(null);
    const res = await fetch(`/api/settings/rejection-reasons/${row.id}`);
    const body = await res.json().catch(() => ({ usage: 0 }));
    setPendingDelete({ row, usage: (body as { usage?: number }).usage ?? 0 });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    await send(`/api/settings/rejection-reasons/${pendingDelete.row.id}`, {
      method: "DELETE",
    });
    setPendingDelete(null);
  }

  async function move(row: RejectionReasonConfig, siblings: RejectionReasonConfig[], dir: -1 | 1) {
    const i = siblings.findIndex((s) => s.id === row.id);
    const neighbour = siblings[i + dir];
    if (!neighbour) return;
    await patch(row.id, { sort_order: neighbour.sort_order });
    await patch(neighbour.id, { sort_order: row.sort_order });
  }

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <p className="m-0 text-[13px] text-ink-secondary">Chargement…</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <h2 className="m-0 text-[16px] font-semibold text-ink-primary">
            Motifs de rejet
          </h2>
          <p className="mt-1 m-0 max-w-[70ch] text-[13px] text-ink-secondary">
            Ce que l&apos;agent peut choisir quand une commande n&apos;aboutit
            pas, et la couleur sous laquelle elle apparaît ensuite dans la
            colonne Statut. Les cinq groupes sont fixes — leur clé est inscrite
            dans l&apos;historique de 1 800 commandes — mais leur libellé, leur
            couleur et leur ordre se modifient, et les sous-motifs s&apos;ajoutent
            et se retirent librement.
          </p>
        </CardHeader>
      </Card>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-status-critical/40 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
        >
          {error}
        </div>
      )}

      {tree.map((group) => (
        <Card
          key={group.key}
          data-testid="rejection-group"
          data-hue={group.hue}
          className={group.isActive ? "" : "opacity-60"}
        >
          <CardHeader className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-secondary">
                  Groupe (FR)
                </span>
                <input
                  className={`${inputClass} w-[220px]`}
                  defaultValue={group.labelFr}
                  disabled={readOnly}
                  onBlur={(e) => saveField(group.config, "label_fr", e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-secondary">
                  Groupe (AR)
                </span>
                <input
                  dir="rtl"
                  className={`${inputClass} w-[180px]`}
                  defaultValue={group.labelAr}
                  disabled={readOnly}
                  onBlur={(e) => saveField(group.config, "label_ar", e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-ink-secondary">
                  Couleur du groupe
                </span>
                <select
                  aria-label={`Couleur du groupe ${group.labelFr}`}
                  className={`${selectClass} w-[260px]`}
                  defaultValue={group.hue}
                  disabled={readOnly}
                  onChange={(e) => patch(group.config.id, { hue: e.target.value })}
                >
                  {REJECTION_HUES.map((h) => (
                    <option key={h} value={h}>
                      {HUE_LABEL[h]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <span
              className={`inline-flex h-[26px] items-center rounded-pill px-2.5 text-[12.5px] font-semibold ${SWATCH[group.hue]}`}
            >
              {group.shortFr || group.labelFr}
            </span>
          </CardHeader>

          <CardBody className="space-y-2">
            {group.requiresNote && (
              <p className="m-0 text-[12px] text-ink-secondary">
                Ce groupe n&apos;a pas de sous-motifs : l&apos;agent doit écrire
                une note, et c&apos;est cette obligation qui l&apos;empêche de
                redevenir la réponse la plus rapide.
              </p>
            )}

            {group.subreasons.map((sub) => (
              <div
                key={sub.id}
                data-testid="rejection-sub"
                data-retired={sub.is_active ? "false" : "true"}
                className={`flex flex-wrap items-end gap-2 rounded-md border border-line-subtle px-3 py-2 ${
                  sub.is_active ? "" : "bg-surface-hover opacity-70"
                }`}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-ink-secondary">
                    Libellé (FR)
                  </span>
                  <input
                    className={`${inputClass} w-[240px]`}
                    defaultValue={sub.label_fr}
                    disabled={readOnly}
                    onBlur={(e) => saveField(sub, "label_fr", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-ink-secondary">
                    Libellé (AR)
                  </span>
                  <input
                    dir="rtl"
                    className={`${inputClass} w-[180px]`}
                    defaultValue={sub.label_ar}
                    disabled={readOnly}
                    onBlur={(e) => saveField(sub, "label_ar", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-ink-secondary">
                    Court (FR)
                  </span>
                  <input
                    className={`${inputClass} w-[120px]`}
                    defaultValue={sub.short_fr}
                    disabled={readOnly}
                    onBlur={(e) => saveField(sub, "short_fr", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-ink-secondary">
                    Court (AR)
                  </span>
                  <input
                    dir="rtl"
                    className={`${inputClass} w-[110px]`}
                    defaultValue={sub.short_ar}
                    disabled={readOnly}
                    onBlur={(e) => saveField(sub, "short_ar", e.target.value)}
                  />
                </label>

                <span
                  className={`inline-flex h-[26px] items-center rounded-pill px-2.5 text-[12.5px] font-semibold ${SWATCH[group.hue]}`}
                  title="Aperçu dans la colonne Statut"
                >
                  {sub.short_fr}
                </span>

                <div className="ms-auto flex items-center gap-1">
                  <IconButton
                    label={`Monter « ${sub.label_fr} »`}
                    disabled={readOnly}
                    onClick={() => move(sub, group.subreasons, -1)}
                  >
                    <ChevronUp size={14} />
                  </IconButton>
                  <IconButton
                    label={`Descendre « ${sub.label_fr} »`}
                    disabled={readOnly}
                    onClick={() => move(sub, group.subreasons, 1)}
                  >
                    <ChevronDown size={14} />
                  </IconButton>

                  {sub.is_active ? (
                    <IconButton
                      label={`Supprimer « ${sub.label_fr} »`}
                      disabled={readOnly}
                      onClick={() => askDelete(sub)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  ) : (
                    <IconButton
                      label={`Réactiver « ${sub.label_fr} »`}
                      disabled={readOnly}
                      onClick={() => patch(sub.id, { is_active: true })}
                    >
                      <RotateCcw size={14} />
                    </IconButton>
                  )}
                </div>
              </div>
            ))}

            {!group.requiresNote && !readOnly && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setError(null);
                  setDraft(emptyDraft(group.key));
                }}
              >
                <Plus size={14} className="me-1" />
                Ajouter un sous-motif
              </Button>
            )}
          </CardBody>
        </Card>
      ))}

      {draft && (
        <Card data-testid="rejection-draft">
          <CardHeader>
            <h3 className="m-0 text-[14px] font-semibold text-ink-primary">
              Nouveau sous-motif dans «{" "}
              {tree.find((g) => g.key === draft.parentKey)?.labelFr} »
            </h3>
          </CardHeader>
          <CardBody className="flex flex-wrap items-end gap-3">
            <DraftField
              label="Clé"
              hint="inscrite dans chaque commande — définitive"
              value={draft.key}
              onChange={(v) => setDraft({ ...draft, key: v })}
            />
            <DraftField
              label="Libellé (FR)"
              value={draft.label_fr}
              onChange={(v) => setDraft({ ...draft, label_fr: v })}
            />
            <DraftField
              label="Libellé (AR)"
              rtl
              value={draft.label_ar}
              onChange={(v) => setDraft({ ...draft, label_ar: v })}
            />
            <DraftField
              label="Court (FR)"
              hint="ce que montre la colonne Statut"
              value={draft.short_fr}
              onChange={(v) => setDraft({ ...draft, short_fr: v })}
            />
            <DraftField
              label="Court (AR)"
              rtl
              value={draft.short_ar}
              onChange={(v) => setDraft({ ...draft, short_ar: v })}
            />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={createSub}>
                Créer
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
                Annuler
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Supprimer « ${pendingDelete.row.label_fr} »`}
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
        >
          <div className="w-full max-w-[460px] rounded-lg bg-surface-card p-5 shadow-lg">
            <h3 className="m-0 text-[15px] font-semibold text-ink-primary">
              Supprimer « {pendingDelete.row.label_fr} » ?
            </h3>

            <p className="mt-2 text-[13px] text-ink-secondary">
              {pendingDelete.usage > 0 ? (
                <>
                  <strong className="text-ink-primary">
                    {pendingDelete.usage} commande
                    {pendingDelete.usage > 1 ? "s" : ""}
                  </strong>{" "}
                  {pendingDelete.usage > 1 ? "utilisent" : "utilise"} ce motif.
                  Il sera <strong className="text-ink-primary">retiré</strong> du
                  sélecteur de l&apos;agent, mais restera affiché sur ces
                  commandes — sans quoi leur historique deviendrait illisible.
                </>
              ) : (
                <>
                  Aucune commande n&apos;utilise ce motif. Il sera supprimé
                  définitivement.
                </>
              )}
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPendingDelete(null)}
              >
                Annuler
              </Button>
              <Button variant="primary" size="sm" onClick={confirmDelete}>
                Confirmer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md border border-line bg-surface-card text-ink-secondary transition-colors duration-fast hover:bg-surface-hover disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function DraftField({
  label,
  hint,
  value,
  rtl,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  rtl?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-secondary">{label}</span>
      <input
        dir={rtl ? "rtl" : undefined}
        className={`${inputClass} w-[190px]`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="text-[11px] text-ink-muted">{hint}</span>}
    </label>
  );
}
