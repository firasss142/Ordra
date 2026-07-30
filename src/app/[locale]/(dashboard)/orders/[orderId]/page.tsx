import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ orderId: string; locale: string }>;
}

// Legacy route — the order detail now opens as a drawer over the orders list.
export default async function OrderDetailPage({ params }: Props) {
  const { orderId, locale } = await params;
  redirect(`/${locale}/orders?open=${orderId}`);
}
