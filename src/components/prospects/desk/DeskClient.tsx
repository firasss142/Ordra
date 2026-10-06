"use client";

/**
 * The data side of the manager's Prospects page: what it reads, and what its
 * buttons do. Everything visual is DeskView.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import { useRejectionReasons } from "@/hooks/useRejectionReasons";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { buildDesk } from "@/lib/prospects/desk/model";
import { RECOVERABLE_SUBREASONS } from "@/lib/prospects/desk/rules";
import type { DeskRow } from "@/lib/prospects/desk/list";
import type { DeskFacts, RecoverySettings } from "@/lib/prospects/desk/types";
import type { Draft } from "@/lib/prospects/desk/wizard";
import type { Condition } from "@/lib/prospects/audience";
import type { Role } from "@/types";
import { DeskView } from "./DeskView";
import type { ListFilters } from "./ProspectList";
import { useToast, type ProductOption } from "./parts";
import { currentMonthIn } from "./format";

interface ListResponse { rows: DeskRow[]; total: number }
interface ProductRow { id: string; name: string; default_price: number | null; image_url: string | null }

async function send(url: string, method: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(typeof json?.error === "string" ? json.error : "failed"), { body: json });
  return json;
}

export function DeskClient({ role, marketId: own, locale, openId = null }: { role: Role; marketId: string | null; locale: string; openId?: string | null }) {
  const t = useTranslations("prospects.desk");
  const scope = useMarketScope();
  const market = role === "super_admin" ? scope.marketId : own;
  const tz = marketTimezone(market);
  const thisMonth = currentMonthIn(tz);
  const [month, setMonth] = useState(thisMonth);
  const [filters, setFilters] = useState<ListFilters>({ sources: [], agents: [], state: "open", q: "", page: 1 });
  const [q, setQ] = useState("");
  const [toast, setToast] = useToast();
  const sa = role === "super_admin" && market ? `market_id=${market}` : "";
  const withMarket = useCallback((body: Record<string, unknown>) => (role === "super_admin" && market ? { market_id: market, ...body } : body), [role, market]);

  // A keystroke is not a request.
  useEffect(() => { const id = setTimeout(() => setQ(filters.q.trim()), 300); return () => clearTimeout(id); }, [filters.q]);

  const deskKey = market ? `/api/prospects/desk?month=${month}${sa ? `&${sa}` : ""}` : null;
  const { data: facts, error: deskError, mutate: mutateDesk } = useSWR<DeskFacts>(deskKey, fetcher, { refreshInterval: 60_000, keepPreviousData: true });
  const { data: rules, mutate: mutateRules } = useSWR<RecoverySettings>(market ? `/api/prospects/rules${sa ? `?${sa}` : ""}` : null, fetcher, { revalidateOnFocus: false });

  const listParams = useMemo(() => {
    const qs = new URLSearchParams();
    if (sa) qs.set("market_id", market!);
    if (filters.sources.length) qs.set("src", filters.sources.join(","));
    if (filters.agents.length) qs.set("agent", filters.agents.join(","));
    qs.set("state", filters.state);
    if (q) qs.set("q", q);
    return qs;
  }, [sa, market, filters.sources, filters.agents, filters.state, q]);
  const listKey = market ? `/api/prospects/desk/list?${listParams.toString()}&page=${filters.page}` : null;
  const { data: list, error: listError, isLoading: listLoading, mutate: mutateList } = useSWR<ListResponse>(listKey, fetcher, { refreshInterval: 60_000, keepPreviousData: true });

  const { data: productData } = useSWR<{ data: ProductRow[] }>(market ? `/api/products/search?market_id=${market}` : null, fetcher, { revalidateOnFocus: false });
  const { data: cityData } = useSWR<{ cities: string[] }>(market ? `/api/prospects/desk/cities${sa ? `?${sa}` : ""}` : null, fetcher, { revalidateOnFocus: false });
  const { active: waActive } = useWhatsAppAvailability(market);
  const { rows: reasonRows } = useRejectionReasons(market);

  // An old /leads/[id] link: fetch that one prospect, whatever page or state it is on.
  const validOpen = openId && /^[0-9a-f-]{36}$/i.test(openId) ? openId : null;
  const { data: opened } = useSWR<ListResponse>(market && validOpen ? `/api/prospects/desk/list?id=${validOpen}${sa ? `&${sa}` : ""}` : null, fetcher, { revalidateOnFocus: false });

  const view = useMemo(() => (facts && "hero" in facts ? buildDesk(facts) : null), [facts]);
  const products: ProductOption[] = useMemo(
    () => (Array.isArray(productData?.data) ? productData!.data : []).map((p) => { const n = p.default_price === null || p.default_price === undefined ? NaN : Number(p.default_price); return { id: p.id, name: p.name, price: Number.isFinite(n) ? n : null, image: p.image_url }; }),
    [productData],
  );
  const reasonLabel = useCallback((key: string) => {
    const r = reasonRows.find((x) => x.key === key && x.parent_key !== null) ?? reasonRows.find((x) => x.key === key);
    return r ? (locale === "ar" ? r.short_ar || r.label_ar : r.short_fr || r.label_fr) : key.replace(/_/g, " ");
  }, [reasonRows, locale]);
  const subreasons = useMemo(() => {
    const live = reasonRows.filter((r) => r.parent_key !== null && (RECOVERABLE_SUBREASONS as readonly string[]).includes(r.key));
    const keys = live.length ? live.map((r) => r.key) : [...RECOVERABLE_SUBREASONS];
    return keys.map((k) => ({ key: k, label: reasonLabel(k) }));
  }, [reasonRows, reasonLabel]);

  const refresh = useCallback(async () => { await Promise.all([mutateDesk(), mutateList()]); }, [mutateDesk, mutateList]);

  if (!market) return <div className="mx-auto w-full max-w-[1240px] px-4 py-16 text-center text-[15px] text-[#475467]">{t("selectMarket")}</div>;

  return (
    <DeskView
      view={view} settings={rules ?? facts?.settings ?? null} month={month} currentMonth={thisMonth} onMonth={setMonth}
      rows={list?.rows ?? []} total={list?.total ?? 0} listLoading={listLoading} error={Boolean(deskError || listError)} onRetry={() => void refresh()}
      filters={filters} onFilters={(f) => setFilters((x) => ({ ...x, ...f }))}
      products={products} cities={cityData?.cities ?? []} subreasons={subreasons} reasonLabel={reasonLabel}
      waActive={waActive} waLang={marketIdToCode(market) === "tn" ? "fr" : "ar"}
      locale={locale} tz={tz} marketId={market} toast={toast} initialOpen={opened?.rows?.[0] ?? null}
      onDistribute={async () => {
        try {
          const r = await send("/api/prospects/desk/distribute", "POST", withMarket({}));
          setToast(t("todo.distributed", { n: Number(r.assigned ?? 0) }));
          await refresh();
        } catch { setToast(t("loadError")); }
      }}
      onAssign={async (ids, agentId) => {
        await send("/api/prospects/desk/assign", "POST", withMarket({ lead_ids: ids, agent_id: agentId }));
        const name = view?.agents.find((a) => a.id === agentId)?.name ?? "";
        setToast(t("reassign.ok", { agent: name }));
        await refresh();
      }}
      onCloseLeads={async (ids, reason, note) => {
        for (const id of ids) await send(`/api/prospects/${id}/outcome`, "POST", { kind: "lost", reason, note: note || undefined });
        setToast(t("close.ok", { n: ids.length }));
        await refresh();
      }}
      onSaveRules={async (s) => {
        try {
          const saved = await send(`/api/prospects/rules${sa ? `?${sa}` : ""}`, "PUT", s);
          await mutateRules(saved as unknown as RecoverySettings, { revalidate: false });
          await mutateDesk();
          setToast(t("rulesSheet.saved"));
          return null;
        } catch (e) {
          return ((e as { body?: { field?: string } }).body?.field) ?? t("loadError");
        }
      }}
      onExport={async ({ scope: s, format, cols, ids }) => {
        const qs = new URLSearchParams(listParams);
        qs.set("format", format); qs.set("scope", s); qs.set("cols", cols.join(",")); qs.set("lang", locale);
        if (s === "ids") qs.set("ids", ids.join(","));
        if (s === "month") qs.set("month", month);
        const res = await fetch(`/api/prospects/desk/export?${qs.toString()}`);
        if (!res.ok) throw new Error("export_failed");
        const file = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "prospects.csv";
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a"); a.href = url; a.download = file; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setToast(t("export.toast", { file }));
        return file;
      }}
      onPreview={async (conditions: Condition[]) => {
        const r = await send("/api/prospects/campaigns?preview=1", "POST", withMarket({ conditions }));
        const excluded = Object.values((r.excluded ?? {}) as Record<string, number>).reduce((s, n) => s + n, 0);
        return { net: Number(r.net ?? 0), excluded };
      }}
      onCreateList={async (d: Draft, conditions: Condition[], name: string) => {
        try {
          if (d.start === "csv") {
            const r = await send("/api/leads/import", "POST", withMarket({ csv: d.csv?.text ?? "" }));
            const n = Number(r.imported ?? 0);
            setToast(t("wizard.created", { n }));
            await refresh();
            return String(n);
          }
          const offered = d.offerProductIds.map((id) => products.find((p) => p.id === id)).filter(Boolean) as ProductOption[];
          const imageUrl = (offered[0]?.image ?? products.find((p) => p.id === d.products[0]?.id)?.image) || null;
          const wa = d.how === "wa";
          const r = await send("/api/prospects/campaigns", "POST", withMarket({
            name, conditions, offer: d.offer.trim() || null, offer_product_ids: d.offerProductIds,
            channel: wa ? "wa" : "call", wa_sender: wa ? "api" : "agent",
            wa_message: wa ? d.wa.message : null, wa_language: d.wa.lang,
            wa_image: wa && d.wa.image && Boolean(imageUrl), wa_image_url: wa && d.wa.image ? imageUrl : null,
          }));
          setToast(wa ? t("wizard.submitted") : t("wizard.created", { n: Number(r.inserted ?? 0) }));
          await refresh();
          return String(r.id ?? "");
        } catch (e) {
          const code = (e as Error).message;
          throw new Error(["duplicate_name", "wa_message_required", "whatsapp_not_connected"].includes(code) ? t(`wizard.errors.${code}`) : t("wizard.errors.generic"));
        }
      }}
    />
  );
}
