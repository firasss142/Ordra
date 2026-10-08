// The one route-level loading state (every app/**/loading.tsx renders this, nothing else).
//
// A loading.tsx paints the instant a link is clicked — BEFORE the stylesheets the route imports
// have arrived; only the page's own commit waits for them. So this draws with classes from
// globals.css alone (the `.rsk` block), which the root layout has always loaded. A skeleton that
// borrowed a feature stylesheet (commandes.css, products-v6.css…) painted blank or as bare text
// on a first visit. The in-page skeletons a page shows while its data loads are a different
// thing: they render after the page's CSS, and stay with their page.
//
// Shaped like an Aurore page — header, tiles, the search/filter line, then a list or cards — so
// the page fills in without the layout jumping (design-system §4.12).

interface RouteSkeletonProps {
  /** KPI tiles under the header; 0 for none. */
  tiles?: number;
  /** The search / filter line above the body. */
  toolbar?: boolean;
  /** A table-like list (most pages) or a grid of cards. */
  body?: "list" | "cards";
  rows?: number;
  cards?: number;
  /** The pastel Aurore ground (default) or the plain one a few screens still use. */
  ground?: "aurore" | "plain";
}

export function RouteSkeleton({
  tiles = 4,
  toolbar = true,
  body = "list",
  rows = 8,
  cards = 3,
  ground = "aurore",
}: RouteSkeletonProps) {
  return (
    <div role="status" aria-busy="true" className={ground === "plain" ? "rsk rsk-plain" : "rsk"}>
      <div className="rsk-page" aria-hidden="true">
        <div className="rsk-head">
          <div className="rsk-titles">
            <span className="rsk-b rsk-crumb" />
            <span className="rsk-b rsk-title" />
            <span className="rsk-b rsk-sub" />
          </div>
          <span className="rsk-b rsk-action" />
        </div>
        {tiles > 0 && (
          <div className="rsk-tiles" style={{ "--rsk-n": tiles } as React.CSSProperties}>
            {Array.from({ length: tiles }, (_, i) => (
              <div key={i} className="rsk-card">
                <span className="rsk-b rsk-dot" />
                <span className="rsk-b rsk-num" />
                <span className="rsk-b rsk-cap" />
              </div>
            ))}
          </div>
        )}
        {toolbar && <div className="rsk-bar" />}
        {body === "list" ? (
          <div className="rsk-list">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="rsk-row">
                <span className="rsk-b rsk-dot" />
                <span className="rsk-b rsk-cell" />
                <span className="rsk-b rsk-cell rsk-short" />
              </div>
            ))}
          </div>
        ) : (
          <div className="rsk-cards">
            {Array.from({ length: cards }, (_, i) => (
              <div key={i} className="rsk-card rsk-tall">
                <span className="rsk-b rsk-dot" />
                <span className="rsk-b rsk-num" />
                <span className="rsk-b rsk-cap" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
