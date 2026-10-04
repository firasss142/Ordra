// The route-level loading state of the Commandes area, in the same page shell
// as the screens it stands in for. Importing the stylesheet here also makes it
// arrive with the boundary, so the real page never paints unstyled.
import "./commandes.css";

export function CommandesSkeleton({ tiles = 4, rows = 8 }: { tiles?: number; rows?: number }) {
  return (
    <div className="cmd cmd-page" aria-busy="true">
      <div className="page">
        <div className="sk" style={{ height: 52, width: 320, borderRadius: 14 }} />
        {tiles > 0 && (
          <div className="wts">
            {Array.from({ length: tiles }, (_, i) => (
              <div key={i} className="sk" style={{ height: 72, borderRadius: 18 }} />
            ))}
          </div>
        )}
        <div className="sk" style={{ height: 44, borderRadius: 14 }} />
        <div className="list">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="sk-row" />
          ))}
        </div>
      </div>
    </div>
  );
}
