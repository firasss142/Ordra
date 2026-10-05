"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Eye, EyeOff, KeyRound, Trash2, UserX } from "lucide-react";
import { loginIdentifier } from "@/lib/users/access-view";
import type { DeactivationReason, UserWithStats } from "@/types";
import { buttonClass } from "./parts";
import { AccessDialog, FormError } from "./layers";

const REASONS: DeactivationReason[] = ["on-leave", "off-boarded", "terminated"];

function useSubmit() {
  const t = useTranslations("users");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/**
 * One step: the reason, what happens, and a red button that wakes once a
 * reason is chosen. The old second step only said « … commande(s) ».
 */
export function DeactivateUserDialog({ user, onClose, onConfirm }: { user: UserWithStats; onClose: () => void; onConfirm: (reason: DeactivationReason) => Promise<void> }) {
  const t = useTranslations("users");
  const [reason, setReason] = useState<DeactivationReason | null>(null);
  const { busy, error, run } = useSubmit();
  const name = user.full_name;
  return (
    <AccessDialog
      labelId="access-deactivate-title"
      icon={UserX}
      tone="critical"
      title={t("deactivate.title", { name })}
      lead={t("deactivate.body", { name })}
      closeLabel={t("drawer.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonClass("neutral")}>
            {t("deactivate.cancel")}
          </button>
          <button type="button" disabled={!reason || busy} onClick={() => reason && void run(() => onConfirm(reason))} className={buttonClass("danger")}>
            {busy ? t("deactivate.busy") : t("deactivate.confirm")}
          </button>
        </>
      }
    >
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="acx-label">{t("deactivate.reason")}</legend>
        <div className="tone-admin acx-roleopts">
          {REASONS.map((r, i) => (
            <label key={r} className="acx-opt">
              <input type="radio" name="access-reason" value={r} checked={reason === r} onChange={() => setReason(r)} autoFocus={i === 0} />
              {t(`reasons.${r}`)}
              <span aria-hidden="true" className="acx-radio" />
            </label>
          ))}
        </div>
      </fieldset>
      <FormError message={error} />
    </AccessDialog>
  );
}

export function DeleteUserDialog({ user, onClose, onConfirm }: { user: UserWithStats; onClose: () => void; onConfirm: () => Promise<void> }) {
  const t = useTranslations("users");
  const { busy, error, run } = useSubmit();
  return (
    <AccessDialog
      labelId="access-delete-title"
      icon={Trash2}
      tone="critical"
      title={t("delete.title", { name: user.full_name })}
      lead={t("delete.body")}
      closeLabel={t("drawer.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} autoFocus className={buttonClass("neutral")}>
            {t("delete.cancel")}
          </button>
          <button type="button" disabled={busy} onClick={() => void run(onConfirm)} className={buttonClass("danger")}>
            <Trash2 size={16} aria-hidden="true" />
            {busy ? t("delete.busy") : t("delete.confirm")}
          </button>
        </>
      }
    >
      {error && <FormError message={error} />}
    </AccessDialog>
  );
}

export function ResetPasswordDialog({ user, onClose, onConfirm }: { user: UserWithStats; onClose: () => void; onConfirm: (password: string) => Promise<void> }) {
  const t = useTranslations("users");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const { busy, error, run } = useSubmit();
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <AccessDialog
      labelId="access-reset-title"
      icon={KeyRound}
      tone="manager"
      title={t("reset.title")}
      lead={
        <>
          <bdi>{user.full_name}</bdi> · <bdi>{loginIdentifier(user.email)}</bdi>
        </>
      }
      closeLabel={t("drawer.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonClass("neutral")}>
            {t("reset.cancel")}
          </button>
          <button type="button" disabled={!pw || pw !== pw2 || busy} onClick={() => void run(() => onConfirm(pw))} className={buttonClass("primary")}>
            {busy ? t("reset.saving") : t("reset.save")}
          </button>
        </>
      }
    >
      <div>
        <label htmlFor="access-reset-1" className="acx-label">
          {t("reset.newPassword")}
        </label>
        <div className="acx-pw">
          <input id="access-reset-1" type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus className="acx-field peek" />
          <button type="button" aria-pressed={show} onClick={() => setShow((s) => !s)} className="acx-peek">
            {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            {show ? t("createPanel.hide") : t("createPanel.show")}
          </button>
        </div>
      </div>
      <div>
        <label htmlFor="access-reset-2" className="acx-label">
          {t("reset.confirmPassword")}
        </label>
        <input
          id="access-reset-2"
          type={show ? "text" : "password"}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
          aria-describedby="access-reset-error"
          className="acx-field"
        />
        <div id="access-reset-error">
          {mismatch && (
            <p className="acx-mismatch">
              <AlertTriangle size={14} aria-hidden="true" />
              {t("reset.mismatch")}
            </p>
          )}
        </div>
      </div>
      <FormError message={error} />
    </AccessDialog>
  );
}
