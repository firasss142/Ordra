"use client";

import { useState } from "react";
import useSWR from "swr";

interface DexpressState {
  id: number;
  name: string;
}

interface DexpressPlace {
  id: number;
  name: string;
}

interface DexpressLocationPickerProps {
  onSelect: (stateId: number, placeId?: number) => void;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to fetch");
    return r.json();
  });

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: "0.25rem",
  outline: "none",
  boxSizing: "border-box",
  marginBottom: 6,
};

const listContainerStyle: React.CSSProperties = {
  maxHeight: 160,
  overflowY: "auto",
  border: "1px solid #E5E7EB",
  borderRadius: "0.25rem",
};

const rowBase: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer",
  color: "#1A1A1A",
  borderBottom: "1px solid #F3F4F6",
};

const rowSelected: React.CSSProperties = {
  ...rowBase,
  border: "2px solid #1A1A1A",
  borderBottom: "2px solid #1A1A1A",
  backgroundColor: "#F9FAFB",
  fontWeight: 500,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "#6B7280",
  marginBottom: 6,
  display: "block",
};

export function DexpressLocationPicker({ onSelect }: DexpressLocationPickerProps) {
  const [stateQuery, setStateQuery] = useState("");
  const [selectedStateId, setSelectedStateId] = useState<number | null>(null);
  const [selectedStateName, setSelectedStateName] = useState<string>("");

  const [placeQuery, setPlaceQuery] = useState("");
  const [selectedPlaceId, setSelectedPlaceId] = useState<number | undefined>(undefined);

  const { data: statesData, isLoading: statesLoading } = useSWR(
    "/api/dexpress/states",
    fetcher,
    { revalidateOnFocus: false }
  );

  const { data: placesData, isLoading: placesLoading } = useSWR(
    selectedStateId != null ? `/api/dexpress/places/${selectedStateId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const allStates: DexpressState[] = statesData?.states ?? [];
  const allPlaces: DexpressPlace[] = placesData?.places ?? [];

  const filteredStates = stateQuery
    ? allStates.filter((s) =>
        s.name.toLowerCase().includes(stateQuery.toLowerCase())
      )
    : allStates;

  const filteredPlaces = placeQuery
    ? allPlaces.filter((p) =>
        p.name.toLowerCase().includes(placeQuery.toLowerCase())
      )
    : allPlaces;

  function handleStateSelect(state: DexpressState) {
    setSelectedStateId(state.id);
    setSelectedStateName(state.name);
    setSelectedPlaceId(undefined);
    setPlaceQuery("");
    onSelect(state.id, undefined);
  }

  function handlePlaceSelect(placeId: number | undefined) {
    setSelectedPlaceId(placeId);
    if (selectedStateId != null) {
      onSelect(selectedStateId, placeId);
    }
  }

  return (
    <div>
      {/* Step 1 — State picker */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Rechercher une wilaya…</label>
        <input
          type="text"
          placeholder="Rechercher une wilaya…"
          value={stateQuery}
          onChange={(e) => setStateQuery(e.target.value)}
          style={searchInputStyle}
        />
        {statesLoading ? (
          <div style={{ fontSize: 13, color: "#6B7280", padding: "6px 0" }}>
            Chargement…
          </div>
        ) : (
          <div style={listContainerStyle}>
            {filteredStates.map((state) => (
              <div
                key={state.id}
                style={selectedStateId === state.id ? rowSelected : rowBase}
                onClick={() => handleStateSelect(state)}
              >
                {state.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Step 2 — Place picker (optional, loads after state selected) */}
      {selectedStateId != null && (
        <div>
          <label style={labelStyle}>
            Sélectionnez une zone (optionnel) — {selectedStateName}
          </label>
          <input
            type="text"
            placeholder="Rechercher une zone…"
            value={placeQuery}
            onChange={(e) => setPlaceQuery(e.target.value)}
            style={searchInputStyle}
          />
          {placesLoading ? (
            <div style={{ fontSize: 13, color: "#6B7280", padding: "6px 0" }}>
              Chargement des zones…
            </div>
          ) : (
            <div style={listContainerStyle}>
              {/* "No zone" option */}
              <div
                style={selectedPlaceId === undefined ? rowSelected : rowBase}
                onClick={() => handlePlaceSelect(undefined)}
              >
                Aucune zone
              </div>
              {filteredPlaces.map((place) => (
                <div
                  key={place.id}
                  style={selectedPlaceId === place.id ? rowSelected : rowBase}
                  onClick={() => handlePlaceSelect(place.id)}
                >
                  {place.name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
