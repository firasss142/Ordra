import "@/components/dashboard/home/store-dashboard.css";

/** Accueil's own ground while the route loads — the page's silhouette, no layout jump when it fills. */
export default function DashboardLoading() {
  return (
    <div className="sdb" role="status" aria-busy="true">
      <div className="page">
        <div className="sk" style={{ height: 70, background: "transparent", border: 0, boxShadow: "none" }} />
        <div className="sk" style={{ height: 380 }} />
        <div className="sk" style={{ height: 520 }} />
      </div>
    </div>
  );
}
