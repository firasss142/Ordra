"use client";

import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ChangeHistoryPopover } from "../ChangeHistoryPopover";

export const inputClass =
  "h-9 rounded-md border border-line bg-surface-card px-3 text-[14px] text-ink-primary placeholder:text-ink-muted disabled:bg-surface-hover disabled:text-ink-muted";

export const selectClass = `${inputClass} cursor-pointer pe-8`;

interface SectionShellProps {
  title: string;
  description: string;
  onReset?: () => void;
  onSave?: () => void;
  saving?: boolean;
  successMsg?: string;
  errorMsg?: string;
  hideFooter?: boolean;
  children: ReactNode;
}

export function SectionShell({
  title,
  description,
  onReset,
  onSave,
  saving,
  successMsg,
  errorMsg,
  hideFooter,
  children,
}: SectionShellProps) {
  return (
    <Card className="overflow-visible">
      <CardHeader className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-[16px] font-semibold text-ink-primary">
            {title}
          </h2>
          <p className="mt-1 m-0 text-[13px] text-ink-secondary">
            {description}
          </p>
        </div>
        {onReset && (
          <Button variant="secondary" size="sm" onClick={onReset}>
            Réinitialiser ce groupe
          </Button>
        )}
      </CardHeader>

      <CardBody className="space-y-5">{children}</CardBody>

      {!hideFooter && (
        <div className="flex items-center justify-end gap-3 border-t border-line-subtle px-5 py-3">
          {errorMsg && (
            <span className="text-[13px] text-status-critical">{errorMsg}</span>
          )}
          {successMsg && (
            <span className="text-[13px] text-status-success">
              {successMsg}
            </span>
          )}
          {onSave && (
            <Button
              variant="primary"
              size="sm"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

interface SettingFieldProps {
  label: string;
  marketId: string;
  settingKey: string;
  children: ReactNode;
  onReset?: () => void;
  hint?: string;
}

export function SettingField({
  label,
  marketId,
  settingKey,
  children,
  onReset,
  hint,
}: SettingFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[13px] font-medium text-ink-primary">
          {label}
        </label>
        <div className="flex items-center gap-3">
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="p-0 bg-transparent border-0 text-[12px] text-status-action cursor-pointer hover:underline"
            >
              Réinitialiser
            </button>
          )}
          <ChangeHistoryPopover marketId={marketId} settingKey={settingKey} />
        </div>
      </div>
      {children}
      {hint && (
        <p className="m-0 text-[12px] text-ink-secondary">{hint}</p>
      )}
    </div>
  );
}
