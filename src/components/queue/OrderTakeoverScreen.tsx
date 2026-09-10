"use client";

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  releasedByName: string | null;
  onDismiss: () => void;
}

/**
 * Shown to an agent whose order was force-released by a super_admin.
 *
 * Deliberately louder than the reassignment toast that QueuePage already
 * shows. A toast is right for "this order left your queue"; this is "someone
 * took it out of your hands while you were holding it", and it can land in the
 * middle of a phone call. role="alert" + aria-live="assertive" for the same
 * reason.
 *
 * Reached by two independent paths, on purpose: the `lock_forced` broadcast
 * (≈1s) and a heartbeat answering 409 lock_lost (≤25s). The second is what
 * covers a dropped socket.
 */
export function OrderTakeoverScreen({ releasedByName, onDismiss }: Props) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="absolute inset-0 z-10 grid place-items-center bg-oms-surface/95 p-6"
    >
      <div className="max-w-[320px] text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-status-criticalBg">
          <ShieldAlert size={22} strokeWidth={1.9} className="text-status-critical" aria-hidden />
        </span>
        <h2 className="mt-4 text-[15px] font-semibold text-oms-ink-1">
          Cette commande vous a été retirée
        </h2>
        <p className="mt-2 text-[13px] text-oms-ink-2">
          {releasedByName
            ? `${releasedByName} a repris la main sur cette commande. Vos modifications non enregistrées n'ont pas été conservées.`
            : "Un administrateur a repris la main sur cette commande. Vos modifications non enregistrées n'ont pas été conservées."}
        </p>
        <Button className="mt-5" onClick={onDismiss}>
          Retour à ma file
        </Button>
      </div>
    </div>
  );
}
