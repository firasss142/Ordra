import "@/components/performance/orders/performance-orders.css";

/** The page's own ground while the route loads — no layout jump when it fills. */
export default function Loading() {
  return (
    <div className="pco" aria-busy="true">
      <div className="page">
        <div className="sk" style={{ height: 70, background: "transparent", border: 0, boxShadow: "none" }} />
        <div className="sk" style={{ height: 320 }} />
        <div className="sk" style={{ height: 220 }} />
      </div>
    </div>
  );
}
