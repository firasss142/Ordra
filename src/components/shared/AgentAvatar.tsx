/**
 * Agent avatar — a deterministic hue per name, so the same person keeps the
 * same colour everywhere they appear (row, facet menu, assignment picker).
 * Unassigned is drawn as an empty slot rather than a name, because it is the
 * one state that wants acting on.
 */
export function AgentAvatar({ name, size = 24 }: { name: string | null; size?: number }) {
  const box = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  if (!name) {
    return (
      <span
        aria-hidden
        style={box}
        className="grid shrink-0 place-items-center rounded-full border border-dashed border-oms-border-strong text-oms-ink-3"
      >
        +
      </span>
    );
  }

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;

  return (
    <span
      aria-hidden
      style={{
        ...box,
        background: `linear-gradient(140deg, hsl(${hue} 55% 58%), hsl(${hue} 58% 42%))`,
      }}
      className="grid shrink-0 place-items-center rounded-full font-bold uppercase text-white"
    >
      {name.trim().slice(0, 2)}
    </span>
  );
}
