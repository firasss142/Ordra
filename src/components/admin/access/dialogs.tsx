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
        <legend className="mb-[7px] block p-0 text-[13px] font-semibold text-[#15171A]">{t("deactivate.reason")}</legend>
        <div className="tone-admin grid gap-[8px]">
          {REASONS.map((r, i) => {
            const on = reason === r;
            return (
              <label
                key={r}
                className={`relative flex cursor-pointer items-center gap-[12px] rounded-[12px] border px-[14px] py-[11px] text-[13.5px] font-semibold transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
                  on ? "border-tone bg-tone-bg text-tone-ink shadow-[inset_0_0_0_1px_var(--tone)]" : "border-[#E3E5E8] text-[#15171A] hover:border-tone-edge"
                }`}
              >
                <input type="radio" name="access-reason" value={r} checked={on} onChange={() => setReason(r)} autoFocus={i === 0} className="absolute opacity-0" />
                {t(`reasons.${r}`)}
                <span aria-hidden="true" className={`ms-auto grid h-[20px] w-[20px] flex-none place-items-center rounded-full ${on ? "bg-tone" : "bg-white shadow-[inset_0_0_0_1.5px_#D5D8DC]"}`}>
                  {on && <span className="h-[7px] w-[7px] rounded-full bg-white" />}
                </span>
              </label>
            );
          })}
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
  const field =
    "h-[40px] w-full rounded-[10px] border bg-[#F3F4F6] px-[12px] text-[14px] text-[#15171A] transition-colors hover:bg-[#EDEEF1] focus:border-brand focus:bg-white focus:shadow-[0_0_0_3px_var(--brand-bg)] focus:outline-none";
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
        <label htmlFor="access-reset-1" className="mb-[7px] block text-[13px] font-semibold text-[#15171A]">
          {t("reset.newPassword")}
        </label>
        <div className="relative">
          <input id="access-reset-1" type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus className={`${field} border-transparent pe-[92px]`} />
          <button
            type="button"
            aria-pressed={show}
            onClick={() => setShow((s) => !s)}
            className="absolute end-[5px] top-[6px] inline-flex h-[28px] items-center gap-[5px] rounded-[7px] bg-white px-[10px] text-[12px] font-semibold text-[#4F555B] shadow-[0_1px_2px_rgba(16,24,40,.08),0_0_0_1px_rgba(16,24,40,.04)] hover:text-[#15171A]"
          >
            {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            {show ? t("createPanel.hide") : t("createPanel.show")}
          </button>
        </div>
      </div>
      <div>
        <label htmlFor="access-reset-2" className="mb-[7px] block text-[13px] font-semibold text-[#15171A]">
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
          className={`${field} ${mismatch ? "border-[#D72C0D] bg-white" : "border-transparent"}`}
        />
        <div id="access-reset-error">
          {mismatch && (
            <p className="m-0 mt-[7px] flex items-center gap-[6px] text-[12.5px] text-[#B8250B]">
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
