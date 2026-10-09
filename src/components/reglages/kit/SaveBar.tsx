"use client";

import { useTranslations } from "next-intl";
import { useReglagesForm } from "../form-context";
import { RgButton } from "./RgButton";

/**
 * The one save bar — the dark bar that floats at the bottom of Voix du client.
 * It appears as soon as anything changed and counts every change on the page.
 */
export function SaveBar() {
  const t = useTranslations("reglages");
  const { dirtyCount, saving, error, saveAll, resetAll } = useReglagesForm();
  if (dirtyCount === 0) return null;

  return (
    <div className="rg-save" role="region" aria-label={t("save.save")}>
      <i aria-hidden className="dt" />
      <span className="min-w-0">
        {dirtyCount === 1 ? t("save.one") : t("save.many", { count: dirtyCount })}
        {error && (
          <span role="alert" className="err">
            {error}
          </span>
        )}
      </span>
      <RgButton onClick={resetAll} disabled={saving}>
        {t("save.cancel")}
      </RgButton>
      <RgButton variant="primary" onClick={() => void saveAll()} disabled={saving}>
        {saving ? t("save.saving") : t("save.save")}
      </RgButton>
    </div>
  );
}
