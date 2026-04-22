"use client";

import { useState } from "react";
import type { Period } from "@/components/dashboard/MetricsTable";

export interface AdSpendEntry {
  id: string;
  amount: number;
  period_start: string;
  period_end: string;
  note: string | null;
  is_active: boolean;
}

interface AdSpendManagerProps {
  entries: AdSpendEntry[];
  period: Period;
  onAdd: (entry: { amount: number; period_start: string; period_end: string; note: string }) => Promise<void>;
  onEdit: (id: string, patch: { amount?: number; period_start?: string; period_end?: string; note?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  isLoading: boolean;
}

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  border: "1px solid #D1D5DB",
  borderRadius: "0.25rem",
  padding: "6px 10px",
  color: "#1A1A1A",
  background: "white",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6D7175",
  fontWeight: 500,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const headerStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #D1D5DB",
  textAlign: "start",
};

const cellStyle: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 13,
  color: "#1A1A1A",
  borderBottom: "1px solid #D1D5DB",
  verticalAlign: "middle",
};

function formatDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

interface AddFormState {
  periodStart: string;
  periodEnd: string;
  amount: string;
  note: string;
  submitting: boolean;
}

interface EditFormState {
  periodStart: string;
  periodEnd: string;
  amount: string;
  note: string;
  submitting: boolean;
}

export function AdSpendManager({
  entries,
  period,
  onAdd,
  onEdit,
  onDelete,
  isLoading,
}: AdSpendManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState>({
    periodStart: period.from_date,
    periodEnd: period.to_date,
    amount: "",
    note: "",
    submitting: false,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    periodStart: "",
    periodEnd: "",
    amount: "",
    note: "",
    submitting: false,
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleAdd() {
    if (!addForm.amount || Number(addForm.amount) <= 0) return;
    setAddForm((f) => ({ ...f, submitting: true }));
    await onAdd({
      amount: Number(addForm.amount),
      period_start: addForm.periodStart,
      period_end: addForm.periodEnd,
      note: addForm.note,
    });
    setAddForm({
      periodStart: period.from_date,
      periodEnd: period.to_date,
      amount: "",
      note: "",
      submitting: false,
    });
    setShowAddForm(false);
  }

  function startEdit(entry: AdSpendEntry) {
    setEditingId(entry.id);
    setEditForm({
      periodStart: entry.period_start,
      periodEnd: entry.period_end,
      amount: String(entry.amount),
      note: entry.note ?? "",
      submitting: false,
    });
    setConfirmDeleteId(null);
  }

  async function handleEditSave(id: string) {
    setEditForm((f) => ({ ...f, submitting: true }));
    await onEdit(id, {
      amount: Number(editForm.amount),
      period_start: editForm.periodStart,
      period_end: editForm.periodEnd,
      note: editForm.note,
    });
    setEditingId(null);
  }

  async function handleConfirmDelete(id: string) {
    setDeleting(true);
    await onDelete(id);
    setConfirmDeleteId(null);
    setDeleting(false);
  }

  return (
    <div>
      <div style={{ padding: "16px 16px 0", fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
        Dépenses publicitaires
      </div>

      {/* Entry list */}
      {isLoading ? (
        <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "#6D7175" }}>
          Chargement…
        </div>
      ) : entries.length === 0 && !showAddForm ? (
        <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "#6D7175" }}>
          Aucune dépense pour cette période
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead>
            <tr>
              <th style={headerStyle}>Période</th>
              <th style={{ ...headerStyle, textAlign: "end" }}>Montant</th>
              <th style={headerStyle}>Note</th>
              <th style={{ ...headerStyle, width: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              if (editingId === entry.id) {
                return (
                  <tr key={entry.id} style={{ background: "#F9FAFB" }}>
                    <td style={cellStyle}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="date"
                          value={editForm.periodStart}
                          onChange={(e) => setEditForm((f) => ({ ...f, periodStart: e.target.value }))}
                          style={{ ...inputStyle, fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: "#6D7175" }}>–</span>
                        <input
                          type="date"
                          value={editForm.periodEnd}
                          onChange={(e) => setEditForm((f) => ({ ...f, periodEnd: e.target.value }))}
                          style={{ ...inputStyle, fontSize: 12 }}
                        />
                      </div>
                    </td>
                    <td style={{ ...cellStyle, textAlign: "end" }}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editForm.amount}
                        onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                        style={{ ...inputStyle, width: 90, textAlign: "end", fontSize: 12 }}
                      />
                    </td>
                    <td style={cellStyle}>
                      <input
                        type="text"
                        value={editForm.note}
                        onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                        style={{ ...inputStyle, fontSize: 12, width: "100%" }}
                      />
                    </td>
                    <td style={cellStyle}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleEditSave(entry.id)}
                          disabled={editForm.submitting}
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: "white",
                            background: editForm.submitting ? "#9CA3AF" : "#1A1A1A",
                            border: "none",
                            borderRadius: "0.25rem",
                            padding: "4px 10px",
                            cursor: editForm.submitting ? "not-allowed" : "pointer",
                          }}
                        >
                          {editForm.submitting ? "…" : "Enregistrer"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{
                            fontSize: 12,
                            color: "#6D7175",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Annuler
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              if (confirmDeleteId === entry.id) {
                return (
                  <tr key={entry.id} style={{ background: "#FEF2F2" }}>
                    <td colSpan={3} style={{ ...cellStyle, color: "#DC2626", fontWeight: 500 }}>
                      Supprimer cette entrée ?
                    </td>
                    <td style={cellStyle}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleConfirmDelete(entry.id)}
                          disabled={deleting}
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: "white",
                            background: deleting ? "#9CA3AF" : "#DC2626",
                            border: "none",
                            borderRadius: "0.25rem",
                            padding: "4px 10px",
                            cursor: deleting ? "not-allowed" : "pointer",
                          }}
                        >
                          {deleting ? "…" : "Confirmer"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          style={{
                            fontSize: 12,
                            color: "#6D7175",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Annuler
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={entry.id} style={{ background: "white" }}>
                  <td style={cellStyle}>
                    {formatDate(entry.period_start)} – {formatDate(entry.period_end)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                    {Number(entry.amount).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TND
                  </td>
                  <td style={{ ...cellStyle, color: "#6D7175" }}>{entry.note ?? "—"}</td>
                  <td style={cellStyle}>
                    <div style={{ display: "flex", gap: 12 }}>
                      <button
                        onClick={() => startEdit(entry)}
                        style={{
                          fontSize: 13,
                          color: "#1A1A1A",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                      >
                        Modifier
                      </button>
                      <button
                        onClick={() => { setConfirmDeleteId(entry.id); setEditingId(null); }}
                        style={{
                          fontSize: 13,
                          color: "#DC2626",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* Inline add form row */}
            {showAddForm && (
              <tr style={{ background: "#F9FAFB" }}>
                <td style={cellStyle}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="date"
                      value={addForm.periodStart}
                      onChange={(e) => setAddForm((f) => ({ ...f, periodStart: e.target.value }))}
                      style={{ ...inputStyle, fontSize: 12 }}
                    />
                    <span style={{ fontSize: 12, color: "#6D7175" }}>–</span>
                    <input
                      type="date"
                      value={addForm.periodEnd}
                      onChange={(e) => setAddForm((f) => ({ ...f, periodEnd: e.target.value }))}
                      style={{ ...inputStyle, fontSize: 12 }}
                    />
                  </div>
                </td>
                <td style={{ ...cellStyle, textAlign: "end" }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={addForm.amount}
                    onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00"
                    style={{ ...inputStyle, width: 90, textAlign: "end", fontSize: 12 }}
                  />
                </td>
                <td style={cellStyle}>
                  <input
                    type="text"
                    value={addForm.note}
                    onChange={(e) => setAddForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder="Optionnel"
                    style={{ ...inputStyle, fontSize: 12, width: "100%" }}
                  />
                </td>
                <td style={cellStyle}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={handleAdd}
                      disabled={addForm.submitting || !addForm.amount}
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "white",
                        background: addForm.submitting || !addForm.amount ? "#9CA3AF" : "#1A1A1A",
                        border: "none",
                        borderRadius: "0.25rem",
                        padding: "4px 10px",
                        cursor: addForm.submitting || !addForm.amount ? "not-allowed" : "pointer",
                      }}
                    >
                      {addForm.submitting ? "…" : "Enregistrer"}
                    </button>
                    <button
                      onClick={() => setShowAddForm(false)}
                      style={{
                        fontSize: 12,
                        color: "#6D7175",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Ajouter button */}
      {!showAddForm && (
        <div style={{ padding: "12px 16px" }}>
          <button
            onClick={() => {
              setShowAddForm(true);
              setAddForm({
                periodStart: period.from_date,
                periodEnd: period.to_date,
                amount: "",
                note: "",
                submitting: false,
              });
            }}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "#1A1A1A",
              background: "none",
              border: "1px solid #D1D5DB",
              borderRadius: "0.25rem",
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            + Ajouter
          </button>
        </div>
      )}
    </div>
  );
}
