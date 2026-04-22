export default function OrdersLoading() {
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
      <Block height={24} width={120} />
      <Block height={13} width={220} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Block height={34} width={140} />
        <Block height={34} width={280} />
        <Block height={34} width={110} />
        <Block height={34} width={110} />
        <Block height={34} width={110} />
      </div>
      <Block height={32} width={320} />
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 40,
              background: "#F7F7F7",
              borderRadius: 6,
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
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
