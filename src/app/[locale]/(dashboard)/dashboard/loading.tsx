import "@/components/dashboard/home/store-dashboard.css";
import { HomeSkeleton } from "@/components/dashboard/home/HomeSkeleton";

/** Accueil's own ground while the route loads — the page's silhouette, no layout jump when it fills. */
export default function DashboardLoading() {
  return (
    <div className="sdb" role="status" aria-busy="true">
      <div className="page">
        <HomeSkeleton />
      </div>
    </div>
  );
}
