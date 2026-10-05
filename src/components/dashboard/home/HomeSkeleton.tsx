// Accueil's silhouette while it loads — the same blocks as the page (header, the
// summary card, a row of store cards), so nothing jumps when the figures arrive.
// Used by the route's loading.tsx and by the page's first fetch.

export function HomeSkeleton() {
  return (
    <>
      <div className="sk sk-head" />
      <div className="sk sk-sum" />
      <div className="sk-cards">
        <div className="sk" />
        <div className="sk" />
        <div className="sk" />
      </div>
    </>
  );
}
