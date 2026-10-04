"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buildScorecardParcelsKey, useCarrierScorecard } from "@/hooks/useCarrierScorecard";
import { fetcher } from "@/lib/swr-config";
import { SCORECARD_PERIODS, type ScorecardParcel, type ScorecardPeriodDays } from "@/lib/carriers/scorecard/types";
import { accentFor } from "@/lib/carriers/scorecard/view-model";
import { CarrierView, type DrawerKind } from "./CarrierView";
import { CompareView } from "./CompareView";
import { carrierShort } from "./labels";
import { OverviewView } from "./OverviewView";
import { ParcelDrawer } from "./ParcelDrawer";
import { BackLink } from "./ScorecardHeader";
import { Card } from "./ui";

export type ScorecardScreen = "overview" | "carrier" | "compare";

export function parsePeriod(v: string | null): ScorecardPeriodDays {
  const n = Number(v);
  return (SCORECARD_PERIODS as readonly number[]).includes(n) ? (n as ScorecardPeriodDays) : 30;
}

/**
 * Transporteurs — one data fetch, three screens (prototypes/transporteurs-v2.html):
 * /carriers → overview, /carriers/[id] → one carrier, /carriers/compare.
 * The period lives in the URL so it survives moving between screens.
 */
export function CarrierScorecardWorkspace({
  screen, carrierId, marketId, marketCode, locale,
}: { screen: ScorecardScreen; carrierId?: string; marketId: string; marketCode: string; locale: string }) {
  const t = useTranslations("carrierScorecard");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const period = parsePeriod(params.get("period"));
  const { scorecard, error, isLoading, mutate } = useCarrierScorecard(marketId, period);
  const [drawer, setDrawer] = useState<{ kind: DrawerKind; carrierId: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => { setNow(new Date()); }, [scorecard]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const q = `?period=${period}`;
  const hrefs = useMemo(() => ({
    overview: `/${locale}/carriers${q}`,
    compare: `/${locale}/carriers/compare${q}`,
    carrier: (id: string) => `/${locale}/carriers/${id}${q}`,
    returnsBench: `/${locale}/warehouse/returns`,
  }), [locale, q]);

  const onPeriodChange = (p: ScorecardPeriodDays) => {
    const next = new URLSearchParams(params.toString());
    next.set("period", String(p));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const copyRefs = async (refs: string[], carrierName: string) => {
    const text = `${t(`copyMessage.${marketCode === "tn" ? "tn" : "ly"}`)}\n${refs.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setToast(t("copied", { n: refs.length, carrier: carrierName }));
    } catch {
      setToast(t("copyFailed"));
    }
  };

  if (!scorecard) {
    if (error && !isLoading) {
      return (
        <Card>
          <div className="flex flex-col items-center gap-[10px] px-[24px] py-[40px] text-center text-[13.5px] text-tr-ink-2">
            <p>{t("error")}</p>
            <button type="button" onClick={() => mutate()}
              className="inline-flex h-[34px] items-center rounded-[9px] border border-tr-line bg-white px-[13px] text-[13px] font-semibold text-tr-ink-1 hover:bg-tr-hover">
              {t("retry")}
            </button>
          </div>
        </Card>
      );
    }
    return <ScorecardSkeleton />;
  }

  const findCard = (id: string) => scorecard.carriers.find((c) => c.id === id) ?? null;
  const drawerCarrier = drawer
    ? findCard(drawer.carrierId) ?? scorecard.dormant.find((d) => d.id === drawer.carrierId) ?? null
    : null;
  const drawerColor = drawer
    ? (() => {
        const i = scorecard.carriers.findIndex((c) => c.id === drawer.carrierId);
        return i >= 0 ? accentFor(scorecard.carriers[i], i) : "#9AA0A6";
      })()
    : "#9AA0A6";

  let body: React.ReactNode;
  if (screen === "carrier") {
    const card = carrierId ? findCard(carrierId) : null;
    body = card ? (
      <CarrierView
        scorecard={scorecard} carrierId={card.id} locale={locale} marketCode={marketCode} period={period}
        onPeriodChange={onPeriodChange}
        onOpenDrawer={(kind) => setDrawer({ kind, carrierId: card.id })}
        onCopyLate={async () => {
          try {
            const res = (await fetcher(buildScorecardParcelsKey(marketId, card.id, "late"))) as { data: ScorecardParcel[] };
            await copyRefs(res.data.map((p) => p.tracking_number).filter((r): r is string => !!r), carrierShort(card, locale, t));
          } catch {
            setToast(t("copyFailed"));
          }
        }}
        overviewHref={hrefs.overview} compareHref={hrefs.compare} returnsBenchHref={hrefs.returnsBench}
      />
    ) : (
      <div className="flex flex-col gap-[16px]">
        <BackLink href={hrefs.overview} />
        <Card><p className="px-[24px] py-[40px] text-center text-[13.5px] text-tr-ink-2">{t("empty.card")}</p></Card>
      </div>
    );
  } else if (screen === "compare") {
    body = (
      <CompareView scorecard={scorecard} locale={locale} marketCode={marketCode} period={period} now={now}
        onPeriodChange={onPeriodChange} overviewHref={hrefs.overview} />
    );
  } else {
    body = (
      <OverviewView scorecard={scorecard} locale={locale} marketCode={marketCode} period={period} now={now}
        onPeriodChange={onPeriodChange} onOpenDormant={(id) => setDrawer({ kind: "dormant", carrierId: id })}
        carrierHref={hrefs.carrier} compareHref={hrefs.compare} />
    );
  }

  return (
    <>
      {body}
      {drawer && drawerCarrier ? (
        <ParcelDrawer
          kind={drawer.kind} marketId={marketId} carrier={drawerCarrier} color={drawerColor} locale={locale}
          returnsBenchHref={hrefs.returnsBench}
          onClose={() => setDrawer(null)}
          onCopy={(refs) => copyRefs(refs, "period" in drawerCarrier ? carrierShort(drawerCarrier, locale, t) : drawerCarrier.name)}
        />
      ) : null}
      {toast ? (
        <div role="status" className="fixed bottom-[24px] left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-[10px] bg-[#1F2328] px-[16px] py-[10px] text-[13px] text-white">
          {toast}
        </div>
      ) : null}
    </>
  );
}

export function ScorecardSkeleton() {
  const block = "animate-pulse rounded-[8px] bg-[#ECEEF0]";
  return (
    <div aria-busy="true" className="flex flex-col gap-[16px]">
      <div className="flex min-h-[44px] items-center justify-between">
        <div className={`${block} h-[26px] w-[180px]`} />
        <div className={`${block} h-[34px] w-[220px]`} />
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-[14px] border border-tr-line-2 bg-white min-[900px]:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-[8px] px-[20px] py-[18px]">
            <div className={`${block} h-[12px] w-[45%]`} />
            <div className={`${block} h-[28px] w-[38%]`} />
            <div className={`${block} h-[10px] w-[60%]`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-[16px] min-[900px]:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="overflow-hidden rounded-[14px] border border-tr-line-2 bg-white">
            <div className="h-[78px] animate-pulse bg-[#E6E8EB]" />
            <div className="grid grid-cols-3 gap-[12px] p-[18px]">
              {[0, 1, 2].map((j) => <div key={j} className={`${block} h-[60px]`} />)}
            </div>
            <div className={`${block} mx-[20px] mb-[18px] h-[70px]`} />
          </div>
        ))}
      </div>
    </div>
  );
}

