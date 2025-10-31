import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { fetchVendorGrievances } from "../api";
import { toast } from "react-toastify";

const statusPillStyles = {
  pending: { background: "#fff4e6", color: "#d35400", borderColor: "#f39c12" },
  in_progress: { background: "#d6f5ff", color: "#0e6f9f", borderColor: "#0e6f9f" },
  resolved: { background: "#e8f8f5", color: "#117a65", borderColor: "#1abc9c" }
};

const priorityBadgeStyles = {
  low: { background: "#ecf0f1", color: "#2c3e50", borderColor: "#bdc3c7" },
  medium: { background: "#fcefe3", color: "#d35400", borderColor: "#f39c12" },
  high: { background: "#fdecea", color: "#c0392b", borderColor: "#e74c3c" }
};

const formatDate = (value) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
};

const VendorGrievanceList = ({ token, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [grievances, setGrievances] = useState([]);
  const [filter, setFilter] = useState("all");

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchVendorGrievances(token);
      if (Array.isArray(data)) {
        setGrievances(data);
      } else {
        toast.error(data?.message || "Failed to load concerns");
      }
    } catch (error) {
      toast.error(error?.message || "Failed to load concerns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 20000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredList = useMemo(() => {
    if (filter === "all") return grievances;
    return grievances.filter((item) => item.status === filter);
  }, [filter, grievances]);

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content vendor-concern-list" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>My Concerns</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" style={{ fontSize: 20 }}>
            ×
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <p style={{ margin: 0, color: "#6c7a89", fontSize: 14 }}>
            Track progress of your submitted concerns. Auto-refreshes every 20 seconds.
          </p>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <div className="concern-list-scroller">
          {loading && grievances.length === 0 && (
            <p style={{ textAlign: "center", color: "#6c7a89" }}>Loading concerns…</p>
          )}
          {!loading && filteredList.length === 0 && (
            <p style={{ textAlign: "center", color: "#6c7a89" }}>
              No concerns under the selected filter.
            </p>
          )}
          {filteredList.map((item) => {
            const statusStyle = statusPillStyles[item.status] || statusPillStyles.pending;
            const priorityStyle = priorityBadgeStyles[item.priority] || priorityBadgeStyles.medium;
            return (
              <div key={item.id} className="card" style={{ borderLeft: `4px solid ${statusStyle.borderColor}`, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.subject}</div>
                    <div style={{ fontSize: 12, color: "#7f8c8d" }}>
                      #{item.id} • Submitted {formatDate(item.createdAt)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <span className="badge" style={priorityStyle}>
                      Priority: {item.priority?.toUpperCase?.() || "MEDIUM"}
                    </span>
                    <span className="badge" style={statusStyle}>
                      {item.status?.replace(/_/g, " ")?.toUpperCase?.() || "PENDING"}
                    </span>
                  </div>
                </div>
                <p style={{ fontSize: 14, color: "#34495e", marginBottom: 12 }}>{item.description}</p>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#7f8c8d" }}>
                  <span>Last updated {formatDate(item.updatedAt)}</span>
                  {item.adminNote && (
                    <span style={{ fontStyle: "italic" }}>Admin note: {item.adminNote}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button type="button" onClick={loadData} disabled={loading} className="secondary-button">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={onClose} className="primary-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

VendorGrievanceList.propTypes = {
  token: PropTypes.string.isRequired,
  onClose: PropTypes.func
};

VendorGrievanceList.defaultProps = {
  onClose: () => {}
};

export default VendorGrievanceList;
