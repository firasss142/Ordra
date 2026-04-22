export default function FollowUpsLoading() {
  return (
    <div
      style={{
        padding: "32px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Block height={24} width={160} />
      <Block height={13} width={240} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Block height={34} width={140} />
        <Block height={34} width={360} />
        <Block height={34} width={180} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: "16px 18px",
              height: 124,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: "0 0 304px",
              minHeight: 480,
              background: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Block height={32} width={160} />
            {Array.from({ length: 5 }).map((__, j) => (
              <div
                key={j}
                style={{
                  height: 72,
                  background: "#F7F7F7",
                  borderRadius: 6,
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({ height, width }: { height: number; width: number }) {
  return (
    <div
      style={{
        height,
        width,
        background: "#F7F7F7",
        borderRadius: 6,
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}
