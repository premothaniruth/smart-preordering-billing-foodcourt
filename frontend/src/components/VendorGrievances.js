import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { fetchGrievances } from "../api";

/**
 * VendorGrievances
 * Vendor view of customer grievances with auto-refresh and resolve action.
 * @param {{ token:string }} props
 */
const VendorGrievances = ({ token, onClose, isModal }) => {
  const [grievances, setGrievances] = useState([]);

  // auto-refresh grievances periodically
  useEffect(() => {
    loadGrievances();
    const interval = setInterval(loadGrievances, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget && onClose) {
      onClose();
    }
  };

  const loadGrievances = () => {
    fetchGrievances(token).then(setGrievances);
  };

  // resolve by calling endpoint and reloading
  const handleResolve = async (id) => {
    try {
      const res = await fetch(`http://localhost:3001/grievance/resolve/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        loadGrievances();
      }
    } catch (error) {
      console.error("Error resolving grievance:", error);
    }
  };

  const pendingGrievances = grievances.filter(g => g.status === "pending");
  const resolvedGrievances = grievances.filter(g => g.status === "resolved");
  const content = (
    <div className="vendor-grievances-content">
      <div className="modal-header" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Customer Complaints &amp; Grievances</h2>
        {onClose && (
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close" style={{ fontSize: 20 }}>
            ×
          </button>
        )}
      </div>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
        Total: {grievances.length} | Pending: {pendingGrievances.length} | Resolved: {resolvedGrievances.length}
      </p>

      {pendingGrievances.length > 0 && (
        <>
          <h3 style={{ color: "#e74c3c" }}>⚠️ Pending Complaints</h3>
          <div style={{ display: "grid", gap: 15, marginBottom: 30 }}>
            {pendingGrievances.map((g) => (
              <div key={g.id} className="card" style={{ borderLeft: "4px solid #e74c3c" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <strong>Order #{g.billingId}</strong>
                  <span className="badge badge-danger">PENDING</span>
                </div>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <strong>Issue Type:</strong> {g.issueType.replace(/_/g, " ").toUpperCase()}
                </div>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <strong>Description:</strong> {g.description}
                </div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  <strong>Contact Preference:</strong> {g.contactPreference}
                </div>
                <div style={{ fontSize: 11, color: "#999", marginBottom: 12 }}>
                  Submitted: {new Date(g.createdAt).toLocaleString()}
                </div>
                <button 
                  onClick={() => handleResolve(g.id)}
                  style={{ background: "#27ae60" }}
                >
                  Mark as Resolved
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {resolvedGrievances.length > 0 && (
        <>
          <h3>✅ Resolved Complaints</h3>
          <div style={{ display: "grid", gap: 15 }}>
            {resolvedGrievances.map((g) => (
              <div key={g.id} className="card" style={{ borderLeft: "4px solid #27ae60", opacity: 0.7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <strong>Order #{g.billingId}</strong>
                  <span className="badge badge-success">RESOLVED</span>
                </div>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <strong>Issue Type:</strong> {g.issueType.replace(/_/g, " ").toUpperCase()}
                </div>
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  {g.description}
                </div>
                <div style={{ fontSize: 11, color: "#999" }}>
                  Resolved: {new Date(g.resolvedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {grievances.length === 0 && (
        <p className="empty-state">No complaints received yet.</p>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="modal-overlay" onClick={handleOverlayClick}>
        <div className="modal-content" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    );
  }

  return content;
};

VendorGrievances.propTypes = {
  token: PropTypes.string.isRequired,
  onClose: PropTypes.func,
  isModal: PropTypes.bool
};

VendorGrievances.defaultProps = {
  onClose: null,
  isModal: false
};

export default VendorGrievances;