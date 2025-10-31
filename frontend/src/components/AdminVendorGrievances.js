import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { fetchAdminVendorGrievances, updateAdminVendorGrievance } from "../api";
import { toast } from "react-toastify";

const statusOptions = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" }
];

const AdminVendorGrievances = ({ adminSession }) => {
  const [loading, setLoading] = useState(false);
  const [grievances, setGrievances] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [selectedId, setSelectedId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("pending");
  const [updating, setUpdating] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminVendorGrievances(adminSession);
      if (Array.isArray(data)) {
        data.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        setGrievances(data);
      } else {
        toast.error(data?.message || "Failed to load vendor concerns");
      }
    } catch (error) {
      toast.error(error?.message || "Failed to load vendor concerns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!adminSession) return;
    loadData();
  }, [adminSession]);

  const filteredConcerns = useMemo(() => {
    if (filter === "all") return grievances;
    return grievances.filter((g) => g.status === filter);
  }, [filter, grievances]);

  const handleSelect = (concern) => {
    setSelectedId(concern.id);
    setNoteDraft(concern.adminNote || "");
    setStatusDraft(concern.status || "pending");
  };

  const handleUpdate = async () => {
    if (!selectedId) return;
    setUpdating(true);
    try {
      const response = await updateAdminVendorGrievance(
        selectedId,
        { status: statusDraft, adminNote: noteDraft },
        adminSession
      );
      if (response?.status === "success") {
        toast.success("Grievance updated");
        setSelectedId(null);
        setNoteDraft("");
        setStatusDraft("pending");
        loadData();
      } else {
        toast.error(response?.message || "Update failed");
      }
    } catch (error) {
      toast.error(error?.message || "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  const selectedConcern = useMemo(() => {
    return grievances.find((g) => g.id === selectedId) || null;
  }, [selectedId, grievances]);

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Vendor Concerns</span>
        <div style={{ display: "flex", gap: 10 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
          <button type="button" onClick={loadData} disabled={loading} className="secondary-button">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div className="card-body admin-concern-grid">
        <div className="admin-concern-list">
          {loading && grievances.length === 0 && (
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
                  <span className={`concern-status badge status-${item.status || "pending"}`}>
                    {(item.status || "pending").replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>
                <div className="concern-meta">
                  <span>Vendor #{item.vendorId}</span>
                  <span>Shop #{item.shopId}</span>
                  <span>{new Date(item.createdAt).toLocaleString("en-IN", { dateStyle: "medium" })}</span>
                </div>
                <p className="concern-description">{item.description}</p>
              </div>
            );
          })}
        </div>
        <div className="admin-concern-detail">
          {selectedConcern ? (
            <div>
              <h3 style={{ marginTop: 0 }}>{selectedConcern.subject}</h3>
              <p style={{ color: "#7f8c8d", marginTop: 4 }}>
                Vendor #{selectedConcern.vendorId} • Shop #{selectedConcern.shopId}
              </p>
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>{selectedConcern.description}</p>
              <div className="form-group">
                <label>Status</label>
                <select value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)} disabled={updating}>
                  {statusOptions.map((option) => (
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
                  placeholder="Add resolution notes or next steps for the vendor"
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
              <p>Select a concern from the list to review details and update status.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

AdminVendorGrievances.propTypes = {
  adminSession: PropTypes.shape({
    username: PropTypes.string.isRequired,
    password: PropTypes.string.isRequired
  })
};

AdminVendorGrievances.defaultProps = {
  adminSession: null
};

export default AdminVendorGrievances;
