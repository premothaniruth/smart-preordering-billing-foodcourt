import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { fetchAdminEmployeeConcerns, updateAdminEmployeeConcern } from "../api";
import { toast } from "react-toastify";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const categoryLabel = (value) => {
  switch (value) {
    case "cleanliness":
      return "Cleanliness";
    case "food_quality":
      return "Food / Taste";
    case "vendor_service":
      return "Vendor Service";
    case "billing_issue":
      return "Billing";
    default:
      return "Other";
  }
};

const statusBadgeClass = (status) => {
  switch (status) {
    case "resolved":
      return "badge badge-success";
    case "in_progress":
      return "badge badge-warning";
    default:
      return "badge badge-secondary";
  }
};

const formatDateTime = (value) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
};

const AdminEmployeeConcerns = ({ adminSession }) => {
  const [loading, setLoading] = useState(false);
  const [concerns, setConcerns] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [selectedId, setSelectedId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("pending");
  const [updating, setUpdating] = useState(false);

  const loadConcerns = useCallback(async () => {
    if (!adminSession) return;
    setLoading(true);
    try {
      const list = await fetchAdminEmployeeConcerns(adminSession);
      if (Array.isArray(list)) {
        list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        setConcerns(list);
      } else {
        toast.error(list?.message || "Failed to load employee concerns");
      }
    } catch (error) {
      console.error("Failed to load employee concerns", error);
      toast.error(error?.message || "Failed to load employee concerns");
    } finally {
      setLoading(false);
    }
  }, [adminSession]);

  useEffect(() => {
    if (adminSession) {
      loadConcerns();
    }
  }, [adminSession, loadConcerns]);

  const filteredConcerns = useMemo(() => {
    if (filter === "all") return concerns;
    return concerns.filter((item) => (item.status || "pending") === filter);
  }, [concerns, filter]);

  const selectedConcern = useMemo(
    () => concerns.find((item) => item.id === selectedId) || null,
    [selectedId, concerns]
  );

  const employeeLabel = (item) => {
    if (!item) return "Employee";
    const username = String(item.username || "").trim();
    if (username) return username;
    const email = String(item.email || "").trim();
    if (email) return email;
    const mobile = String(item.mobile || "").trim();
    if (mobile) return mobile;
    return `Employee #${item.employeeId}`;
  };

  const handleSelect = (concern) => {
    setSelectedId(concern.id);
    setNoteDraft(concern.adminNote || "");
    setStatusDraft(concern.status || "pending");
  };

  const handleUpdate = async () => {
    if (!selectedId) return;
    setUpdating(true);
    try {
      const response = await updateAdminEmployeeConcern(
        selectedId,
        { status: statusDraft, adminNote: noteDraft },
        adminSession
      );
      if (response?.status === "success") {
        toast.success("Concern updated");
        setSelectedId(null);
        setNoteDraft("");
        setStatusDraft("pending");
        loadConcerns();
      } else {
        toast.error(response?.message || "Failed to update concern");
      }
    } catch (error) {
      console.error("Failed to update concern", error);
      toast.error(error?.message || "Failed to update concern");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Employee Concerns</span>
        <div style={{ display: "flex", gap: 10 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={loadConcerns} disabled={loading} className="secondary-button">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="card-body admin-concern-grid">
        <div className="admin-concern-list">
          {loading && concerns.length === 0 && (
            <p style={{ color: "#7f8c8d" }}>Loading concerns…</p>
          )}
          {!loading && filteredConcerns.length === 0 && (
            <p style={{ color: "#7f8c8d" }}>No concerns found for this status.</p>
          )}
          {filteredConcerns.map((item) => {
            const isActive = item.id === selectedId;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                className={`admin-concern-item ${isActive ? "active" : ""}`}
                onClick={() => handleSelect(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSelect(item);
                }}
              >
                <div className="admin-concern-item-header">
                  <span className="concern-subject">{item.subject}</span>
                  <span className={statusBadgeClass(item.status || "pending")}>
                    {(item.status || "pending").replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>
                <div className="concern-meta">
                  <button
                    type="button"
                    className="link-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelect(item);
                    }}
                    style={{ padding: 0, fontWeight: 600 }}
                  >
                    {employeeLabel(item)}
                  </button>
                  {item.department && <span>{item.department}</span>}
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
                <div className="concern-meta" style={{ color: "#7f8c8d" }}>
                  <span>Category: {categoryLabel(item.category)}</span>
                  {item.location && <span>Location: {item.location}</span>}
                </div>
                <p className="concern-description">{item.description}</p>
              </div>
            );
          })}
        </div>
        <div className="admin-concern-detail">
          {selectedConcern ? (
            <div>
              <button
                type="button"
                className="link-button"
                onClick={() => setSelectedId(null)}
                style={{ marginBottom: 8, padding: 0 }}
              >
                ← Back to concerns list
              </button>
              <h3 style={{ marginTop: 0 }}>{selectedConcern.subject}</h3>
              <p style={{ color: "#7f8c8d", marginTop: 4 }}>
                {employeeLabel(selectedConcern)}
                {selectedConcern.department ? ` • ${selectedConcern.department}` : ""}
                {selectedConcern.location ? ` • ${selectedConcern.location}` : ""}
              </p>
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>{selectedConcern.description}</p>
              <div className="form-group">
                <label>Status</label>
                <select value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)} disabled={updating}>
                  {STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Admin Note</label>
                <textarea
                  rows={4}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add resolution notes for the employee"
                  disabled={updating}
                />
              </div>
              <div className="detail-actions">
                <button type="button" className="secondary-button" onClick={() => setSelectedId(null)} disabled={updating}>
                  Clear Selection
                </button>
                <button type="button" className="primary-button" onClick={handleUpdate} disabled={updating}>
                  {updating ? "Saving…" : "Save Update"}
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>Select an employee concern from the list to review details and respond.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

AdminEmployeeConcerns.propTypes = {
  adminSession: PropTypes.shape({
    username: PropTypes.string.isRequired,
    password: PropTypes.string,
  }),
};

export default AdminEmployeeConcerns;
