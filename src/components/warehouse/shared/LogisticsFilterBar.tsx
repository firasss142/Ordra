import type { ReactNode } from "react";

interface Props {
  searchSlot?: ReactNode;
  filtersSlot?: ReactNode;
  actionsSlot?: ReactNode;
}

export function LogisticsFilterBar({ searchSlot, filtersSlot, actionsSlot }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "10px 12px",
        marginBlockEnd: 16,
      }}
    >
      {searchSlot ? (
        <div style={{ flex: 1, minWidth: 200 }}>{searchSlot}</div>
      ) : null}
      {filtersSlot ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{filtersSlot}</div>
      ) : null}
      {actionsSlot ? (
        <div style={{ marginInlineStart: "auto" }}>{actionsSlot}</div>
      ) : null}
    </div>
  );
}
