import Image from "next/image";

interface PlatformIconProps {
  platform: string;
  size?: number;
  /** Optional override for the background color (defaults to white). */
  background?: string;
  /** Optional override for the foreground color (defaults to #1A1A1A). */
  color?: string;
}

const LOGO_PATHS: Record<string, string> = {
  lightfunnels: "/lightfunnel-logo.svg",
  shopify: "/shopify_monotone_black.svg",
  woocommerce: "/woo_logo_black.svg",
};

const LETTERS: Record<string, string> = {
  easy_orders: "E",
};

const LABELS: Record<string, string> = {
  easy_orders: "Easy Orders",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  lightfunnels: "Lightfunnels",
};

export function PlatformIcon({
  platform,
  size = 16,
  background = "#FFFFFF",
  color = "#1A1A1A",
}: PlatformIconProps) {
  const label = LABELS[platform] ?? platform;
  const logoPath = LOGO_PATHS[platform];

  if (logoPath) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: "50%",
          background,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <Image
          src={logoPath}
          alt={label}
          width={size}
          height={size}
          style={{ objectFit: "contain" }}
        />
      </span>
    );
  }

  const letter = LETTERS[platform] ?? "?";
  const fontSize = Math.max(8, Math.round(size * 0.55));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" r="7.5" fill={background} stroke={color} strokeWidth="1" />
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="-apple-system, system-ui, sans-serif"
        fontSize={fontSize}
        fontWeight="600"
        fill={color}
      >
        {letter}
      </text>
    </svg>
  );
}
