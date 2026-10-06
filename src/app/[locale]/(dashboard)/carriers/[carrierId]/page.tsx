import { Suspense } from "react";
import { resolveScorecardPage } from "@/lib/carriers/scorecard/page-scope";
import { CarrierScorecardWorkspace, ScorecardShell, ScorecardSkeleton } from "@/components/carriers/scorecard/CarrierScorecardWorkspace";

export const dynamic = "force-dynamic";

/** /carriers/[carrierId] — one carrier account, five questions. */
export default async function CarrierPage({ params }: { params: { locale: string; carrierId: string } }) {
  const { marketId, marketCode } = await resolveScorecardPage(params.locale);
  return (
    <Suspense fallback={<ScorecardShell><ScorecardSkeleton /></ScorecardShell>}>
      <CarrierScorecardWorkspace screen="carrier" carrierId={params.carrierId} marketId={marketId} marketCode={marketCode} locale={params.locale} />
    </Suspense>
  );
}
