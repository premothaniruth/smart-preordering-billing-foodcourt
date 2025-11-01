import React, { useState, useMemo } from "react";
import PropTypes from "prop-types";

const initialCreateState = {
  shopName: "",
  email: "",
  username: "",
  password: ""
};

function AdminControl({
  adminSession,
  onAdminLogin,
  onCreateVendor,
  onUpdateVendor,
  vendors
}) {
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [createForm, setCreateForm] = useState(initialCreateState);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [updateForm, setUpdateForm] = useState({ username: "", password: "" });

  const sortedVendors = useMemo(() => {
    return [...vendors].sort((a, b) => a.shopName.localeCompare(b.shopName));
  }, [vendors]);

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
  onCreateVendor: PropTypes.func.isRequired,
  onUpdateVendor: PropTypes.func.isRequired,
  vendors: PropTypes.arrayOf(PropTypes.object)
};

AdminControl.defaultProps = {
  adminSession: null,
  vendors: []
};

export default AdminControl;
