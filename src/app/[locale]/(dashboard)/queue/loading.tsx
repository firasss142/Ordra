export default function AgentLoading() {
  return (
    <div
      className="animate-pulse"
      style={{ minHeight: "100vh", backgroundColor: "var(--bg-page)" }}
    >
      {/* Topbar placeholder */}
      <div
        style={{
          height: 64,
          backgroundColor: "#1A1A1A",
          borderBottom: "1px solid #2A2A2A",
        }}
      />
      {/* Nav tabs placeholder */}
      <div
        style={{
          height: 44,
          backgroundColor: "white",
          borderBottom: "1px solid #E1E3E5",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 24px",
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 80,
              height: 24,
              backgroundColor: "#E1E3E5",
              borderRadius: 4,
            }}
          />
        ))}
      </div>
      {/* Queue rows placeholder */}
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              height: 88,
              backgroundColor: "white",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
            }}
          />
        ))}
      </div>
    </div>
  );
}
