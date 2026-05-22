"use client";

import useSWR from "swr";
import { useAuth } from "@/context/auth";
import { STATUS_LABELS } from "@/lib/status-labels";
import { FulfillmentControls } from "./FulfillmentControls";
import { DuplicateOrderBadge } from "@/components/shared/DuplicateOrderBadge";
import { formatDisplayCurrencyCode } from "@/lib/markets";
import type { OrderStatus } from "@/types/order-status";
import type { SiblingOrder } from "@/lib/duplicate-orders/detect";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

interface OrderDetailData {
  id: string;
  external_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  customer_address: string | null;
  customer_note: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  currency: string;
  market_id: string | null;
  created_at: string;
  status: OrderStatus;
  history: HistoryEntry[];
  is_potential_duplicate?: boolean;
  duplicate_count?: number;
  duplicate_siblings?: SiblingOrder[];
  has_uploaded_sibling?: boolean;
  is_duplicate_anchor?: boolean;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "#6B7280",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 8,
        marginTop: 20,
      }}
    >
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ fontSize: 13, color: "#6B7280" }}>{label}: </span>
      <span style={{ fontSize: 13, color: "#1A1A1A" }}>{value}</span>
    </div>
  );
}

interface OrderDetailProps {
  orderId: string;
}

export function OrderDetail({ orderId }: OrderDetailProps) {
  const { user } = useAuth();
  const { data, mutate, isLoading, error } = useSWR<{ data: OrderDetailData }>(
    `/api/orders/${orderId}`,
    fetcher
  );

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#6B7280" }}>
        Chargement…
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#DC2626" }}>
        Commande introuvable.
      </div>
    );
  }

  const order = data.data;

  return (
    <div
      style={{
        backgroundColor: "white",
        border: "1px solid #E1E3E5",
        borderRadius: "0.5rem",
        padding: "24px",
        maxWidth: 640,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
          {order.external_id ?? order.id.slice(0, 8)}
        </span>
        <span style={{ fontSize: 13, color: "#6D7175" }}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      {/* Client */}
      <SectionLabel>Client</SectionLabel>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A" }}>
          {order.customer_name}
        </span>
        {order.is_potential_duplicate && order.is_duplicate_anchor && (
          <DuplicateOrderBadge
            count={order.duplicate_count ?? 0}
            siblings={order.duplicate_siblings ?? []}
            hasUploadedSibling={order.has_uploaded_sibling ?? false}
            anchorOrderId={order.id}
            anchorExternalId={order.external_id}
            anchorStatus={order.status}
            anchorCreatedAt={order.created_at}
            anchorTotalPrice={order.total_price}
            currencyCode={formatDisplayCurrencyCode(order.currency, order.market_id)}
            canDelete={
              user?.role === "agent" ||
              user?.role === "market_manager" ||
              user?.role === "super_admin"
            }
            onChange={() => mutate()}
          />
        )}
      </div>
      <div style={{ marginBottom: 4 }}>
        <a
          href={`tel:${order.customer_phone}`}
          style={{ fontSize: 14, color: "#1A1A1A", textDecoration: "none" }}
          onMouseEnter={(e) =>
            ((e.target as HTMLAnchorElement).style.textDecoration = "underline")
          }
          onMouseLeave={(e) =>
            ((e.target as HTMLAnchorElement).style.textDecoration = "none")
          }
        >
          {order.customer_phone}
        </a>
      </div>
      {(order.customer_city || order.customer_address) && (
        <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 4 }}>
          {[order.customer_city, order.customer_address].filter(Boolean).join(", ")}
        </div>
      )}
      {order.customer_note && (
        <div style={{ fontSize: 13, color: "#374151", fontStyle: "italic" }}>
          {order.customer_note}
        </div>
      )}

      {/* Commande */}
      <SectionLabel>Commande</SectionLabel>
      <DetailRow
        label="Produit"
        value={`${order.product_name}${order.variant_label ? ` — ${order.variant_label}` : ""}`}
      />
      <DetailRow label="Quantité" value={order.quantity} />
      <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A", marginTop: 4 }}>
        {order.total_price} {order.currency}
      </div>

      {/* Fulfillment controls (manager/super_admin only) */}
      {user && (
        <FulfillmentControls
          orderId={order.id}
          status={order.status}
          quantity={order.quantity}
          role={user.role}
          onSuccess={() => mutate()}
        />
      )}

      {/* Historique */}
      <SectionLabel>Historique</SectionLabel>
      {order.history.length === 0 ? (
        <div style={{ fontSize: 13, color: "#6B7280" }}>Aucun historique</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {order.history.map((entry) => (
            <div
              key={entry.id}
              style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: "#9CA3AF",
                  marginTop: 5,
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ color: "#1A1A1A" }}>
                  {entry.from_status
                    ? `${STATUS_LABELS[entry.from_status] ?? entry.from_status} → ${STATUS_LABELS[entry.to_status] ?? entry.to_status}`
                    : (STATUS_LABELS[entry.to_status] ?? entry.to_status)}
                </div>
                {entry.note && (
                  <div style={{ color: "#6B7280", fontSize: 12 }}>{entry.note}</div>
                )}
                <div style={{ color: "#9CA3AF", fontSize: 12 }}>
                  {new Date(entry.created_at).toLocaleString("fr-TN", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
