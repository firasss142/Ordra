// Shape-matched skeleton. The group-level (dashboard)/loading.tsx renders a
// generic table — six 52px rows — which is the wrong silhouette for this page
// and makes the transition read as a layout jump rather than a load.
export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex min-h-screen flex-col gap-4 bg-oms-bg px-4 pb-20 pt-16 md:px-6 md:pt-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-[190px] rounded-md bg-oms-sunken" />
          <div className="h-3.5 w-[240px] rounded-md bg-oms-sunken" />
        </div>
        <div className="h-8 w-[280px] rounded-md bg-oms-sunken" />
      </div>

      <div className="h-[42px] rounded-card bg-oms-sunken" />

      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[92px] min-w-[172px] flex-1 basis-[200px] rounded-card bg-oms-sunken" />
        ))}
      </div>

      <div className="h-[300px] rounded-card bg-oms-sunken" />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="h-[260px] rounded-card bg-oms-sunken" />
        <div className="h-[260px] rounded-card bg-oms-sunken" />
      </div>

      <div className="h-[220px] rounded-card bg-oms-sunken" />
    </div>
  );
}
