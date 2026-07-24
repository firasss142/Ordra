import { Skeleton } from "@/components/ui/Skeleton";

/** Dashboard-shaped route skeleton — mirrors DashboardClient's layout. */
export default function DashboardLoading() {
  return (
    <div
      role="status"
      className="bg-surface-page min-h-screen px-4 pt-16 pb-12 sm:px-6 lg:px-8 lg:pt-8 lg:pb-16 flex flex-col gap-4 lg:gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <Skeleton className="h-[132px]" />
        <Skeleton className="h-[132px]" />
        <Skeleton className="h-[132px]" />
        <Skeleton className="h-[132px]" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
        <Skeleton className="h-[124px]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[280px]" />
        <Skeleton className="h-[280px]" />
      </div>
    </div>
  );
}
