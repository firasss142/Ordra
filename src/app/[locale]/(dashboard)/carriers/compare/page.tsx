import { Suspense } from "react";
import { resolveScorecardPage } from "@/lib/carriers/scorecard/page-scope";
import { CarrierScorecardWorkspace, ScorecardShell, ScorecardSkeleton } from "@/components/carriers/scorecard/CarrierScorecardWorkspace";

export const dynamic = "force-dynamic";

/** /carriers/compare — overall first, then city by city. */
export default async function CarriersComparePage({ params }: { params: { locale: string } }) {
  const { marketId, marketCode } = await resolveScorecardPage(params.locale);
  return (
    <Suspense fallback={<ScorecardShell><ScorecardSkeleton /></ScorecardShell>}>
      <CarrierScorecardWorkspace screen="compare" marketId={marketId} marketCode={marketCode} locale={params.locale} />
    </Suspense>
  );
}
