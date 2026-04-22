const SURFACE = {
  base: "#F1F2F3",
  card: "white",
  border: "#E1E3E5",
  stripe: "#FAFAFA",
  row: "#F1F2F3",
};

interface PageSkeletonProps {
  /** How many row placeholders to render. Defaults to 6. */
  rows?: number;
  /** Optional title width override (px). */
  titleWidth?: number;
}

export function PageSkeleton({ rows = 6, titleWidth = 180 }: PageSkeletonProps) {
  return (
    <div
      className="animate-pulse"
      style={{
        padding: 24,
        backgroundColor: "var(--bg-page)",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          width: titleWidth,
          height: 28,
          backgroundColor: SURFACE.base,
          borderRadius: 4,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          backgroundColor: SURFACE.card,
          border: `1px solid ${SURFACE.border}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 52,
              borderBottom: `1px solid ${SURFACE.row}`,
              backgroundColor: i % 2 === 0 ? SURFACE.card : SURFACE.stripe,
            }}
          />
        ))}
      </div>
    </div>
  );
}
