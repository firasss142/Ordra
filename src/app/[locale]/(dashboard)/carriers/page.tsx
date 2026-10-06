import { Suspense } from "react";
import { resolveScorecardPage } from "@/lib/carriers/scorecard/page-scope";
import { CarrierScorecardWorkspace, ScorecardShell, ScorecardSkeleton } from "@/components/carriers/scorecard/CarrierScorecardWorkspace";

export const dynamic = "force-dynamic";

/** /carriers — Transporteurs: is each carrier doing its job? (prototypes/transporteurs-v2.html) */
export default async function CarriersPage({ params }: { params: { locale: string } }) {
  const { marketId, marketCode } = await resolveScorecardPage(params.locale);
  return (
    <Suspense fallback={<ScorecardShell><ScorecardSkeleton /></ScorecardShell>}>
      <CarrierScorecardWorkspace screen="overview" marketId={marketId} marketCode={marketCode} locale={params.locale} />
    </Suspense>
  );
}
