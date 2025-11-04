import React, { useCallback, useState } from "react";
import PropTypes from "prop-types";
import { uploadHistoricAnalytics } from "../api";

const ACCEPTED_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const tier = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** tier).toFixed(tier === 0 ? 0 : 1)} ${units[tier]}`;
};

const VendorDataUpload = ({ token }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const resetFeedback = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const validateFile = useCallback((candidate) => {
    if (!candidate) return "Please select a file";
    const typeOk = ACCEPTED_TYPES.includes(candidate.type) || candidate.name.endsWith(".csv");
    if (!typeOk) {
      return "Unsupported file type. Provide CSV or Excel export.";
    }
    if (candidate.size > 5 * 1024 * 1024) {
      return "File too large. Use a file smaller than 5 MB.";
    }
    return null;
  }, []);

  const handleFileChange = useCallback((event) => {
    const candidate = event?.target?.files?.[0];
    const issue = validateFile(candidate);
    if (issue) {
      setError(issue);
      setFile(null);
      return;
    }
    setFile(candidate);
    resetFeedback();
  }, [resetFeedback, validateFile]);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const candidate = event.dataTransfer.files?.[0];
    const issue = validateFile(candidate);
    if (issue) {
      setError(issue);
      setFile(null);
      return;
    }
    setFile(candidate);
    resetFeedback();
  }, [resetFeedback, validateFile]);

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) {
      setError("Choose a file before uploading.");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const response = await uploadHistoricAnalytics(token, file);
      setResult(response);
    } catch (err) {
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [file, token]);

  const issueCount = () => {
    if (!result?.errors) return 0;
    return Array.isArray(result.errors) ? result.errors.length : 0;
  };

  const renderSummary = () => {
    if (!result) return null;
    return (
      <div className="vendor-upload-summary">
        <h4>Import Summary</h4>
        <ul>
          <li><strong>Total Rows:</strong> {result.totalRows ?? 0}</li>
          <li><strong>Orders Emitted:</strong> {result.ordersEmitted ?? 0}</li>
          <li><strong>Inventory Adjustments:</strong> {result.inventoryEmitted ?? 0}</li>
          <li><strong>Errors:</strong> {issueCount()}</li>
        </ul>
        {issueCount() > 0 && (
          <details>
            <summary>Show error details</summary>
            <ul>
              {result.errors.map((entry, index) => (
                <li key={index}>{`Row ${entry.index + 1}: ${entry.reason}`}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  };

  return (
    <div className="payment-card vendor-upload-card">
      <div className="vendor-upload-header">
        <div>
          <h2>Historic Sales Upload</h2>
          <p>Import past orders to enrich forecasting and procurement planning. CSV/XLSX exports from your POS are supported.</p>
        </div>
      </div>

      <div
        className="vendor-upload-dropzone"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        role="presentation"
      >
        <input
          id="vendor-upload-input"
          type="file"
          accept=".csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleFileChange}
        />
        <label htmlFor="vendor-upload-input">
          <span className="vendor-upload-icon">📁</span>
          <span className="vendor-upload-cta">
            {file ? file.name : "Drag & drop a file or browse"}
          </span>
          <span className="vendor-upload-hint">Accepted: CSV or Excel • Max 5 MB</span>
          {file && <span className="vendor-upload-meta">{formatBytes(file.size)}</span>}
        </label>
      </div>

      <div className="vendor-upload-actions">
        <button type="button" onClick={handleUpload} disabled={uploading}>
          {uploading ? "Uploading…" : "Upload Historic Data"}
        </button>
        <button type="button" className="secondary" onClick={() => { setFile(null); resetFeedback(); }} disabled={uploading && !file}>
          Clear
        </button>
      </div>

      <div className="vendor-upload-notes">
        <h4>Formatting tips</h4>
        <ul>
          <li>Include columns: <code>shopId</code>, <code>totalAmount</code>, <code>timestamp</code>.</li>
          <li>Optional: <code>orderId</code>, <code>items</code> (JSON or "name|name"), <code>paymentMethod</code>, <code>inventoryDelta</code>.</li>
          <li>Ensure timestamps use ISO format or DD/MM/YYYY HH:mm.</li>
        </ul>
      </div>

      {error && <div className="vendor-upload-error">{error}</div>}
      {renderSummary()}
    </div>
  );
};

VendorDataUpload.propTypes = {
  token: PropTypes.string.isRequired,
};

export default VendorDataUpload;
