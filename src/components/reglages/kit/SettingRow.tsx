import type { ReactNode } from "react";

/**
 * One setting (prototype `.sr`): label and help on the start side, the control
 * on the end side, the history clock last. `stack` puts the control on its own
 * full-width line (option cards, the shares table). A changed row carries an
 * amber dot after its label.
 */
export function SettingRow({
  label,
  help,
  control,
  history,
  dirty = false,
  stack = false,
  muted = false,
  sunken = false,
  testId = "setting-row",
}: {
  label: ReactNode;
  help?: ReactNode;
  control?: ReactNode;
  history?: ReactNode;
  dirty?: boolean;
  stack?: boolean;
  muted?: boolean;
  sunken?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-dirty={dirty ? "true" : undefined}
      className={`relative grid items-start gap-x-[20px] gap-y-[4px] border-b border-line-subtle px-[16px] py-[14px] last:border-b-0 ${stack ? "grid-cols-[minmax(0,1fr)_32px]" : "grid-cols-[minmax(0,1fr)_auto_32px]"} ${muted ? "opacity-[.55]" : ""} ${sunken ? "bg-surface-sunken" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-[8px] text-[14px] font-medium text-ink-primary">
          {label}
          {dirty && <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-status-warning" />}
        </div>
        {help && <div className="mt-[3px] max-w-[60ch] text-[13px] leading-[1.5] text-ink-secondary">{help}</div>}
      </div>
      {!stack && <div className="flex min-h-[36px] items-center justify-end gap-[8px]">{control}</div>}
      <div className="mt-[2px]">{history}</div>
      {stack && <div className="col-span-full mt-[10px]">{control}</div>}
    </div>
  );
}
