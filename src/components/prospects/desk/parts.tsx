"use client";

/** Small shared pieces of the desk: product cover, avatar, tooltip, toast. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { agentColorKey, agentColorVars } from "@/lib/team/agent-color";

export interface ProductOption { id: string; name: string; price: number | null; image: string | null }

const COVERS = [["#0E5C4A", "#0A4337", "#D4B26A"], ["#6B2234", "#4E1826", "#E0BC77"], ["#1F3A5F", "#152944", "#D4B26A"], ["#3B2A55", "#2A1E3D", "#E3C680"]];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/** The product's photo, or a cover drawn from its name when it has none. */
export function Cover({ product, w = 40 }: { product: Pick<ProductOption, "id" | "name" | "image"> | null; w?: number }) {
  const h = Math.round(w * 1.32);
  if (product?.image) {
    return <span className="cover img" style={{ width: w, height: h }}><img src={product.image} alt="" loading="lazy" /></span>;
  }
  const [a, b, g] = COVERS[hash(product?.id ?? "x") % COVERS.length];
  return (
    <span className="cover" style={{ width: w, height: h, background: `linear-gradient(135deg,${a},${b})`, ["--g" as string]: g } as CSSProperties} aria-hidden>
      <i /><b>{(product?.name ?? "").split(" ")[0]}</b>
    </span>
  );
}

export function Avatar({ id, name, color, size, online }: { id: string; name: string; color: string | null; size?: 24; online?: boolean }) {
  return (
    <span className={`av${size === 24 ? " s24" : ""}`} style={agentColorVars(agentColorKey(color, id))}>
      {name.slice(0, 1).toUpperCase()}
      {online !== undefined ? <span className={`pr${online ? "" : " off"}`} /> : null}
    </span>
  );
}

export function CheckBox({ on }: { on: boolean }) {
  return <span className={`cb${on ? " on" : ""}`} aria-hidden>{on ? <Check className="ic" /> : null}</span>;
}

/** One tooltip for the whole desk: any element with data-tip. */
export function useDeskTip() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      const tip = ref.current;
      if (!tip) return;
      if (!el) { tip.style.opacity = "0"; return; }
      tip.textContent = el.dataset.tip ?? "";
      tip.style.opacity = "1";
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      const y = e.clientY + 18 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    document.addEventListener("mousemove", move);
    return () => document.removeEventListener("mousemove", move);
  }, []);
  return ref;
}

export function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(id);
  }, [msg]);
  return [msg, setMsg];
}

/** Close a popover when the pointer goes down outside it, or on Escape. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open, onClose]);
  return ref;
}
