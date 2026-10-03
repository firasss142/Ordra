"use client";

import type { ReactNode } from "react";
import type { MarketSettings } from "@/types/settings";
import type { MarketSettingsForm } from "../useMarketSettingsForm";
import { SettingRow } from "./SettingRow";
import { NumberField } from "./NumberField";
import { HistoryButton } from "./HistoryButton";
import { ReadOnlyValue } from "./parts";

type NumericKey = {
  [K in keyof MarketSettings]-?: NonNullable<MarketSettings[K]> extends number ? K : never;
}[keyof MarketSettings];

/**
 * A numeric market setting: label, a help sentence that restates the value
 * (it follows what you type), the number with its unit, and the history clock.
 * Read-only shows the value, not a greyed input.
 */
export function NumberSetting({
  form,
  marketId,
  settingKey,
  label,
  unit,
  prefix,
  help,
  editable,
  min = 0,
  max,
  step = 1,
}: {
  form: MarketSettingsForm;
  marketId: string;
  settingKey: NumericKey;
  label: string;
  unit?: string;
  prefix?: string;
  help: (value: number) => ReactNode;
  editable: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  const value = form.value(settingKey) as number | null | undefined;
  const dirty = form.isDirty(settingKey);
  return (
    <SettingRow
      label={label}
      dirty={dirty}
      help={help(typeof value === "number" ? value : 0)}
      control={
        editable ? (
          <NumberField
            label={label}
            value={typeof value === "number" ? value : null}
            onChange={(n) => form.set(settingKey, n as never)}
            unit={unit}
            prefix={prefix}
            min={min}
            max={max}
            step={step}
            dirty={dirty}
          />
        ) : (
          <ReadOnlyValue value={value ?? "—"} unit={unit} prefix={prefix} />
        )
      }
      history={<HistoryButton marketId={marketId} settingKey={settingKey} label={label} />}
    />
  );
}
