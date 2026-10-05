"use client";

// The product actions the list rows and the sheet share: activate / deactivate,
// adjust stock, archive. Same routes and modals as before; one place for both.

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { useStockAdjust } from "@/components/products/useStockAdjust";
import { ArchiveProductModal, type ArchiveProductState } from "@/components/products/ArchiveProductModal";

export function useProductActions(onChanged: () => void | Promise<unknown>) {
  const t = useTranslations("products");
  const tv = useTranslations("products.v6");
  const toast = useToast();
  const [archive, setArchive] = useState<ArchiveProductState | null>(null);

  const setActive = useCallback(
    async (id: string, value: boolean) => {
      const res = await fetch(`/api/products/${id}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: value }),
      });
      if (!res.ok) {
        toast.show({ tone: "critical", message: tv("t_failed", { msg: String(res.status) }) });
        return;
      }
      toast.show({ message: tv(value ? "t_activated" : "t_deactivated") });
      await onChanged();
    },
    [onChanged, toast, tv],
  );

  const { openStock, modal: stockModal } = useStockAdjust(() => onChanged());

  const openArchive = useCallback((productId: string, productName: string) => {
    setArchive({ productId, productName, loading: false, error: null });
  }, []);

  const confirmArchive = useCallback(async () => {
    const target = archive;
    if (!target) return;
    setArchive((s) => s && { ...s, loading: true, error: null });
    const res = await fetch(`/api/products/${target.productId}/archive`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      const message =
        res.status === 422 ? t("errors.archiveStillActive") : (json.error ?? t("errors.generic", { status: res.status }));
      setArchive((s) => s && { ...s, loading: false, error: message });
      return false;
    }
    setArchive(null);
    await onChanged();
    return true;
  }, [archive, onChanged, t]);

  const modals = (
    <>
      {stockModal}
      {archive ? (
        <ArchiveProductModal
          state={archive}
          onConfirm={() => void confirmArchive()}
          onClose={() => setArchive((s) => (s && !s.loading ? null : s))}
        />
      ) : null}
    </>
  );

  return { setActive, openStock, openArchive, confirmArchive, modals };
}
