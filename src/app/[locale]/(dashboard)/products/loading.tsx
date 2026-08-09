/**
 * Route-level skeleton, shaped to the real /products layout.
 *
 * It previously rendered the generic `PageSkeleton rows={8}`, which is a title
 * plus eight bars — nothing like this page. The result read as lag even when the
 * data was quick: the first paint showed one layout, then every block jumped as
 * the real header, three KPI cards, five filter chips and the toolbar replaced
 * it. Matching the geometry here means the transition is a fill-in, not a
 * reflow.
 *
 * Heights are pinned to the real components: KPI card 138px, filter chip 50px,
 * toolbar control 44px, table row 70px, table header 50px.
 */
export default function ProductsLoading() {
  const bar = "animate-pulse rounded-[6px] bg-surface-sunken";

  return (
    <div className="min-h-screen bg-surface-page px-6 pb-16 pt-6 md:px-8">
      <div className="flex flex-col gap-[22px]" role="status" aria-busy="true">
        <span className="sr-only">Chargement</span>

        {/* header: title + subtitle, actions right */}
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex flex-col gap-2.5">
            <span className={`block h-8 w-[190px] ${bar}`} />
            <span className={`block h-4 w-[320px] ${bar}`} />
          </div>
          <div className="flex items-center gap-2.5">
            <span className={`block h-11 w-[150px] rounded-[11px] ${bar}`} />
            <span className={`block h-11 w-[180px] rounded-[11px] ${bar}`} />
          </div>
        </div>

        {/* three KPI cards */}
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(306px,1fr))]">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex min-h-[138px] flex-col gap-3.5 rounded-[16px] border border-line-subtle bg-surface-card p-[17px_19px_16px]"
            >
              <div className="flex items-center gap-2.5">
                <span className={`block h-[30px] w-[30px] rounded-[9px] ${bar}`} />
                <span className={`block h-3.5 w-[120px] ${bar}`} />
              </div>
              <div className="mt-auto flex items-end justify-between gap-4">
                <span className="flex flex-col gap-2">
                  <span className={`block h-7 w-[140px] ${bar}`} />
                  <span className={`block h-3 w-[110px] ${bar}`} />
                </span>
                <span className={`block h-[34px] w-[88px] ${bar}`} />
              </div>
            </div>
          ))}
        </div>

        {/* "Attention requise" heading + five filter chips */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className={`block h-3 w-[130px] ${bar}`} />
            <span className={`block h-3 w-[100px] ${bar}`} />
          </div>
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className={`block h-[50px] rounded-[12px] ${bar}`} />
            ))}
          </div>
        </div>

        {/* toolbar: search left, three controls right */}
        <div className="flex flex-wrap items-center gap-3">
          <span className={`block h-11 flex-1 basis-[320px] rounded-[11px] ${bar}`} />
          <span className="min-w-0 flex-1 basis-2" />
          <span className={`block h-10 w-[110px] rounded-[10px] ${bar}`} />
          <span className={`block h-10 w-[170px] rounded-[10px] ${bar}`} />
          <span className={`block h-10 w-[130px] rounded-[10px] ${bar}`} />
        </div>

        {/* table card */}
        <div className="overflow-hidden rounded-[15px] border border-line-subtle bg-surface-card">
          <div className="flex h-[50px] items-center gap-4 border-b border-line-subtle px-[18px]">
            <span className={`block h-3.5 w-[90px] ${bar}`} />
            <span className={`ms-auto block h-3.5 w-[60px] ${bar}`} />
            <span className={`block h-3.5 w-[60px] ${bar}`} />
            <span className={`block h-3.5 w-[60px] ${bar}`} />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex h-[70px] items-center gap-3.5 border-b border-line-subtle px-[18px] last:border-b-0"
            >
              <span className={`block h-[17px] w-[17px] rounded-[4px] ${bar}`} />
              <span className={`block h-[42px] w-[42px] flex-none rounded-[11px] ${bar}`} />
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className={`block h-3.5 w-[180px] ${bar}`} />
                <span className={`block h-3 w-[110px] ${bar}`} />
              </span>
              <span className={`ms-auto block h-3.5 w-[70px] ${bar}`} />
              <span className={`block h-3.5 w-[70px] ${bar}`} />
              <span className={`block h-3.5 w-[90px] ${bar}`} />
              <span className={`block h-[30px] w-[70px] rounded-[9px] ${bar}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
