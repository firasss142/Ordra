"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, ChevronUp, ChevronDown, Save } from "lucide-react";
import { useStatusConfigs } from "@/hooks/useStatusConfigs";
import { STATUS_KEY_REGEX } from "@/types/status-config";
import type { StatusConfig, StatusScope } from "@/types/status-config";
import type { Locale } from "@/types";

interface Props {
  marketId: string;
  scope: StatusScope;
  locale: Locale;
}

export function StatusEditor({ marketId, scope, locale }: Props) {
  const t = useTranslations("settings.statuses");
  const { configs, isLoading, mutate } = useStatusConfigs({ marketId, scope });
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onError = (msg: string) => setError(msg);

  const patchStatus = async (id: string, patch: Partial<StatusConfig>) => {
    setError(null);
    const res = await fetch(`/api/settings/statuses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j?.error ?? "Update failed");
      return false;
    }
    await mutate();
    return true;
  };

  const deleteStatus = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/settings/statuses/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j?.error ?? "Delete failed");
      return;
    }
    await mutate();
  };

  const move = async (config: StatusConfig, dir: -1 | 1) => {
    const sorted = [...configs].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((c) => c.id === config.id);
    const neighbor = sorted[idx + dir];
    if (!neighbor) return;
    // swap sort_order
    await patchStatus(config.id, { sort_order: neighbor.sort_order });
    await patchStatus(neighbor.id, { sort_order: config.sort_order });
  };

  if (isLoading) {
    return (
      <div style={{ padding: 16, color: "#6D7175", fontSize: 13 }}>…</div>
    );
  }

  const sorted = [...configs].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            border: "1px solid #F0B6B4",
            backgroundColor: "#FFF5F5",
            color: "#D72C0D",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          role="row"
          style={{
            display: "grid",
            gridTemplateColumns: "24px 1fr 140px 140px 80px 90px 90px 120px",
            gap: 8,
            alignItems: "center",
            padding: "10px 16px",
            backgroundColor: "#FAFBFB",
            borderBottom: "1px solid #E1E3E5",
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "#6D7175",
          }}
        >
          <span>#</span>
          <span>{t("col.key")}</span>
          <span>{t("col.labelFr")}</span>
          <span>{t("col.labelAr")}</span>
          <span>{t("col.color")}</span>
          <span>{t("col.initial")}</span>
          <span>{t("col.terminal")}</span>
          <span style={{ textAlign: locale === "ar" ? "left" : "right" }}>
            {t("col.actions")}
          </span>
        </div>

        {sorted.map((c, idx) => (
          <Row
            key={c.id}
            config={c}
            allConfigs={sorted}
            isFirst={idx === 0}
            isLast={idx === sorted.length - 1}
            onPatch={(patch) => patchStatus(c.id, patch)}
            onDelete={() => deleteStatus(c.id)}
            onMoveUp={() => move(c, -1)}
            onMoveDown={() => move(c, 1)}
          />
        ))}
        {sorted.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#6D7175", fontSize: 13 }}>
            {t("empty")}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          backgroundColor: "#FFFFFF",
          color: "#1A1A1A",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        <Plus size={14} />
        {t("addNew")}
      </button>

      {addOpen && (
        <AddModal
          marketId={marketId}
          scope={scope}
          existingKeys={configs.map((c) => c.key)}
          existingMaxSortOrder={Math.max(0, ...configs.map((c) => c.sort_order))}
          onClose={() => setAddOpen(false)}
          onCreated={async () => {
            setAddOpen(false);
            await mutate();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function Row({
  config,
  allConfigs,
  isFirst,
  isLast,
  onPatch,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  config: StatusConfig;
  allConfigs: StatusConfig[];
  isFirst: boolean;
  isLast: boolean;
  onPatch: (patch: Partial<StatusConfig>) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
}) {
  const t = useTranslations("settings.statuses");
  const [labelFr, setLabelFr] = useState(config.label_fr);
  const [labelAr, setLabelAr] = useState(config.label_ar);
  const [color, setColor] = useState(config.color);
  const [dirty, setDirty] = useState(false);
  const [transitionsOpen, setTransitionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveLabels = async () => {
    const ok = await onPatch({
      label_fr: labelFr,
      label_ar: labelAr,
      color,
    });
    if (ok) setDirty(false);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr 140px 140px 80px 90px 90px 120px",
        gap: 8,
        alignItems: "center",
        padding: "10px 16px",
        borderBottom: "1px solid #F4F5F6",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label={t("moveUp")}
          style={arrowBtn(isFirst)}
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          aria-label={t("moveDown")}
          style={arrowBtn(isLast)}
        >
          <ChevronDown size={12} />
        </button>
      </div>

      <code style={{ fontSize: 12, color: "#1A1A1A" }}>{config.key}</code>

      <input
        type="text"
        value={labelFr}
        onChange={(e) => {
          setLabelFr(e.target.value);
          setDirty(true);
        }}
        style={inlineInput}
      />
      <input
        type="text"
        value={labelAr}
        onChange={(e) => {
          setLabelAr(e.target.value);
          setDirty(true);
        }}
        style={inlineInput}
      />

      <input
        type="color"
        value={color}
        onChange={(e) => {
          setColor(e.target.value);
          setDirty(true);
        }}
        style={{ width: 48, height: 28, padding: 0, border: "1px solid #E1E3E5", borderRadius: 4 }}
      />

      <Toggle
        value={config.is_initial}
        onChange={(v) => onPatch({ is_initial: v })}
      />
      <Toggle
        value={config.is_terminal}
        onChange={(v) => onPatch({ is_terminal: v })}
      />

      <div
        style={{
          display: "flex",
          gap: 4,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        {dirty && (
          <button
            type="button"
            onClick={saveLabels}
            aria-label={t("save")}
            style={{
              padding: "6px 8px",
              border: "1px solid #1A1A1A",
              borderRadius: 6,
              backgroundColor: "#1A1A1A",
              color: "#FFFFFF",
              cursor: "pointer",
            }}
          >
            <Save size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setTransitionsOpen(true)}
          title={t("editTransitions")}
          style={{
            padding: "6px 8px",
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            backgroundColor: "#FFFFFF",
            color: "#1A1A1A",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          →{config.allowed_transitions.length}
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label={t("delete")}
          style={{
            padding: "6px 8px",
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            backgroundColor: "#FFFFFF",
            color: "#D72C0D",
            cursor: "pointer",
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {transitionsOpen && (
        <TransitionsModal
          config={config}
          allConfigs={allConfigs}
          onClose={() => setTransitionsOpen(false)}
          onSave={async (next) => {
            const ok = await onPatch({ allowed_transitions: next });
            if (ok) setTransitionsOpen(false);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          config={config}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await onDelete();
            setConfirmDelete(false);
          }}
        />
      )}
    </div>
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        border: "1px solid #E1E3E5",
        backgroundColor: value ? "#1A1A1A" : "#FFFFFF",
        position: "relative",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: value ? 15 : 1,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: value ? "#FFFFFF" : "#6D7175",
          transition: "left 120ms",
        }}
      />
    </button>
  );
}

function TransitionsModal({
  config,
  allConfigs,
  onClose,
  onSave,
}: {
  config: StatusConfig;
  allConfigs: StatusConfig[];
  onClose: () => void;
  onSave: (next: string[]) => Promise<void>;
}) {
  const t = useTranslations("settings.statuses");
  const [selected, setSelected] = useState<string[]>(config.allowed_transitions);

  const toggle = (k: string) => {
    setSelected((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
    );
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
        {t("transitionsTitle", { key: config.key })}
      </h2>
      <div style={{ fontSize: 12, color: "#6D7175", marginBottom: 12 }}>
        {t("transitionsHelp")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
        {allConfigs
          .filter((c) => c.id !== config.id)
          .map((c) => (
            <label
              key={c.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 4px",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(c.key)}
                onChange={() => toggle(c.key)}
              />
              <code style={{ fontSize: 11 }}>{c.key}</code>
              <span style={{ color: "#6D7175", fontSize: 12 }}>—</span>
              <span>{c.label_fr}</span>
            </label>
          ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button type="button" onClick={onClose} style={secondaryBtn}>
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={() => onSave(selected)}
          style={primaryBtn}
        >
          {t("save")}
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDeleteModal({
  config,
  onCancel,
  onConfirm,
}: {
  config: StatusConfig;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations("settings.statuses");
  return (
    <Modal onClose={onCancel}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
        {t("deleteTitle")}
      </h2>
      <p style={{ fontSize: 13, margin: "8px 0 16px 0", color: "#1A1A1A" }}>
        {t("deleteBody", { key: config.key })}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onCancel} style={secondaryBtn}>
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          style={{ ...primaryBtn, backgroundColor: "#D72C0D", borderColor: "#D72C0D" }}
        >
          {t("delete")}
        </button>
      </div>
    </Modal>
  );
}

function AddModal({
  marketId,
  scope,
  existingKeys,
  existingMaxSortOrder,
  onClose,
  onCreated,
  onError,
}: {
  marketId: string;
  scope: StatusScope;
  existingKeys: string[];
  existingMaxSortOrder: number;
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("settings.statuses");
  const [key, setKey] = useState("");
  const [labelFr, setLabelFr] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [color, setColor] = useState("#64748B");
  const [submitting, setSubmitting] = useState(false);

  const keyValid = STATUS_KEY_REGEX.test(key);
  const keyConflict = existingKeys.includes(key);
  const canSubmit =
    key.length > 0 && keyValid && !keyConflict && labelFr.length > 0 && labelAr.length > 0;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const res = await fetch("/api/settings/statuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        market_id: marketId,
        scope,
        key,
        label_fr: labelFr,
        label_ar: labelAr,
        color,
        sort_order: existingMaxSortOrder + 1,
        is_initial: false,
        is_terminal: false,
        allowed_transitions: [],
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j?.error ?? "Create failed");
      return;
    }
    await onCreated();
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
        {t("addTitle")}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
        <label style={fieldLabel}>
          <span>{t("col.key")}</span>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="blocked_customs"
            style={input}
          />
          <span style={hint}>
            {!keyValid && key.length > 0 ? t("keyInvalid") : keyConflict ? t("keyConflict") : t("keyHint")}
          </span>
        </label>
        <label style={fieldLabel}>
          <span>{t("col.labelFr")}</span>
          <input type="text" value={labelFr} onChange={(e) => setLabelFr(e.target.value)} style={input} />
        </label>
        <label style={fieldLabel}>
          <span>{t("col.labelAr")}</span>
          <input type="text" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} style={input} />
        </label>
        <label style={fieldLabel}>
          <span>{t("col.color")}</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 60, height: 32, border: "1px solid #E1E3E5", borderRadius: 4 }} />
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onClose} style={secondaryBtn}>
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || submitting}
          style={{ ...primaryBtn, opacity: !canSubmit ? 0.5 : 1 }}
        >
          {submitting ? "…" : t("create")}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 8,
          padding: 20,
          minWidth: 420,
          maxWidth: 560,
          boxShadow: "0 12px 32px rgba(0,0,0,0.2)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const arrowBtn = (disabled: boolean): React.CSSProperties => ({
  width: 20,
  height: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid #E1E3E5",
  borderRadius: 3,
  backgroundColor: disabled ? "#F4F5F6" : "#FFFFFF",
  color: disabled ? "#C4C6C8" : "#1A1A1A",
  padding: 0,
  cursor: disabled ? "not-allowed" : "pointer",
});

const inlineInput: React.CSSProperties = {
  width: "100%",
  height: 28,
  padding: "0 8px",
  border: "1px solid #E1E3E5",
  borderRadius: 4,
  fontSize: 13,
  backgroundColor: "#FFFFFF",
  color: "#1A1A1A",
};

const input: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  fontSize: 13,
  backgroundColor: "#FFFFFF",
};

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "#6D7175",
};

const hint: React.CSSProperties = {
  fontSize: 11,
  color: "#6D7175",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #1A1A1A",
  borderRadius: 6,
  backgroundColor: "#1A1A1A",
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  backgroundColor: "#FFFFFF",
  color: "#1A1A1A",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
