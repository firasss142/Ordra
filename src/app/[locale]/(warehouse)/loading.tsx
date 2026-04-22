export default function WarehouseLoading() {
  return (
    <div
      className="animate-pulse"
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--bg-page)",
      }}
    >
      {/* Topbar placeholder */}
      <div
        style={{
          height: 56,
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #E1E3E5",
        }}
      />
      {/* Nav tabs placeholder */}
      <div
        style={{
          height: 44,
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #E1E3E5",
          display: "flex",
          alignItems: "center",
          paddingInline: 24,
          gap: 24,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              width: 72,
              height: 14,
              backgroundColor: "#E1E3E5",
              borderRadius: 3,
            }}
          />
        ))}
      </div>
      {/* Content area */}
      <div style={{ padding: 24 }}>
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
            backgroundColor: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                height: 52,
                borderBottom: "1px solid #F1F2F3",
                backgroundColor: i % 2 === 0 ? "#FFFFFF" : "#FAFAFA",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
