import { Suspense } from "react";
import { resolveScorecardPage } from "@/lib/carriers/scorecard/page-scope";
import { CarrierScorecardWorkspace, ScorecardSkeleton } from "@/components/carriers/scorecard/CarrierScorecardWorkspace";

export const dynamic = "force-dynamic";

/** /carriers/[carrierId] — one carrier account, five questions. */
export default async function CarrierPage({ params }: { params: { locale: string; carrierId: string } }) {
  const { marketId, marketCode } = await resolveScorecardPage(params.locale);
  return (
    <div className="min-h-screen bg-surface-page px-[16px] pb-[64px] pt-[24px] min-[900px]:px-[32px]">
      <div className="mx-auto max-w-[1200px]">
        <Suspense fallback={<ScorecardSkeleton />}>
          <CarrierScorecardWorkspace screen="carrier" carrierId={params.carrierId} marketId={marketId} marketCode={marketCode} locale={params.locale} />
        </Suspense>
      </div>
    </div>
  );
}
