interface GoalBarProps {
  rate: number;
  target: number;
}

function barColor(rate: number, target: number): string {
  if (rate >= target) return "#008060";
  if (rate >= target * 0.7) return "#D97706";
  return "#D72C0D";
}

export function GoalBar({ rate, target }: GoalBarProps) {
  const pct = Math.min((rate / target) * 100, 100);
  const color = barColor(rate, target);
  return (
    <div
      style={{
        width: "100%",
        height: 4,
        backgroundColor: "#E1E3E5",
        borderRadius: 9999,
        overflow: "hidden",
        marginTop: 4,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          backgroundColor: color,
          borderRadius: 9999,
          transition: "width 300ms ease",
        }}
      />
    </div>
  );
}
