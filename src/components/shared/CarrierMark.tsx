/**
 * Carrier mark — a compact, recognisable stand-in for a delivery company.
 *
 * Carriers have no logo asset in the schema, so the mark derives a stable hue
 * from the name. It still does the job a logo does in a list: you spot which
 * company an order sits with without reading the label.
 */
export function CarrierMark({ name, size = 20 }: { name: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 37 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        background: `hsl(${hue} 62% 94%)`,
        color: `hsl(${hue} 60% 32%)`,
        borderRadius: Math.round(size * 0.28),
      }}
      className="grid shrink-0 place-items-center font-bold uppercase"
    >
      {name.trim().slice(0, 2)}
    </span>
  );
}
