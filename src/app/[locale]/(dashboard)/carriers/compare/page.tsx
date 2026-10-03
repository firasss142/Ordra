import { Suspense } from "react";
import { resolveScorecardPage } from "@/lib/carriers/scorecard/page-scope";
import { CarrierScorecardWorkspace, ScorecardSkeleton } from "@/components/carriers/scorecard/CarrierScorecardWorkspace";

export const dynamic = "force-dynamic";

/** /carriers/compare — overall first, then city by city. */
export default async function CarriersComparePage({ params }: { params: { locale: string } }) {
  const { marketId, marketCode } = await resolveScorecardPage(params.locale);
  return (
    <div className="min-h-screen bg-surface-page px-[16px] pb-[64px] pt-[24px] min-[900px]:px-[32px]">
      <div className="mx-auto max-w-[1200px]">
        <Suspense fallback={<ScorecardSkeleton />}>
          <CarrierScorecardWorkspace screen="compare" marketId={marketId} marketCode={marketCode} locale={params.locale} />
        </Suspense>
      </div>
    </div>
  );
}
