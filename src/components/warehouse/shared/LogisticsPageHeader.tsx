import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function LogisticsPageHeader({ title, subtitle, actions }: Props) {
  return (
    <div style={{ marginBlockEnd: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              color: "#1A1A1A",
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6D7175" }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
