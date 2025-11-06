import React, { useCallback, useMemo, useState } from "react";
import { toast } from "react-toastify";
import PrinterSetupConfig from "./PrinterSetupConfig.jsx";

const STORAGE_KEY = "vendorPrinterConfig";

const loadStoredConfig = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Failed to read printer config", error);
    return {};
  }
};

function PrinterSetupPage({ onBack }) {
  const [storedConfig, setStoredConfig] = useState(() => loadStoredConfig());
  const [resetNonce, setResetNonce] = useState(0);

  const handleDiscard = useCallback(() => {
    toast.info("Changes discarded");
    setResetNonce((value) => value + 1);
  }, []);

  const handleSave = useCallback(
    (nextConfig) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
        setStoredConfig(nextConfig);
        toast.success("Printer configuration saved");
        if (typeof onBack === "function") {
          onBack();
        }
      } catch (error) {
        console.warn("Failed to persist printer config", error);
        toast.error("Could not save printer settings");
      }
    },
    [onBack]
  );

  const currentConfig = useMemo(() => storedConfig || {}, [storedConfig]);

  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: "24px 20px 40px" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 28 }}>Printer Setup</h2>
        <p style={{ margin: 0, color: "#5f6c7b", lineHeight: 1.6 }}>
          Configure how your tickets are printed at the counter. Settings are stored locally in the browser.
        </p>
      </div>

      <PrinterSetupConfig
        key={resetNonce}
        visible
        mode="inline"
        initialConfig={currentConfig}
        onSave={handleSave}
        onDismiss={handleDiscard}
      />

      <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => {
            if (typeof onBack === "function") {
              onBack();
            }
          }}
          style={{
            padding: "10px 18px",
            borderRadius: 6,
            border: "1px solid #d0d7de",
            background: "#fff",
            color: "#34495e",
            cursor: "pointer",
          }}
        >
          Return to Dashboard
        </button>
      </div>
    </div>
  );
}

export default PrinterSetupPage;
