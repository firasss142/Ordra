"use client";

/**
 * The data side of `/leads/[id]`: what it reads, and what its buttons do.
 *
 * `/api/leads/[id]` returns a `Lead` — the raw row plus its history — while
 * every prospect surface speaks `ProspectRow`, which carries the derived
 * bucket, the product and the campaign. The adapter below is the seam; it
 * calls the same bucketOf() the worklist uses, so a prospect that reads
 * "Campagne" in the table reads "Campagne" here too.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { bucketOf, HOT_WINDOW_MINUTES } from "@/lib/prospects/worklist";
import type { ProspectRow } from "@/lib/prospects/types";
import type { Lead, LeadHistoryEntry, LeadLostReason } from "@/types/lead";
import { CloseSheet } from "../console/Sheets";
import { ProspectDetailView } from "./ProspectDetailView";
import { ConvertSheet, type ConvertProduct, type ConvertVariant } from "./ConvertSheet";
import { CallbackSheet } from "./CallbackSheet";

interface LeadWithHistory extends Lead {
  history: LeadHistoryEntry[];
  /** Joined by the route when the lead names a product. */
  products?: { name: string | null; default_price: number | string | null } | null;
  prospect_campaigns?: { name: string | null; offer: string | null } | null;
  users?: { full_name: string | null } | null;
}

type SheetKind = "convert" | "callback" | "lost" | null;

export function ProspectDetailClient({
  leadId, locale,
}: { leadId: string; locale: string }) {
  const router = useRouter();
  const t = useTranslations("prospects");

  const { data, error, mutate } = useSWR<{ data: LeadWithHistory }>(
    `/api/leads/${leadId}`, fetcher, { revalidateOnFocus: false },
  );
  const lead = data?.data ?? null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Convert sheet selections live here so the variants request can follow.
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [lostReason, setLostReason] = useState<LeadLostReason | null>(null);
  const [lostNote, setLostNote] = useState("");

  useEffect(() => {
    if (lead?.product_interest_id) setProductId(lead.product_interest_id);
  }, [lead?.product_interest_id]);

  const { data: productsData } = useSWR<{ data: ConvertProduct[] }>(
    sheet === "convert" && lead
      ? `/api/products?market_id=${lead.market_id}&is_active=true`
      : null,
    fetcher,
  );
  const { data: variantsData } = useSWR<{ data: ConvertVariant[] }>(
    sheet === "convert" && productId ? `/api/products/${productId}/variants` : null,
    fetcher,
  );

  const row: ProspectRow | null = useMemo(() => {
    if (!lead) return null;
    const base = {
      id: lead.id,
      market_id: lead.market_id,
      status: lead.status,
      source: lead.source,
      customer_name: lead.customer_name,
      customer_phone: lead.customer_phone,
      customer_city: lead.customer_city,
      customer_address: lead.customer_address,
      product_id: lead.product_interest_id,
      product_name: lead.products?.name ?? null,
      product_price: numeric(lead.products?.default_price),
      product_image_url: null,
      product_note: lead.product_interest_note,
      notes: lead.notes,
      assigned_to: lead.assigned_to,
      assigned_name: lead.users?.full_name ?? null,
      callback_scheduled_at: lead.callback_scheduled_at,
      converted_order_id: lead.converted_order_id,
      converted_order_ref: null,
      campaign_id: lead.campaign_id ?? null,
      campaign_name: lead.prospect_campaigns?.name ?? null,
      campaign_offer: lead.prospect_campaigns?.offer ?? null,
      campaign_script: null,
      source_order_id: lead.source_order_id ?? null,
      source_order_ref: null,
      return_reason: lead.return_reason ?? null,
      repeat_kind: lead.repeat_kind ?? "none",
      prior_order_count: lead.prior_order_count ?? 0,
      prior_delivered_count: 0,
      prior_returned_count: lead.prior_rejected_count ?? 0,
      last_known_address: lead.last_known_address ?? null,
      created_at: lead.created_at,
      updated_at: lead.updated_at,
      last_touch_at: lead.updated_at,
    };
    // The same rule the worklist applies, so the two screens agree.
    return { ...base, bucket: bucketOf(base, now, HOT_WINDOW_MINUTES) } as ProspectRow;
  }, [lead, now]);

  const act = useCallback(async (fn: () => Promise<Response>) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(typeof body?.error === "string" ? body.error : t("toast.failed"));
        return false;
      }
      await mutate();
      setSheet(null);
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("toast.failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }, [mutate, t]);

  const post = (path: string, body?: unknown) =>
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  const marketCode = lead ? marketIdToCode(lead.market_id) ?? "tn" : "tn";
  const tz = lead ? marketTimezone(lead.market_id) : "Africa/Tunis";

  return (
    <>
      <ProspectDetailView
        row={row}
        history={(lead?.history ?? []) as never}
        isLoading={!data && !error}
        error={error ? String(error) : null}
        onLogAttempt={() => void act(() => post(`/api/leads/${leadId}/attempt`))}
        onQualify={() => void act(() => post(`/api/leads/${leadId}/transition`, { new_status: "qualified" }))}
        onConvert={() => { setActionError(null); setSheet("convert"); }}
        onCallback={() => { setActionError(null); setSheet("callback"); }}
        onMarkLost={() => { setLostReason(null); setLostNote(""); setActionError(null); setSheet("lost"); }}
        onArchive={() => void act(async () => {
          const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
          if (res.ok) router.push(`/${locale}/leads`);
          return res;
        })}
        busy={busy}
        actionError={actionError}
        marketCode={marketCode}
        tz={tz}
        locale={locale}
        now={now}
      />

      {sheet === "convert" && lead ? (
        <ConvertSheet
          customerName={lead.customer_name}
          productNote={lead.product_interest_note}
          products={productsData?.data ?? []}
          variants={variantsData?.data ?? []}
          productId={productId}
          onProductId={setProductId}
          variantId={variantId}
          onVariantId={setVariantId}
          busy={busy}
          error={actionError}
          onConfirm={({ quantity, unitPrice, totalPrice }) => {
            const product = (productsData?.data ?? []).find((p) => p.id === productId);
            const variant = (variantsData?.data ?? []).find((v) => v.id === variantId);
            void act(async () => {
              const res = await post(`/api/leads/${leadId}/convert`, {
                product_id: productId || null,
                product_name: product?.name ?? "—",
                variant_label: variant?.label ?? null,
                quantity,
                unit_price: unitPrice,
                total_price: totalPrice,
                customer_name: lead.customer_name,
                customer_phone: lead.customer_phone,
                customer_address: lead.customer_address,
                customer_city: lead.customer_city,
                customer_note: lead.notes,
              });
              if (res.ok) {
                const json = await res.clone().json().catch(() => null);
                const orderId = json?.data?.orderId;
                if (orderId) router.push(`/${locale}/orders/${orderId}`);
              }
              return res;
            });
          }}
          onClose={() => setSheet(null)}
          marketCode={marketCode}
          locale={locale}
        />
      ) : null}

      {sheet === "callback" && lead ? (
        <CallbackSheet
          customerName={lead.customer_name}
          busy={busy}
          error={actionError}
          onConfirm={({ at, note }) =>
            void act(() => post(`/api/leads/${leadId}/callback`, {
              callback_time: at, note: note || undefined,
            }))
          }
          onClose={() => setSheet(null)}
          tz={tz}
          locale={locale}
          now={now}
        />
      ) : null}

      {sheet === "lost" && lead ? (
        <CloseSheet
          count={1}
          reason={lostReason}
          onReason={setLostReason}
          note={lostNote}
          onNote={setLostNote}
          busy={busy}
          error={actionError}
          onConfirm={() =>
            void act(() => post(`/api/leads/${leadId}/transition`, {
              new_status: "lost",
              lost_reason: lostReason,
              lost_note: lostNote || undefined,
            }))
          }
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}

/** Postgres numerics arrive as strings over JSON. */
function numeric(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
