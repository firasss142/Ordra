export default function LeadsLoading() {
  return (
    <div
      className="animate-pulse"
      style={{ padding: 24, backgroundColor: "var(--bg-page)", minHeight: "100vh" }}
    >
      <div
        style={{
          width: 180,
          height: 28,
          backgroundColor: "#E1E3E5",
          borderRadius: 4,
          marginBottom: 24,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              height: 72,
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
