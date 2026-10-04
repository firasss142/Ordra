"use client";

// The search field (prototype `.srch`): one line, the hint in the placeholder,
// « / » to focus. Debounced 300 ms — every pause costs a list query and its
// enrichment RPCs (the reasoning is in git history of OrdersSearchBar).

import { useEffect, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { Ic } from "./ui";

const DEBOUNCE_MS = 300;

export function SearchBox({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (q: string) => void }) {
  const [local, setLocal] = useState(value);
  const debounced = useDebounce(local, DEBOUNCE_MS);
  const lastSent = useRef(value);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounced === lastSent.current) return;
    lastSent.current = debounced;
    onChange(debounced);
  }, [debounced, onChange]);

  // Cleared from a chip or « Tout effacer »: the box empties too.
  useEffect(() => {
    if (value !== lastSent.current) {
      setLocal(value);
      lastSent.current = value;
    }
  }, [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || el?.closest("input,textarea,select,[contenteditable=true]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className="srch">
      <Ic n="search" />
      <input ref={input} type="search" value={local} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={(e) => setLocal(e.target.value)} />
      <span className="kbd2">/</span>
    </label>
  );
}
