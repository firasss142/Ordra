import type { ReactNode } from "react";

/**
 * One setting: label and help on the start side, the control on the end side,
 * the history clock last. `stack` puts the control on its own full-width line
 * (option cards, the shares table). A changed row carries an amber dot and a
 * faint amber wash (reglages.css `.rg-sr`).
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
      className={`rg-sr${stack ? " stack" : ""}${muted ? " muted" : ""}${sunken ? " sunken" : ""}`}
    >
      <div className="min-w-0">
        <div className="lb">
          {label}
          {dirty && <span aria-hidden className="dd" />}
        </div>
        {help && <div className="hp">{help}</div>}
      </div>
      {!stack && <div className="ctl">{control}</div>}
      <div>{history}</div>
      {stack && <div className="ctl">{control}</div>}
    </div>
  );
}
