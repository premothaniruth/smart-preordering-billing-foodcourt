import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const PRINTER_BRANDS = [
  { value: "epson_tm_t88", label: "Epson TM-T88" },
  { value: "star_tsp100", label: "Star Micronics TSP100" },
  { value: "hp_laserjet", label: "HP LaserJet" },
  { value: "canon_pixma", label: "Canon Pixma" },
  { value: "dymo_labelwriter", label: "Dymo LabelWriter" },
];

const PAGE_TYPES = [
  { value: "receipt_80mm", label: "Thermal Receipt (80mm)" },
  { value: "receipt_58mm", label: "Thermal Receipt (58mm)" },
  { value: "a4", label: "A4 (210 × 297 mm)" },
  { value: "a5", label: "A5 (148 × 210 mm)" },
  { value: "custom", label: "Custom" },
];

const COLOR_MODES = [
  { value: "mono", label: "Monochrome" },
  { value: "grayscale", label: "Grayscale" },
  { value: "color", label: "Full Color" },
];

const DUPLEX_MODES = [
  { value: "off", label: "Single-sided" },
  { value: "manual", label: "Manual Duplex" },
  { value: "auto", label: "Auto Duplex" },
];

const DEFAULT_CONFIG = {
  brand: "epson_tm_t88",
  connection: "usb",
  pageType: "receipt_80mm",
  colorMode: "mono",
  copies: 1,
  duplex: "off",
  density: 70,
  autoCut: true,
  includeLogo: true,
  headerNote: "Thank you for visiting Infy Bhojans!",
};

const inputRowStyle = {
  display: "grid",
  gap: 12,
  marginBottom: 16,
};

const columnStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle = {
  fontSize: 13,
  fontWeight: 600,
  color: "#2c3e50",
};

const helperStyle = {
  fontSize: 12,
  color: "#7f8c8d",
};

function PrinterSetupConfig({ visible, onDismiss, onSave, initialConfig, mode = "modal" }) {
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_CONFIG, ...(initialConfig || {}) }));

  useEffect(() => {
    if (visible) {
      setDraft({ ...DEFAULT_CONFIG, ...(initialConfig || {}) });
    }
  }, [visible, initialConfig]);

  const connectionOptions = useMemo(
    () => [
      { value: "usb", label: "USB" },
      { value: "network", label: "Ethernet / LAN" },
      { value: "wifi", label: "Wi-Fi" },
      { value: "bluetooth", label: "Bluetooth" },
    ],
    []
  );

  const portalTarget = typeof document !== "undefined" ? document.body : null;
  if (!visible) return null;

  const handleChange = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleToggle = (key) => {
    setDraft((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    if (typeof onSave === "function") {
      onSave({ ...draft });
    }
  };

  const panelStyle = mode === "modal"
    ? {
        width: "min(820px, 94vw)",
        maxHeight: "90vh",
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 28px 60px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
      }
    : {
        width: "100%",
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 18px 30px rgba(31,41,55,0.08)",
        border: "1px solid #dce3eb",
        display: "flex",
        flexDirection: "column",
      };

  const panel = (
    <div style={panelStyle}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid #eef2f6" }}>
        <h2 id="printer-setup-heading" style={{ margin: 0 }}>Printer Setup</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#7f8c8d" }}>
          Select your printer brand, paper type, colour preferences, and default print behaviours.
        </p>
      </div>

      <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
        <section style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "#34495e" }}>Device</h3>
          <div style={{ ...inputRowStyle, gridTemplateColumns: "1fr 1fr" }}>
            <div style={columnStyle}>
              <label style={labelStyle} htmlFor="printer-brand">Printer Brand</label>
              <select
                id="printer-brand"
                value={draft.brand}
                onChange={(e) => handleChange("brand", e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #dce3eb" }}
              >
                {PRINTER_BRANDS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span style={helperStyle}>Demo brands only – choose the printer closest to your hardware.</span>
            </div>

            <div style={columnStyle}>
              <label style={labelStyle} htmlFor="printer-connection">Connection Type</label>
              <select
                id="printer-connection"
                value={draft.connection}
                onChange={(e) => handleChange("connection", e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #dce3eb" }}
              >
                {connectionOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span style={helperStyle}>Ensure the printer bridge utility is running for direct USB/LAN printing.</span>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "#34495e" }}>Print Profile</h3>
          <div style={{ ...inputRowStyle, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div style={columnStyle}>
              <label style={labelStyle} htmlFor="page-type">Paper / Page Type</label>
              <select
                id="page-type"
                value={draft.pageType}
                onChange={(e) => handleChange("pageType", e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #dce3eb" }}
              >
                {PAGE_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div style={columnStyle}>
              <label style={labelStyle} htmlFor="color-mode">Colour Mode</label>
              <select
                id="color-mode"
                value={draft.colorMode}
                onChange={(e) => handleChange("colorMode", e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #dce3eb" }}
              >
                {COLOR_MODES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div style={columnStyle}>
              <label style={labelStyle} htmlFor="duplex-mode">Duplex</label>
              <select
                id="duplex-mode"
                value={draft.duplex}
                onChange={(e) => handleChange("duplex", e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #dce3eb" }}
              >
                {DUPLEX_MODES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div style={columnStyle}>
              <label style={labelStyle} htmlFor="printer-copies">Copies</label>
              <input
                id="printer-copies"
                type="number"
                min={1}
                max={10}
                value={draft.copies}
                onChange={(e) => handleChange("copies", Math.max(1, Number(e.target.value) || 1))}
                style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #dce3eb" }}
              />
            </div>
          </div>

          <div style={{ ...inputRowStyle, gridTemplateColumns: "1fr 1fr" }}>
            <div style={columnStyle}>
              <label style={labelStyle} htmlFor="print-density">Print Density ({draft.density}%)</label>
              <input
                id="print-density"
                type="range"
                min={40}
                max={100}
                value={draft.density}
                onChange={(e) => handleChange("density", Number(e.target.value))}
              />
              <span style={helperStyle}>Adjust for darker or lighter receipts. Higher values consume more ink/thermal energy.</span>
            </div>

            <div style={{ display: "flex", gap: 18 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={draft.autoCut}
                  onChange={() => handleToggle("autoCut")}
                />
                Auto cut after each print
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={draft.includeLogo}
                  onChange={() => handleToggle("includeLogo")}
                />
                Include outlet logo
              </label>
            </div>
          </div>
        </section>

        <section>
          <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "#34495e" }}>Header & Footer</h3>
          <div style={{ ...inputRowStyle, gridTemplateColumns: "1fr" }}>
            <div style={columnStyle}>
              <label style={labelStyle} htmlFor="header-note">Header Note</label>
              <textarea
                id="header-note"
                value={draft.headerNote}
                onChange={(e) => handleChange("headerNote", e.target.value)}
                rows={3}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid #dce3eb",
                  resize: "vertical",
                }}
              />
              <span style={helperStyle}>Displayed at the top of every receipt. Keep it short for 58mm/80mm paper widths.</span>
            </div>
          </div>

          <div
            style={{
              marginTop: 20,
              padding: "16px 18px",
              background: "#f9fbfd",
              border: "1px solid #dce3eb",
              borderRadius: 8,
              fontSize: 12,
              color: "#5f6c7b",
            }}
          >
            <strong>Demo Preview:</strong>
            <div style={{ marginTop: 8, lineHeight: 1.4 }}>
              {draft.includeLogo && <div style={{ fontWeight: 700 }}>[INFY BHOJANS LOGO]</div>}
              <div>{draft.headerNote || "Thank you for dining with us!"}</div>
              <div style={{ marginTop: 6 }}>
                <span>Paper: {PAGE_TYPES.find((p) => p.value === draft.pageType)?.label || draft.pageType}</span> · {draft.copies} copy/min order · {COLOR_MODES.find((mode) => mode.value === draft.colorMode)?.label || draft.colorMode}
              </div>
              <div>Density: {draft.density}% · Auto Cut: {draft.autoCut ? "Enabled" : "Disabled"}</div>
            </div>
          </div>
        </section>
      </div>

      <div style={{ padding: "16px 24px", borderTop: "1px solid #eef2f6", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#7f8c8d" }}>
          <span>These settings are stored locally for demo purposes.</span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: "10px 16px",
              borderRadius: 6,
              border: "1px solid #d0d7de",
              background: "#fff",
              color: "#34495e",
              cursor: "pointer",
            }}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "10px 18px",
              borderRadius: 6,
              border: "none",
              background: "#1abc9c",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );

  if (mode === "inline") {
    return (
      <div style={{ margin: "12px 0 24px" }}>
        {panel}
      </div>
    );
  }

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="printer-setup-heading"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 2000,
      }}
    >
      {panel}
    </div>
  );

  return portalTarget ? createPortal(content, portalTarget) : content;
}

export default PrinterSetupConfig;
