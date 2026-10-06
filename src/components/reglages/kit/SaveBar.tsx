"use client";

import { useTranslations } from "next-intl";
import { useReglagesForm } from "../form-context";
import { RgButton } from "./RgButton";

/**
 * The one save bar (prototype `.savebar`): appears at the top of the content
 * as soon as anything changed, sticks while you scroll, counts every change.
 */
export function SaveBar() {
  const t = useTranslations("reglages");
  const { dirtyCount, saving, error, saveAll, resetAll } = useReglagesForm();
  if (dirtyCount === 0) return null;

  return (
    <div className="sticky top-[68px] z-20 mb-[16px] md:top-[12px]">
      <div className="rg-save">
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-[9px] text-[14px] font-bold text-ink-primary">
            <i aria-hidden className="h-[8px] w-[8px] flex-none rounded-full bg-[#F79009]" />
            {dirtyCount === 1 ? t("save.one") : t("save.many", { count: dirtyCount })}
          </span>
          {error && (
            <span role="alert" className="ps-[17px] text-[12.5px] text-status-critical">
              {error}
            </span>
          )}
        </span>
        <span className="flex-1" />
        <RgButton onClick={resetAll} disabled={saving}>
          {t("save.cancel")}
        </RgButton>
        <RgButton variant="primary" onClick={() => void saveAll()} disabled={saving}>
          {saving ? t("save.saving") : t("save.save")}
        </RgButton>
      </div>
    </div>
  );
}
