import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { toast } from "react-toastify";
import {
  fetchAdminBulkOrders,
  submitAdminBulkDecision,
  sendBulkOrderToVendor,
} from "../api";

const initialCreateState = {
  shopName: "",
  email: "",
  username: "",
  password: ""
};

function AdminControl({
  adminSession,
  onAdminLogin,
  onAdminLogout,
  onCreateVendor,
  onUpdateVendor,
  vendors
}) {
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [createForm, setCreateForm] = useState(initialCreateState);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [updateForm, setUpdateForm] = useState({ username: "", password: "" });
  const [bulkOrders, setBulkOrders] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("submitted_admin");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const [selectedBulkId, setSelectedBulkId] = useState(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [sendVendorShopId, setSendVendorShopId] = useState("");

  const sortedVendors = useMemo(() => {
    return [...vendors].sort((a, b) => a.shopName.localeCompare(b.shopName));
  }, [vendors]);

  const loadBulkOrders = async (session, status) => {
    if (!session) return;
    try {
      setBulkLoading(true);
      setBulkError(null);
      const res = await fetchAdminBulkOrders(session, { status });
      if (res?.status === "ok" && Array.isArray(res.orders)) {
        setBulkOrders(res.orders);
        if (res.orders.length > 0 && !res.orders.find((order) => Number(order.id) === Number(selectedBulkId))) {
          setSelectedBulkId(res.orders[0].id);
        }
      } else {
        setBulkOrders([]);
        setBulkError(res?.message || "Failed to load requests");
      }
    } catch (error) {
      console.error("Admin bulk fetch error", error);
      setBulkOrders([]);
      setBulkError("Unable to load bulk order requests");
    } finally {
      setBulkLoading(false);
    }
  };

  useEffect(() => {
    if (adminSession) {
      loadBulkOrders(adminSession, bulkStatus);
    } else {
      setBulkOrders([]);
      setSelectedBulkId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSession, bulkStatus]);

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    if (!loginForm.username || !loginForm.password) return;
    onAdminLogin({ ...loginForm });
    setLoginForm({ username: "", password: "" });
  };

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    if (!createForm.shopName || !createForm.email || !createForm.username || !createForm.password) return;
    onCreateVendor({ ...createForm });
    setCreateForm(initialCreateState);
  };

  const handleUpdateSubmit = (e) => {
    e.preventDefault();
    if (!selectedVendorId) return;
    onUpdateVendor(selectedVendorId, { ...updateForm });
    setUpdateForm({ username: "", password: "" });
    setSelectedVendorId("");
  };

  const handleVendorSelection = (vendorId) => {
    setSelectedVendorId(vendorId);
    const vendor = vendors.find((v) => String(v.id) === String(vendorId));
    if (vendor) {
      setUpdateForm({
        username: vendor.username || "",
        password: vendor.password || ""
      });
    } else {
      setUpdateForm({ username: "", password: "" });
    }
  };

  const handleDecision = async (action) => {
    if (!selectedBulkId) return;
    try {
      setBulkLoading(true);
      const res = await submitAdminBulkDecision(adminSession, selectedBulkId, { action, comment: decisionComment });
      if (res?.status === "ok") {
        toast.success(`Order #${selectedBulkId} ${action.replace(/_/g, " ")}.
`);
        setDecisionComment("");
        await loadBulkOrders(adminSession, bulkStatus);
      } else {
        toast.error(res?.message || "Failed to update order");
      }
    } catch (error) {
      toast.error("Unable to update order");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleSendToVendor = async () => {
    if (!selectedBulkId) return;
    try {
      setBulkLoading(true);
      const payload = sendVendorShopId ? { vendorShopId: sendVendorShopId } : {};
      const res = await sendBulkOrderToVendor(adminSession, selectedBulkId, payload);
      if (res?.status === "ok") {
        toast.success(`Sent order #${selectedBulkId} to vendor`);
        setSendVendorShopId("");
        await loadBulkOrders(adminSession, bulkStatus);
      } else {
        toast.error(res?.message || "Failed to send to vendor");
      }
    } catch (error) {
      toast.error("Unable to send to vendor");
    } finally {
      setBulkLoading(false);
    }
  };

  const selectedBulkOrder = useMemo(() => {
    if (!selectedBulkId) return null;
    return bulkOrders.find((order) => Number(order.id) === Number(selectedBulkId)) || null;
  }, [bulkOrders, selectedBulkId]);

  const adminDecisionHistory = useMemo(() => {
    const decisions = selectedBulkOrder?.adminReview?.decisions;
    if (!Array.isArray(decisions)) return [];
    return decisions.slice(0, 5);
  }, [selectedBulkOrder]);

  const bulkStatusOptions = [
    { value: "submitted_admin", label: "Submitted" },
    { value: "needs_revision", label: "Needs Revision" },
    { value: "approved_admin", label: "Approved" },
    { value: "sent_to_vendor", label: "Sent to Vendor" },
    { value: "pending_vendor", label: "Pending Vendor" },
    { value: "completed", label: "Completed" },
    { value: "admin_rejected", label: "Rejected" },
  ];

  if (!adminSession) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
        <div className="card-header">Admin Login</div>
        <form className="card-body" onSubmit={handleLoginSubmit}>
          <div className="form-group">
            <label>Admin Username</label>
            <input
              type="text"
              value={loginForm.username}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
              placeholder="admin@example.com"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
              placeholder="••••••••"
            />
          </div>
          <button type="submit" className="primary-button" style={{ width: "100%", marginTop: 12 }}>
            Sign In
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-control">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Admin Control Center</h2>
        <span style={{ fontSize: 13, color: "#6c7a89" }}>Signed in as {adminSession.username}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 13, color: "#7f8c8d", marginRight: 8 }}>Filter bulk orders</label>
          <select value={bulkStatus} onChange={(e) => { setBulkStatus(e.target.value); setSelectedBulkId(null); }}>
            {bulkStatusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <button className="secondary-button" onClick={() => loadBulkOrders(adminSession, bulkStatus)} disabled={bulkLoading}>
            Refresh
          </button>
          <button className="link-button" style={{ marginLeft: 12 }} onClick={onAdminLogout}>
            Logout
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">Bulk Order Review Queue</div>
        <div className="card-body" style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px", maxHeight: 300, overflowY: "auto", borderRight: "1px solid #ecf0f1", paddingRight: 12 }}>
            {bulkLoading && <div>Loading requests…</div>}
            {bulkError && <div style={{ color: "#c0392b" }}>{bulkError}</div>}
            {!bulkLoading && !bulkError && bulkOrders.length === 0 && (
              <div style={{ fontSize: 13, color: "#7f8c8d" }}>No bulk orders for this status.</div>
            )}
            {!bulkLoading && !bulkError && bulkOrders.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {bulkOrders.map((order) => (
                  <li
                    key={order.id}
                    onClick={() => setSelectedBulkId(order.id)}
                    style={{
                      padding: "10px 8px",
                      marginBottom: 6,
                      borderRadius: 8,
                      cursor: "pointer",
                      background: Number(order.id) === Number(selectedBulkId) ? "#eaf2ff" : "#f7f9fc",
                      border: "1px solid #dde3f0",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>#{order.id} · {order.eventName || "Untitled"}</div>
                    <div style={{ fontSize: 12, color: "#7f8c8d" }}>
                      {order.organizer?.name || "Organizer"} · {order.status?.replace(/_/g, " ")}
                    </div>
                    <div style={{ fontSize: 12, color: "#95a5a6" }}>{order.location || "Location TBD"}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={{ flex: "2 1 360px" }}>
            {!selectedBulkOrder ? (
              <div style={{ fontSize: 13, color: "#7f8c8d" }}>Select a request to review details.</div>
            ) : (
              <div>
                <h3 style={{ marginTop: 0 }}>Request #{selectedBulkOrder.id}</h3>
                <div style={{ fontSize: 13, color: "#7f8c8d" }}>
                  <strong>Status:</strong> {selectedBulkOrder.status?.replace(/_/g, " ")} · <strong>Admin Review:</strong> {selectedBulkOrder.adminReview?.status || "—"}
                </div>
                <div style={{ marginTop: 12 }}>
                  <strong>Event:</strong> {selectedBulkOrder.eventName || "Untitled"}
                  {selectedBulkOrder.eventDate && (
                    <span> · {new Date(selectedBulkOrder.eventDate).toLocaleDateString()}</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "#7f8c8d" }}>
                  <div>Organizer: {selectedBulkOrder.organizer?.name || "—"}</div>
                  <div>Location: {selectedBulkOrder.location || "—"}</div>
                  <div>Headcount: {selectedBulkOrder.expectedHeadcount || "—"}</div>
                </div>
                <div style={{ marginTop: 16 }}>
                  <h4>Admin Actions</h4>
                  <textarea
                    value={decisionComment}
                    onChange={(e) => setDecisionComment(e.target.value)}
                    placeholder="Optional comment (shared with organizer)"
                    rows={3}
                    style={{ width: "100%", marginBottom: 12 }}
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="secondary-button" onClick={() => handleDecision("approve")} disabled={bulkLoading}>
                      Approve
                    </button>
                    <button className="secondary-button" onClick={() => handleDecision("request_changes")} disabled={bulkLoading}>
                      Request Changes
                    </button>
                    <button className="secondary-button" onClick={() => handleDecision("reject")} style={{ background: "#e74c3c", color: "#fff" }} disabled={bulkLoading}>
                      Reject
                    </button>
                  </div>
                  <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      placeholder="Vendor shop ID (optional)"
                      value={sendVendorShopId}
                      onChange={(e) => setSendVendorShopId(e.target.value)}
                    />
                    <button className="primary-button" onClick={handleSendToVendor} disabled={bulkLoading || !["approved_admin", "sent_to_vendor", "pending_vendor"].includes(selectedBulkOrder.status)}>
                      Send to Vendor
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 20 }}>
                  <h4>Admin Decision History</h4>
                  {adminDecisionHistory.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#7f8c8d" }}>No decisions recorded yet.</div>
                  ) : (
                    <ul style={{ fontSize: 13, color: "#34495e" }}>
                      {adminDecisionHistory.map((entry) => (
                        <li key={entry.id}>
                          <strong>{(entry.action || '').replace(/_/g, ' ')}</strong> · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}
                          {entry.comment ? ` – ${entry.comment}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid" style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div className="card">
          <div className="card-header">Create New Vendor</div>
          <form className="card-body" onSubmit={handleCreateSubmit}>
            <div className="form-group">
              <label>Shop Name</label>
              <input
                type="text"
                value={createForm.shopName}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, shopName: e.target.value }))}
                placeholder="e.g., Fast Bites"
              />
            </div>
            <div className="form-group">
              <label>Contact Email</label>
              <input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="vendor@example.com"
              />
            </div>
            <div className="form-group">
              <label>Vendor Username</label>
              <input
                type="text"
                value={createForm.username}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
                placeholder="login username"
              />
            </div>
            <div className="form-group">
              <label>Temporary Password</label>
              <input
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <button type="submit" className="primary-button" style={{ width: "100%", marginTop: 12 }}>
              Create Vendor &amp; Send Mail
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-header">Update Vendor Credentials</div>
          <form className="card-body" onSubmit={handleUpdateSubmit}>
            <div className="form-group">
              <label>Select Vendor</label>
              <select value={selectedVendorId} onChange={(e) => handleVendorSelection(e.target.value)}>
                <option value="">-- Choose a vendor --</option>
                {sortedVendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.shopName}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Vendor Username</label>
              <input
                type="text"
                value={updateForm.username}
                onChange={(e) => setUpdateForm((prev) => ({ ...prev, username: e.target.value }))}
                placeholder="login username"
                disabled={!selectedVendorId}
              />
            </div>
            <div className="form-group">
              <label>Reset Password</label>
              <input
                type="password"
                value={updateForm.password}
                onChange={(e) => setUpdateForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="leave blank to keep the same"
                disabled={!selectedVendorId}
              />
            </div>
            <button type="submit" className="secondary-button" style={{ width: "100%", marginTop: 12 }} disabled={!selectedVendorId}>
              Update Credentials &amp; Notify
            </button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">Managed Vendors</div>
        <div className="card-body" style={{ maxHeight: 220, overflowY: "auto" }}>
          {sortedVendors.length === 0 ? (
            <p style={{ color: "#7f8c8d", fontSize: 14 }}>No vendors found yet. Create a vendor using the form above.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sortedVendors.map((vendor) => (
                <li key={vendor.id} style={{ padding: "8px 0", borderBottom: "1px solid #ecf0f1" }}>
                  <div style={{ fontWeight: 600 }}>{vendor.shopName}</div>
                  <div style={{ fontSize: 12, color: "#7f8c8d" }}>{vendor.email}</div>
                  <div style={{ fontSize: 12, color: "#7f8c8d" }}>Username: {vendor.username || "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

AdminControl.propTypes = {
  adminSession: PropTypes.shape({
    username: PropTypes.string
  }),
  onAdminLogin: PropTypes.func.isRequired,
  onAdminLogout: PropTypes.func.isRequired,
  onCreateVendor: PropTypes.func.isRequired,
  onUpdateVendor: PropTypes.func.isRequired,
  vendors: PropTypes.arrayOf(PropTypes.object)
};

AdminControl.defaultProps = {
  adminSession: null,
  onAdminLogout: () => {},
  vendors: []
};

export default AdminControl;
