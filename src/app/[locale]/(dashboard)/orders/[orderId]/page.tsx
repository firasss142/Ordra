import { OrderDetail } from "@/components/orders/OrderDetail";

interface Props {
  params: Promise<{ orderId: string; locale: string }>;
}

export default async function OrderDetailPage({ params }: Props) {
  const { orderId } = await params;

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh", padding: "32px 32px 64px" }}>
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "#1A1A1A",
          margin: "0 0 24px 0",
        }}
      >
        Détail commande
      </h1>
      <OrderDetail orderId={orderId} />
    </div>
  );
}
