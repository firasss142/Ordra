import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Clock,
  CornerUpLeft,
  DownloadCloud,
  HelpCircle,
  PackageCheck,
  PackageOpen,
  PackageX,
  PhoneCall,
  PhoneOutgoing,
  Route,
  ScanLine,
  Trash2,
  Truck,
  UserCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { StatusIconName } from "@/lib/orders/status-presentation";

/**
 * The mark a status wears, resolved from the name that
 * `lib/orders/status-presentation` hands out.
 *
 * This replaced `StatusGlyph`, an 8×8 abstract vocabulary of
 * ring/solid/half/check/cross/square that encoded open-vs-closed. That encoding
 * was real but unreadable: at 8px a "half" and a "square" are two grey smudges,
 * and the family had no round success mark, so `delivered` and `confirmed` were
 * forced to share one. A per-status icon says more in the same space.
 *
 * One map, keyed off one presentation module, so the queue pill, the console
 * badge and the filter chips cannot disagree about what a status looks like.
 */
const ICONS: Record<StatusIconName, LucideIcon> = {
  waiting: Clock,
  assigned: UserCheck,
  unverified: HelpCircle,
  calling: PhoneOutgoing,
  callback: PhoneCall,
  scheduled: CalendarClock,
  confirmed: CheckCircle2,
  uploaded: DownloadCloud,
  scanned: ScanLine,
  dispatched: Truck,
  deposit: PackageOpen,
  inTransit: Route,
  delivered: CheckCircle2,
  received: PackageCheck,
  toReturn: CornerUpLeft,
  returned: PackageX,
  rejected: XCircle,
  cancelled: Ban,
  deleted: Trash2,
};

interface Props {
  name: StatusIconName;
  size?: number;
  className?: string;
}

export function StatusIcon({ name, size = 14, className = "" }: Props) {
  const Icon = ICONS[name] ?? Clock;
  return (
    <Icon
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    />
  );
}
