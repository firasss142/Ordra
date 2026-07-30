import {
  AlertTriangle,
  Inbox,
  PackageMinus,
  PackageX,
  PhoneCall,
  Truck,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type { AlertSeverity, AlertType } from "@/app/api/alerts/summary/route";

export const SEVERITY_ORDER: AlertSeverity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_COLORS: Record<AlertSeverity, { bg: string; fg: string; dot: string }> = {
  critical: { bg: "#FFF4F4", fg: "#B91C1C", dot: "#D72C0D" },
  high: { bg: "#FFF8E6", fg: "#92400E", dot: "#B98900" },
  medium: { bg: "#EEF2FF", fg: "#3730A3", dot: "#4C6EF5" },
  low: { bg: "#F3F4F6", fg: "#374151", dot: "#6D7175" },
};

export const TYPE_ICONS: Record<AlertType, LucideIcon> = {
  dispatch_failure: Truck,
  carrier_webhook_stale: AlertTriangle,
  overdue_callback: PhoneCall,
  unassigned_overflow: Inbox,
  return_bottleneck: PackageX,
  low_stock: PackageMinus,
  stock_depleted: PackageMinus,
  agent_inactive: UserX,
};

export interface AlertsAgent {
  id: string;
  full_name: string;
  market_id: string | null;
  role: string;
}
