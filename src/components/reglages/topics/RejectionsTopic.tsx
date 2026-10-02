"use client";

import { useState, type DragEvent, type KeyboardEvent } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import {
  ThumbsDown,
  FileX,
  PhoneOff,
  MapPinOff,
  MessageSquareText,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useRejectionReasons } from "@/hooks/useRejectionReasons";
import { canEditArea } from "@/lib/reglages/topics";
import { reasonKeyFrom } from "@/lib/reglages/helpers";
import type { RejectionReasonConfig } from "@/types/rejection-config";
import type { TopicProps } from "../TopicBody";
import { SettingsCard, Notice, EmptyState, Drawer, DrawerSection, Field, inputClass, ReadOnlyLine, RgBadge, th, td, trPlain } from "../kit/parts";
import { RgButton } from "../kit/RgButton";
import { TopicSkeleton } from "../kit/TopicSkeleton";

/** The group's mark — the same icons the rejected badge carries (StatusIcon). */
const GROUP_ICON: Record<string, LucideIcon> = {
  refus_client: ThumbsDown,
  commande_invalide: FileX,
  injoignable: PhoneOff,
  livraison_impossible: MapPinOff,
  autre: MessageSquareText,
};

/** A rejected order's badge: the short reason, in the rejected red, with its group's icon. */
function ReasonBadge({ group, text, testId }: { group: string; text: string; testId?: string }) {
  const Icon = GROUP_ICON[group] ?? FileX;
  return (
    <span
      data-testid={testId}
      className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-status-criticalBg py-[2px] pe-[9px] ps-[7px] text-[12px] font-semibold text-status-critical"
    >
      <Icon className="h-[13px] w-[13px]" aria-hidden />
      {text}
    </span>
  );
}

type DrawerState = { mode: "edit"; row: RejectionReasonConfig } | { mode: "add"; group: string } | null;

/**
 * Réglages › Motifs de rejet — the five fixed groups, each a card of its
 * sub-reasons with their badge and how many orders carry them. Editing goes
 * through a panel with a badge preview (no more save-on-blur). A market
 * manager edits it.
 */
export function RejectionsTopic({ user, marketId }: TopicProps) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const toast = useToast();
  const { rows, mutate, isLoading } = useRejectionReasons(marketId);
  const { data: usageData, mutate: mutateUsage } = useSWR<{ data: Record<string, number> }>(
    `/api/settings/rejection-reasons/usage?market_id=${marketId}`,
  );
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const editable = canEditArea(user.role, "rejections");
  const usage = usageData?.data ?? {};
  const ar = locale === "ar";

  if (isLoading && rows.length === 0) return <TopicSkeleton cards={3} />;

  const groups = rows.filter((r) => r.parent_key === null).sort((a, b) => a.sort_order - b.sort_order);
  const childrenOf = (key: string) => rows.filter((r) => r.parent_key === key).sort((a, b) => a.sort_order - b.sort_order);
  const label = (r: RejectionReasonConfig) => (ar ? r.label_ar : r.label_fr);
  const other = (r: RejectionReasonConfig) => (ar ? r.label_fr : r.label_ar);
  const short = (r: RejectionReasonConfig) => (ar ? r.short_ar : r.short_fr);

  /** Write the new order of a group: one PATCH per row whose place changed. */
  const reorder = async (list: RejectionReasonConfig[]) => {
    const changed = list.map((r, i) => ({ r, i })).filter(({ r, i }) => r.sort_order !== i);
    await Promise.all(
      changed.map(({ r, i }) =>
        fetch(`/api/settings/rejection-reasons/${r.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: i }),
        }),
      ),
    );
    await mutate();
    toast.show({ message: t("rejections.toast.moved"), tone: "info" });
  };
  const move = (list: RejectionReasonConfig[], from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    void reorder(next);
  };

  const reactivate = async (r: RejectionReasonConfig) => {
    await fetch(`/api/settings/rejection-reasons/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    });
    await mutate();
    toast.show({ message: t("rejections.toast.reactivated"), tone: "info" });
  };

  return (
    <>
      <Notice>{t("rejections.intro")}</Notice>
      {groups.map((g) => {
        const list = childrenOf(g.key);
        const active = list.filter((r) => r.is_active);
        const total = list.reduce((sum, r) => sum + (usage[r.key] ?? 0), 0);
        return (
          <SettingsCard
            key={g.id}
            title={
              <>
                <span className="grid h-[24px] w-[24px] place-items-center rounded-full bg-status-criticalBg text-status-critical">
                  {(() => {
                    const Icon = GROUP_ICON[g.key] ?? FileX;
                    return <Icon className="h-[13px] w-[13px]" aria-hidden />;
                  })()}
                </span>
                {label(g)}
              </>
            }
            description={`${t(`rejections.groups.${g.key}`)} · ${t("rejections.orders", { count: total.toLocaleString("fr-FR") })}`}
            end={
              g.key === "autre" ? undefined : editable ? (
                <RgButton onClick={() => setDrawer({ mode: "add", group: g.key })}>
                  <Plus aria-hidden />
                  {t("rejections.add")}
                </RgButton>
              ) : (
                <ReadOnlyLine />
              )
            }
          >
            {list.length === 0 ? (
              <EmptyState icon={<MessageSquareText aria-hidden />} title={t("rejections.emptyTitle")} text={t("rejections.emptyText")} />
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${th} w-[1%]`} />
                    <th className={th}>{t("rejections.colReason")}</th>
                    <th className={th}>{t("rejections.colBadge")}</th>
                    <th className={`${th} text-end`}>{t("rejections.colOrders")}</th>
                    <th className={`${th} w-[1%]`} />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const idx = active.indexOf(r);
                    const onKey = (e: KeyboardEvent) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        move(active, idx, idx + 1);
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        move(active, idx, idx - 1);
                      }
                    };
                    const dragProps =
                      editable && r.is_active
                        ? {
                            draggable: true,
                            onDragStart: () => setDragKey(r.key),
                            onDragOver: (e: DragEvent) => e.preventDefault(),
                            onDrop: () => {
                              const from = active.findIndex((x) => x.key === dragKey);
                              setDragKey(null);
                              if (from >= 0) move(active, from, idx);
                            },
                          }
                        : {};
                    return (
                      <tr key={r.id} className={`${trPlain} ${r.is_active ? "" : "opacity-60"}`} {...dragProps}>
                        <td className={`${td} w-[1%]`}>
                          {editable && r.is_active ? (
                            <button
                              type="button"
                              aria-label={t("rejections.move", { reason: label(r) })}
                              title={t("rejections.moveHint")}
                              onKeyDown={onKey}
                              className="grid h-[24px] w-[20px] cursor-grab place-items-center text-[#B5BAC0]"
                            >
                              <GripVertical className="h-[16px] w-[16px]" aria-hidden />
                            </button>
                          ) : null}
                        </td>
                        <td className={td}>
                          <b className="font-medium">{label(r)}</b>
                          <div className="text-[12.5px] text-ink-secondary" dir={ar ? "ltr" : "rtl"}>
                            {other(r)}
                          </div>
                        </td>
                        <td className={td}>
                          {r.is_active ? <ReasonBadge group={g.key} text={short(r)} /> : <RgBadge tone="neutral">{t("rejections.retired")}</RgBadge>}
                        </td>
                        <td className={`${td} text-end tabular-nums`}>{(usage[r.key] ?? 0).toLocaleString("fr-FR")}</td>
                        <td className={`${td} w-[1%] text-end`}>
                          {editable &&
                            (r.is_active ? (
                              <RgButton size="sm" onClick={() => setDrawer({ mode: "edit", row: r })}>
                                <Pencil aria-hidden />
                                {t("rejections.edit")}
                              </RgButton>
                            ) : (
                              <RgButton size="sm" onClick={() => void reactivate(r)}>
                                {t("rejections.reactivate")}
                              </RgButton>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </SettingsCard>
        );
      })}

      {drawer && (
        <ReasonDrawer
          state={drawer}
          marketId={marketId}
          groupRow={groups.find((g) => g.key === (drawer.mode === "edit" ? drawer.row.parent_key : drawer.group))}
          usage={drawer.mode === "edit" ? usage[drawer.row.key] ?? 0 : 0}
          takenKeys={rows.map((r) => r.key)}
          nextSort={drawer.mode === "add" ? childrenOf(drawer.group).length : 0}
          onClose={() => setDrawer(null)}
          onDone={async (message) => {
            await Promise.all([mutate(), mutateUsage()]);
            setDrawer(null);
            toast.show({ message, tone: "info" });
          }}
        />
      )}
    </>
  );
}

function ReasonDrawer({
  state,
  marketId,
  groupRow,
  usage,
  takenKeys,
  nextSort,
  onClose,
  onDone,
}: {
  state: NonNullable<DrawerState>;
  marketId: string;
  groupRow: RejectionReasonConfig | undefined;
  usage: number;
  takenKeys: string[];
  nextSort: number;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const row = state.mode === "edit" ? state.row : null;
  const group = state.mode === "edit" ? state.row.parent_key ?? "" : state.group;
  const [labelFr, setLabelFr] = useState(row?.label_fr ?? "");
  const [labelAr, setLabelAr] = useState(row?.label_ar ?? "");
  const [shortFr, setShortFr] = useState(row?.short_fr ?? "");
  const [shortAr, setShortAr] = useState(row?.short_ar ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groupLabel = groupRow ? (locale === "ar" ? groupRow.label_ar : groupRow.label_fr) : group;
  const preview = (locale === "ar" ? shortAr : shortFr) || t("rejections.drawer.previewEmpty");

  const save = async () => {
    const vals = { label_fr: labelFr.trim(), label_ar: labelAr.trim(), short_fr: shortFr.trim(), short_ar: shortAr.trim() };
    if (Object.values(vals).some((v) => !v)) {
      setError(t("rejections.drawer.required"));
      return;
    }
    setBusy(true);
    setError(null);
    let res: Response;
    if (row) {
      const patch = Object.fromEntries(Object.entries(vals).filter(([k, v]) => row[k as keyof typeof vals] !== v));
      if (Object.keys(patch).length === 0) {
        setBusy(false);
        onClose();
        return;
      }
      res = await fetch(`/api/settings/rejection-reasons/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } else {
      res = await fetch(`/api/settings/rejection-reasons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, parent_key: group, key: reasonKeyFrom(vals.label_fr, takenKeys), ...vals, sort_order: nextSort }),
      });
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.status === 409 ? t("rejections.drawer.duplicate") : t("common.error"));
      return;
    }
    await onDone(t(row ? "rejections.toast.saved" : "rejections.toast.added"));
  };

  const retire = async () => {
    if (!row) return;
    setBusy(true);
    const res = await fetch(`/api/settings/rejection-reasons/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(t("common.error"));
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { mode?: string };
    await onDone(t(body.mode === "deleted" ? "rejections.toast.deleted" : "rejections.toast.retired"));
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={t(row ? "rejections.drawer.editTitle" : "rejections.drawer.addTitle")}
      subtitle={t("rejections.drawer.group", { group: groupLabel })}
      footer={
        <>
          {error && (
            <span role="alert" className="text-[12.5px] text-status-critical">
              {error}
            </span>
          )}
          <span className="flex-1" />
          <RgButton onClick={onClose}>{t("common.cancel")}</RgButton>
          <RgButton variant="primary" onClick={() => void save()} disabled={busy}>
            {row ? t("common.save") : t("rejections.drawer.create")}
          </RgButton>
        </>
      }
    >
      <DrawerSection>
        <div className="grid grid-cols-2 gap-[12px]">
          <Field label={t("rejections.drawer.labelFr")} htmlFor="rg-r-lfr">
            <input id="rg-r-lfr" dir="ltr" className={inputClass} value={labelFr} onChange={(e) => setLabelFr(e.target.value)} />
          </Field>
          <Field label={t("rejections.drawer.labelAr")} htmlFor="rg-r-lar">
            <input id="rg-r-lar" dir="rtl" className={inputClass} value={labelAr} onChange={(e) => setLabelAr(e.target.value)} />
          </Field>
          <Field label={t("rejections.drawer.shortFr")} htmlFor="rg-r-sfr" help={t("rejections.drawer.shortHelp")}>
            <input id="rg-r-sfr" dir="ltr" className={inputClass} value={shortFr} onChange={(e) => setShortFr(e.target.value)} />
          </Field>
          <Field label={t("rejections.drawer.shortAr")} htmlFor="rg-r-sar" help={t("rejections.drawer.shortHelp")}>
            <input id="rg-r-sar" dir="rtl" className={inputClass} value={shortAr} onChange={(e) => setShortAr(e.target.value)} />
          </Field>
        </div>
      </DrawerSection>
      <DrawerSection title={t("rejections.drawer.preview")}>
        <ReasonBadge group={group} text={preview} testId="badge-preview" />
      </DrawerSection>
      {row && (
        <DrawerSection title={t("rejections.drawer.retireTitle")}>
          <p className="m-0 mb-[10px] text-[13px] text-ink-secondary">
            {usage > 0 ? t("rejections.drawer.retireUsed", { count: usage.toLocaleString("fr-FR") }) : t("rejections.drawer.retireUnused")}
          </p>
          <RgButton variant="danger" onClick={() => void retire()} disabled={busy}>
            <Trash2 aria-hidden />
            {t("rejections.drawer.retire")}
          </RgButton>
        </DrawerSection>
      )}
    </Drawer>
  );
}
