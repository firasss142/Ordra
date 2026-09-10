"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import type { OrderLockInfo } from "@/lib/orders/order-lock";

interface Props {
  open: boolean;
  lock: OrderLockInfo | null;
  role: string | undefined;
  onClose: () => void;
  /** super_admin only. Absent for every other role. */
  onForceRelease?: () => void | Promise<void>;
}

/**
 * What a manager sees when they act on an order an agent is holding.
 *
 * It says who, and for how long, because "Réessayez plus tard" without a name
 * is indistinguishable from a bug. A `market_manager` gets no way out: their
 * recourse is to wait out the ~75s TTL or ask a super_admin. That is a product
 * decision, not an oversight — a lock a colleague can break on a hunch is not
 * a lock.
 */
export function OrderLockedDialog({ open, lock, role, onClose, onForceRelease }: Props) {
  const [forcing, setForcing] = useState(false);
  if (!lock) return null;

  const who = lock.holder_name ?? "Un agent";
  const minutes = lock.since
    ? Math.max(0, Math.round((Date.now() - new Date(lock.since).getTime()) / 60_000))
    : null;

  async function handleForce() {
    if (!onForceRelease) return;
    setForcing(true);
    try {
      await onForceRelease();
    } finally {
      setForcing(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} placement="center" ariaLabel="Commande en cours d'utilisation">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span className="relative inline-grid place-items-center rounded-full ring-2 ring-brand" style={{ padding: 2 }}>
            <AgentAvatar name={lock.holder_name} size={32} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-oms-ink-1">
              {who} travaille sur cette commande
            </h2>
            <p className="mt-1 text-[13px] text-oms-ink-2">
              {minutes !== null
                ? `Ouverte depuis ${minutes} min. Vos modifications ont été refusées pour ne pas écraser son travail.`
                : "Vos modifications ont été refusées pour ne pas écraser son travail."}
            </p>
          </div>
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-lg bg-oms-bg p-3 text-[12.5px] text-oms-ink-2">
          <Lock size={14} strokeWidth={1.9} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            Le verrou se libère seul environ une minute après que l&apos;agent ferme la commande.
          </span>
        </p>

        <div className="mt-5 flex items-center justify-end gap-2">
          {role === "super_admin" && onForceRelease && (
            <Button variant="secondary" onClick={handleForce} disabled={forcing}>
              {forcing ? "Libération…" : "Forcer la libération"}
            </Button>
          )}
          <Button onClick={onClose}>Compris</Button>
        </div>
      </div>
    </Sheet>
  );
}
