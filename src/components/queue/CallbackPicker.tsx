"use client";

import { useState, useCallback, useEffect } from "react";

interface CallbackPickerProps {
  defaultValue?: Date;
  onSelect: (dateTime: Date) => void;
}

function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalTimeString(d: Date): string {
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: "0.25rem",
  width: "100%",
  color: "#1A1A1A",
  backgroundColor: "#FFFFFF",
  outline: "none",
  boxSizing: "border-box",
};

const inputFocusStyle: React.CSSProperties = {
  ...inputStyle,
  border: "2px solid #1A1A1A",
};

function FocusableInput(
  props: React.InputHTMLAttributes<HTMLInputElement>
) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={focused ? inputFocusStyle : inputStyle}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

export function CallbackPicker({ defaultValue, onSelect }: CallbackPickerProps) {
  const [dateVal, setDateVal] = useState(
    defaultValue ? toLocalDateString(defaultValue) : ""
  );
  const [timeVal, setTimeVal] = useState(
    defaultValue ? toLocalTimeString(defaultValue) : ""
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  const handleChange = useCallback((newDate: string, newTime: string) => {
    if (newDate && newTime) {
      const combined = new Date(`${newDate}T${newTime}:00`);
      if (!isNaN(combined.getTime())) {
        if (combined <= new Date()) {
          setValidationError("L'heure doit être dans le futur");
        } else {
          setValidationError(null);
          onSelect(combined);
        }
      }
    }
  }, [onSelect]);

  function applyPreset() {
    const d = new Date();
    d.setHours(d.getHours() + 2);
    const newDate = toLocalDateString(d);
    const newTime = toLocalTimeString(d);
    setDateVal(newDate);
    setTimeVal(newTime);
    setValidationError(null);
    onSelect(d);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>
          Programmer un rappel
        </div>
        <button
          type="button"
          onClick={applyPreset}
          style={{
            fontSize: 12,
            padding: "4px 10px",
            border: "1px solid #D1D5DB",
            borderRadius: "0.25rem",
            background: "white",
            color: "#1A1A1A",
            cursor: "pointer",
          }}
        >
          +2h
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#6B7280", marginBottom: 4 }}>
            Date
          </div>
          <FocusableInput
            type="date"
            aria-label="Date du rappel"
            min={today}
            value={dateVal}
            onChange={(e) => {
              setDateVal(e.target.value);
              handleChange(e.target.value, timeVal);
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#6B7280", marginBottom: 4 }}>
            Heure
          </div>
          <FocusableInput
            type="time"
            aria-label="Heure du rappel"
            value={timeVal}
            onChange={(e) => {
              setTimeVal(e.target.value);
              handleChange(dateVal, e.target.value);
            }}
          />
        </div>
      </div>
      {validationError && (
        <div style={{ fontSize: 12, color: "#DC2626", marginTop: 6 }}>
          {validationError}
        </div>
      )}
    </div>
  );
}
