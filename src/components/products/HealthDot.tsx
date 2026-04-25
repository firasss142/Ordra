import type { ProductHealth } from "@/lib/product-calculations";

const COLOR_MAP: Record<ProductHealth, string> = {
  green: "#008060",
  amber: "#B98900",
  red: "#D72C0D",
};

export function HealthDot({
  health,
  label,
  size = 8,
}: {
  health: ProductHealth;
  label: string;
  size?: number;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: COLOR_MAP[health],
        flexShrink: 0,
      }}
    />
  );
}
