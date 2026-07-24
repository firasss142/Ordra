import { Skeleton } from "@/components/ui/Skeleton";

/** Generic route skeleton for dashboard-group pages (list-shaped). */
export default function DashboardLoading() {
  return (
    <div role="status" className="bg-surface-page min-h-screen p-6">
      <Skeleton className="h-7 w-44 mb-6" />
      <div className="bg-surface-card border border-line-subtle rounded-[8px] overflow-hidden flex flex-col gap-px">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-[52px] rounded-none" />
        ))}
      </div>
    </div>
  );
}
