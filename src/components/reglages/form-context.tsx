"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";

/**
 * One save model for the whole Réglages page (plans/reglages-redesign.md):
 * every form card registers what it changed; one save bar counts the changes,
 * saves them all, or throws them all away. Lists (shops, carriers, sites…) act
 * at once and never go through here.
 */
export interface Saver {
  count: number;
  save: () => Promise<void>;
  reset: () => void;
  /** Checked before anything is saved; a message vetoes the whole save. */
  validate?: () => string | null;
  /** Lower saves first (default 0) — the agents' split before the method that needs it. */
  order?: number;
}

interface FormContextValue {
  dirtyCount: number;
  saving: boolean;
  error: string | null;
  register: (id: string, saver: Saver | null) => void;
  saveAll: () => Promise<boolean>;
  resetAll: () => void;
}

const FormContext = createContext<FormContextValue | null>(null);

export function ReglagesFormProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("reglages");
  const toast = useToast();
  const savers = useRef(new Map<string, Saver>());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recount = useCallback(() => {
    let n = 0;
    savers.current.forEach((s) => (n += s.count));
    setDirtyCount(n);
  }, []);

  const register = useCallback(
    (id: string, saver: Saver | null) => {
      if (saver) savers.current.set(id, saver);
      else savers.current.delete(id);
      recount();
    },
    [recount],
  );

  const saveAll = useCallback(async () => {
    setError(null);
    for (const s of Array.from(savers.current.values())) {
      const veto = s.validate?.();
      if (veto) {
        setError(veto);
        return false;
      }
    }
    setSaving(true);
    try {
      const ordered = Array.from(savers.current.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const s of ordered) {
        if (s.count > 0) await s.save();
      }
      toast.show({ message: t("save.saved"), tone: "info" });
      return true;
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("save.failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [t, toast]);

  const resetAll = useCallback(() => {
    savers.current.forEach((s) => s.reset());
    setError(null);
  }, []);

  // A reload or a closed tab with unsaved changes asks first.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  const value = useMemo(
    () => ({ dirtyCount, saving, error, register, saveAll, resetAll }),
    [dirtyCount, saving, error, register, saveAll, resetAll],
  );
  return <FormContext.Provider value={value}>{children}</FormContext.Provider>;
}

export function useReglagesForm(): FormContextValue {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error("useReglagesForm must be used inside <ReglagesFormProvider>");
  return ctx;
}

/** Register a card's pending changes with the page's save bar. */
export function useRegisterSaver(id: string, saver: Saver | null) {
  const { register } = useReglagesForm();
  const latest = useRef(saver);
  latest.current = saver;
  const count = saver?.count ?? 0;
  const order = saver?.order ?? 0;
  const present = saver !== null;

  useEffect(() => {
    if (!present) {
      register(id, null);
      return;
    }
    register(id, {
      count,
      save: () => latest.current?.save() ?? Promise.resolve(),
      reset: () => latest.current?.reset(),
      validate: () => latest.current?.validate?.() ?? null,
      order,
    });
  }, [id, count, order, present, register]);

  useEffect(() => () => register(id, null), [id, register]);
}
