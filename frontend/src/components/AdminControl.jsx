import React, { useEffect, useMemo, useState, useCallback } from "react";
import PropTypes from "prop-types";
import { toast } from "react-toastify";
import {
  fetchAdminBulkOrders,
  sendBulkOrderToVendor,
  submitAdminBulkDecision,
  fetchAdminVendors,
  updateVendor as updateVendorApi,
  createVendor as createVendorApi,
  deleteAdminVendor,
  fetchArchivedVendors,
  restoreArchivedVendor
} from "../api";
import AdminVendorGrievances from "./AdminVendorGrievances";
import AdminEmployeeConcerns from "./AdminEmployeeConcerns";
import AdminEmployeeDirectory from "./AdminEmployeeDirectory";

const initialCreateState = {
  shopName: "",
  email: "",
  username: "",
  password: ""
};

const normalizeBulkStatusFilter = (value) => {
  if (!value || value === "all") return null;
  if (value === "under_review") return "submitted_admin";
  return value;
};

function AdminControl({
  adminSession = null,
  onAdminLogin,
  onAdminLogout = () => {},
  onCreateVendor,
  onUpdateVendor,
  vendors = [],
  onRequestRefresh,
  selectedFoodCourt = 'all',
  onFoodCourtChange = () => {},
  adminFoodCourtOptions = [],
  foodCourts = [],
  foodCourtsLoading = false,
  foodCourtsError = null,
  onCreateFoodCourt,
  onUpdateFoodCourt,
  onRefreshFoodCourts,
}) {
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [createForm, setCreateForm] = useState(initialCreateState);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [updateForm, setUpdateForm] = useState({ username: "", password: "" });
  const [bulkOrders, setBulkOrders] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("all");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [selectedBulkId, setSelectedBulkId] = useState(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [sendVendorShopId, setSendVendorShopId] = useState("");
  const [vendorDirectory, setVendorDirectory] = useState([]);
  const [vendorDirectoryLoading, setVendorDirectoryLoading] = useState(false);
  const [vendorDirectoryError, setVendorDirectoryError] = useState(null);
  const [archivedVendors, setArchivedVendors] = useState([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState(null);
  const [activePanel, setActivePanel] = useState("bulk");

  const sortedVendors = useMemo(() => {
    const source = vendorDirectory.length ? vendorDirectory : vendors;
    return [...source].sort((a, b) => a.shopName.localeCompare(b.shopName));
  }, [vendorDirectory, vendors]);

  useEffect(() => {
    if (!Array.isArray(adminFoodCourtOptions) || adminFoodCourtOptions.length === 0) return;
    const allowed = new Set(adminFoodCourtOptions.map((option) => option.value));
    if (!allowed.has(selectedFoodCourt)) {
      const fallback = adminFoodCourtOptions[0]?.value || 'all';
      onFoodCourtChange(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminFoodCourtOptions]);

  const createCourtOptions = useMemo(() => {
    return adminFoodCourtOptions.filter((option) => option.value !== 'all');
  }, [adminFoodCourtOptions]);

  const handleDeleteVendor = async (vendorId) => {
    if (!adminSession || !vendorId) return;
    const confirmDelete = window.confirm("Are you sure you want to remove this vendor? This will delete associated shop data.");
    if (!confirmDelete) return;
    try {
      const res = await deleteAdminVendor(adminSession, vendorId, selectedFoodCourt);
      if (res?.status === "success") {
        toast.success("Vendor removed");
        if (String(selectedVendorId) === String(vendorId)) {
          setSelectedVendorId("");
          setUpdateForm(initialCreateState);
        }
        await refreshVendorDirectory();
        onRequestRefresh && onRequestRefresh();
      } else {
        toast.error(res?.message || "Failed to remove vendor");
      }
    } catch (error) {
      console.error("Failed to delete vendor", error);
      toast.error("Unable to remove vendor");
    }
  };

  const handleRestoreVendor = async (archiveId) => {
    if (!adminSession || !archiveId) return;
    try {
      const res = await restoreArchivedVendor(adminSession, archiveId, selectedFoodCourt);
      if (res?.status === "success") {
        toast.success("Vendor restored successfully");
        await Promise.all([refreshVendorDirectory(), loadArchivedVendors()]);
        onRequestRefresh && onRequestRefresh();
      } else {
        toast.error(res?.message || "Failed to restore vendor");
      }
    } catch (error) {
      console.error("Failed to restore vendor", error);
      toast.error("Unable to restore vendor");
    }
  };

  const loadBulkOrders = async (session, status) => {
    if (!session) return;
    try {
      setBulkLoading(true);
      setBulkError(null);
      const normalizedStatus = normalizeBulkStatusFilter(status);
      const requestParams = normalizedStatus ? { status: normalizedStatus } : {};
      const res = await fetchAdminBulkOrders(session, requestParams, selectedFoodCourt);
      if (res?.status === "ok" && Array.isArray(res.orders)) {
        const orders = res.orders;
        setBulkOrders(orders);
        if (orders.length > 0) {
          const currentExists = orders.some((order) => Number(order.id) === Number(selectedBulkId));
          if (!currentExists) {
            setSelectedBulkId(orders[0].id);
          }
        } else {
          setSelectedBulkId(null);
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
  }, [adminSession, bulkStatus, selectedFoodCourt]);

  const refreshVendorDirectory = useCallback(async () => {
    if (!adminSession) {
      setVendorDirectory([]);
      setVendorDirectoryError(null);
      return;
    }
    try {
      setVendorDirectoryLoading(true);
      setVendorDirectoryError(null);
      const res = await fetchAdminVendors(adminSession, selectedFoodCourt);
      if (res?.status === "ok" && Array.isArray(res.vendors)) {
        setVendorDirectory(res.vendors);
      } else {
        setVendorDirectory([]);
        setVendorDirectoryError(res?.message || "Failed to load vendor directory");
      }
    } catch (error) {
      console.error("Admin vendor directory error", error);
      setVendorDirectory([]);
      setVendorDirectoryError("Unable to load vendor directory");
    } finally {
      setVendorDirectoryLoading(false);
    }
  }, [adminSession, selectedFoodCourt]);

  const loadArchivedVendors = useCallback(async () => {
    if (!adminSession) {
      setArchivedVendors([]);
      setArchivedError(null);
      return;
    }
    try {
      setArchivedLoading(true);
      setArchivedError(null);
      const res = await fetchArchivedVendors(adminSession, selectedFoodCourt);
      if (res?.status === "ok" && Array.isArray(res.archives)) {
        setArchivedVendors(res.archives);
      } else {
        setArchivedVendors([]);
        setArchivedError(res?.message || "Failed to load archived vendors");
      }
    } catch (error) {
      console.error("Admin archived vendor error", error);
      setArchivedVendors([]);
      setArchivedError("Unable to load archived vendors");
    } finally {
      setArchivedLoading(false);
    }
  }, [adminSession, selectedFoodCourt]);

  useEffect(() => {
    let cancelled = false;
    if (!adminSession) {
      setVendorDirectory([]);
      setVendorDirectoryError(null);
      setVendorDirectoryLoading(false);
      setArchivedVendors([]);
      setArchivedError(null);
      setArchivedLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const loadVendorDirectory = async () => {
      try {
        setVendorDirectoryLoading(true);
        setVendorDirectoryError(null);
        const res = await fetchAdminVendors(adminSession, selectedFoodCourt);
        if (cancelled) return;
        if (res?.status === "ok" && Array.isArray(res.vendors)) {
          setVendorDirectory(res.vendors);
        } else {
          setVendorDirectory([]);
          setVendorDirectoryError(res?.message || "Failed to load vendor directory");
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Admin vendor directory error", error);
        setVendorDirectory([]);
        setVendorDirectoryError("Unable to load vendor directory");
      } finally {
        if (!cancelled) {
          setVendorDirectoryLoading(false);
        }
      }
    };

    loadVendorDirectory();
    loadArchivedVendors();

    return () => {
      cancelled = true;
    };
  }, [adminSession, selectedFoodCourt, refreshVendorDirectory, loadArchivedVendors]);

  useEffect(() => {
    setSelectedVendorId("");
    setUpdateForm({ username: "", password: "" });
    setSendVendorShopId("");
  }, [selectedFoodCourt]);

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    if (!loginForm.username || !loginForm.password) return;
    onAdminLogin({ ...loginForm });
    setLoginForm({ username: "", password: "" });
  };

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    const shopName = String(createForm.shopName || "").trim();
    const username = String(createForm.username || "").trim();
    const password = String(createForm.password || "").trim();
    const email = String(createForm.email || "").trim();

    if (!shopName) {
      toast.error("Shop name is required");
      return;
    }
    if (!username) {
      toast.error("Vendor username is required");
      return;
    }
    if (!password) {
      toast.error("Temporary password is required");
      return;
    }

    onCreateVendor({
      shopName,
      username,
      password,
      email: email || undefined,
      foodCourt: selectedFoodCourt,
    });
    setCreateForm(initialCreateState);
  };

  const handleUpdateSubmit = (e) => {
    e.preventDefault();
    if (!selectedVendorId) return;
    const username = String(updateForm.username || "").trim();
    const password = String(updateForm.password || "").trim();
    if (!username && !password) {
      toast.error("Provide a username or password to update");
      return;
    }
    const payload = {};
    if (username) payload.username = username;
    if (password) payload.password = password;
    onUpdateVendor(selectedVendorId, { ...payload, foodCourt: selectedFoodCourt });
    setUpdateForm({ username: "", password: "" });
    setSelectedVendorId("");
  };

  const handleVendorSelection = (vendorId) => {
    setSelectedVendorId(vendorId);
    const source = vendorDirectory.length ? vendorDirectory : vendors;
    const vendor = source.find((v) => String(v.vendorId ?? v.id) === String(vendorId));
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
      const res = await submitAdminBulkDecision(adminSession, selectedBulkId, { action, comment: decisionComment }, selectedFoodCourt);
      if (res?.status === "ok") {
        toast.success(`Order #${selectedBulkId} ${action.replace(/_/g, " ")}.\n`);
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
      const res = await sendBulkOrderToVendor(adminSession, selectedBulkId, payload, selectedFoodCourt);
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

  const vendorDirectoryByShopId = useMemo(() => {
    const map = new Map();
    vendorDirectory.forEach((vendor) => {
      if (vendor && vendor.shopId != null) {
        map.set(String(vendor.shopId), vendor);
      }
    });
    return map;
  }, [vendorDirectory]);

  const vendorDirectoryOptions = useMemo(() => {
    return vendorDirectory
      .filter((vendor) => vendor && vendor.shopId != null)
      .map((vendor) => ({
        value: String(vendor.shopId),
        label: vendor.shopName || `Shop ${vendor.shopId}`,
        subtitle: vendor.contactEmail || vendor.email || "",
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [vendorDirectory]);

  const selectedVendorDetails = useMemo(() => {
    if (!sendVendorShopId) return null;
    return vendorDirectoryByShopId.get(String(sendVendorShopId)) || null;
  }, [sendVendorShopId, vendorDirectoryByShopId]);

  const assignedVendorDetails = useMemo(() => {
    if (!selectedBulkOrder || selectedBulkOrder.vendorShopId == null) return null;
    return vendorDirectoryByShopId.get(String(selectedBulkOrder.vendorShopId)) || null;
  }, [selectedBulkOrder, vendorDirectoryByShopId]);

  useEffect(() => {
    if (selectedBulkOrder && selectedBulkOrder.vendorShopId != null) {
      setSendVendorShopId(String(selectedBulkOrder.vendorShopId));
    } else {
      setSendVendorShopId("");
    }
  }, [selectedBulkOrder]);

  const previousState = selectedBulkOrder?.adminReview?.previousState || null;
  const previousUpdatedAt = selectedBulkOrder?.adminReview?.previousUpdatedAt || null;
  const previousRevisionDisplay = previousUpdatedAt
    ? new Date(previousUpdatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : null;

  const formatValue = (value) => {
    if (value == null || value === "") return "—";
    if (Array.isArray(value)) {
      if (value.length === 0) return "—";
      return value
        .map((item) => {
          if (item == null) return "—";
          if (typeof item === "string" || typeof item === "number") return String(item);
          try {
            return JSON.stringify(item);
          } catch (error) {
            return String(item);
          }
        })
        .join(", ");
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch (error) {
        return String(value);
      }
    }
    if (value === true) return "Yes";
    if (value === false) return "No";
    return String(value);
  };

  const renderDiffCard = (label, currentValue, previousValue, { multiline = false, formatter } = {}) => {
    const formattedCurrent = formatter ? formatter(currentValue) : formatValue(currentValue);
    const formattedPrevious = formatter ? formatter(previousValue) : formatValue(previousValue);
    const changed = previousState
      ? JSON.stringify(currentValue ?? null) !== JSON.stringify(previousValue ?? null)
      : false;

    return (
      <div
        key={label}
        style={{
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${changed ? "#f5b041" : "#ecf0f1"}`,
          background: changed ? "#fff8e6" : "#f9fbfd",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "#2c3e50", marginBottom: 6 }}>
          {label}
          {changed ? " • updated" : ""}
        </div>
        {multiline ? (
          <pre style={{ fontSize: 13, color: "#2c3e50", margin: 0, whiteSpace: "pre-wrap" }}>{formattedCurrent}</pre>
        ) : (
          <div style={{ fontSize: 13, color: "#2c3e50" }}>{formattedCurrent}</div>
        )}
        {changed && (
          <div style={{ fontSize: 11, color: "#d35400", marginTop: 6 }}>
            Previous:
            {multiline ? (
              <pre style={{ fontSize: 11, color: "#d35400", margin: "4px 0 0 0", whiteSpace: "pre-wrap" }}>{formattedPrevious}</pre>
            ) : (
              <span style={{ marginLeft: 4 }}>{formattedPrevious}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  const formatItemGroups = (groups) => {
    if (!Array.isArray(groups) || groups.length === 0) return "—";
    return groups
      .map((group, index) => {
        if (!group) return `Item ${index + 1}`;
        const parts = [];
        const title = group.name || group.itemName || group.category || `Item ${index + 1}`;
        parts.push(title);
        if (group.quantity != null) parts.push(`Qty: ${group.quantity}`);
        if (group.unitPrice != null) parts.push(`Unit: ₹${Number(group.unitPrice).toFixed(2)}`);
        if (group.price != null && group.unitPrice == null) parts.push(`Price: ₹${Number(group.price).toFixed(2)}`);
        if (group.notes) parts.push(`Notes: ${group.notes}`);
        return parts.join(" | ");
      })
      .join("\n");
  };

  const formatDeliverySlots = (slots) => {
    if (!Array.isArray(slots) || slots.length === 0) return "—";
    return slots
      .map((slot, index) => {
        if (!slot) return `Slot ${index + 1}`;
        const parts = [];
        if (slot.deliveryDate) parts.push(new Date(slot.deliveryDate).toLocaleString());
        if (slot.windowStart || slot.windowEnd) {
          parts.push(`${slot.windowStart || ""} - ${slot.windowEnd || ""}`.trim());
        }
        if (slot.capacity != null) parts.push(`Capacity: ${slot.capacity}`);
        if (slot.notes) parts.push(`Notes: ${slot.notes}`);
        return parts.join(" | ");
      })
      .join("\n");
  };

  const formatAttendeeGroups = (groups) => {
    if (!Array.isArray(groups) || groups.length === 0) return "—";
    return groups
      .map((group, index) => {
        if (!group) return `Group ${index + 1}`;
        const parts = [];
        parts.push(group.label || group.name || `Group ${index + 1}`);
        if (group.count != null) parts.push(`Count: ${group.count}`);
        if (group.notes) parts.push(`Notes: ${group.notes}`);
        return parts.join(" | ");
      })
      .join("\n");
  };

  const bulkStatusOptions = [
    { value: "all", label: "All" },
    { value: "submitted_admin", label: "Under Review" },
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
            <div className="password-input-wrapper">
              <input
                type={showAdminPassword ? "text" : "password"}
                value={loginForm.password}
                onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Enter password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowAdminPassword((prev) => !prev)}
                aria-label={showAdminPassword ? "Hide password" : "Show password"}
              >
                {showAdminPassword ? (
                  <svg aria-hidden="true" className="eye-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M9.88 9.88A3 3 0 0114.12 14.12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    <path d="M10.73 5.08A10.86 10.86 0 0121 12c-1.1 1.86-2.57 3.47-4.31 4.71M6.24 6.24C4.03 7.73 2.28 9.67 1 12c1.88 3.34 5.36 6 10 6 1.48 0 2.86-.24 4.11-.69" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" className="eye-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <button type="submit" className="primary-button" style={{ width: "100%", marginTop: 12 }}>
            Sign In
          </button>
        </form>
      </div>
    );
  }

  const navButtonStyle = (isActive) => ({
    width: "100%",
    textAlign: "left",
    padding: "12px 16px",
    borderRadius: 10,
    border: `1px solid ${isActive ? "#3867d6" : "#dcdde1"}`,
    background: isActive ? "#f0f6ff" : "#ffffff",
    color: "#2c3e50",
    fontWeight: isActive ? 600 : 500,
    cursor: "pointer",
    boxShadow: isActive ? "inset 0 0 0 1px #d6e4ff" : "none",
    transition: "background 0.2s ease, border-color 0.2s ease",
  });

  const bulkOrdersPanel = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 13, color: "#7f8c8d", marginRight: 8 }}>Filter bulk orders</label>
          <select value={bulkStatus} onChange={(e) => { setBulkStatus(e.target.value); setSelectedBulkId(null); }}>
            {bulkStatusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button className="secondary-button" onClick={() => loadBulkOrders(adminSession, bulkStatus)} disabled={bulkLoading}>
          Refresh
        </button>
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
                    <label style={{ fontSize: 13, color: "#34495e" }}>
                      Choose vendor
                      <select
                        value={sendVendorShopId}
                        onChange={(e) => setSendVendorShopId(e.target.value)}
                        disabled={bulkLoading || vendorDirectoryLoading || vendorDirectoryOptions.length === 0}
                        style={{ display: "block", minWidth: 220, marginTop: 4 }}
                      >
                        <option value="">-- Select a vendor --</option>
                        {vendorDirectoryOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}{option.subtitle ? ` · ${option.subtitle}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="primary-button"
                      onClick={handleSendToVendor}
                      disabled={
                        bulkLoading
                        || !vendorDirectoryOptions.length
                        || !sendVendorShopId
                        || !["approved_admin", "sent_to_vendor", "pending_vendor"].includes(selectedBulkOrder.status)
                      }
                    >
                      Send to Vendor
                    </button>
                  </div>
                  {vendorDirectoryLoading && (
                    <div style={{ fontSize: 12, color: "#7f8c8d", marginTop: 8 }}>Loading vendor directory…</div>
                  )}
                  {vendorDirectoryError && (
                    <div style={{ fontSize: 12, color: "#c0392b", marginTop: 8 }}>{vendorDirectoryError}</div>
                  )}
                  {assignedVendorDetails && (
                    <div style={{ fontSize: 12, color: "#2c3e50", marginTop: 8 }}>
                      <strong>Current assignment:</strong> {assignedVendorDetails.shopName}
                      {assignedVendorDetails.contactEmail ? ` · ${assignedVendorDetails.contactEmail}` : ""}
                      {assignedVendorDetails.contactPhone ? ` · ${assignedVendorDetails.contactPhone}` : ""}
                    </div>
                  )}
                  {selectedVendorDetails && (!assignedVendorDetails || assignedVendorDetails.shopId !== selectedVendorDetails.shopId) && (
                    <div style={{ fontSize: 12, color: "#2c3e50", marginTop: 4 }}>
                      <strong>Selected vendor:</strong> {selectedVendorDetails.shopName}
                      {selectedVendorDetails.contactEmail ? ` · ${selectedVendorDetails.contactEmail}` : ""}
                      {selectedVendorDetails.contactPhone ? ` · ${selectedVendorDetails.contactPhone}` : ""}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 24 }}>
                  <h4>Request Details</h4>
                  {previousRevisionDisplay && (
                    <div style={{ fontSize: 12, color: "#7f8c8d", marginBottom: 8 }}>
                      Previous revision captured on {previousRevisionDisplay}
                    </div>
                  )}
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {renderDiffCard("Event name", selectedBulkOrder.eventName, previousState?.eventName)}
                    {renderDiffCard("Event type", selectedBulkOrder.eventType, previousState?.eventType)}
                    {renderDiffCard("Theme", selectedBulkOrder.eventTheme, previousState?.eventTheme)}
                    {renderDiffCard("Expected headcount", selectedBulkOrder.expectedHeadcount, previousState?.expectedHeadcount)}
                  </div>

                  <h5 style={{ marginTop: 16 }}>Schedule &amp; logistics</h5>
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {renderDiffCard("Event date", selectedBulkOrder.eventDate, previousState?.eventDate)}
                    {renderDiffCard("Start time", selectedBulkOrder.eventStartTime, previousState?.eventStartTime)}
                    {renderDiffCard("End time", selectedBulkOrder.eventEndTime, previousState?.eventEndTime)}
                    {renderDiffCard("Campus", selectedBulkOrder.campus, previousState?.campus)}
                    {renderDiffCard("Building", selectedBulkOrder.building, previousState?.building)}
                    {renderDiffCard("Floor", selectedBulkOrder.floor, previousState?.floor)}
                    {renderDiffCard("Location", selectedBulkOrder.location, previousState?.location)}
                  </div>

                  <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                    {renderDiffCard("Menu plan", selectedBulkOrder.itemGroups, previousState?.itemGroups, { multiline: true, formatter: formatItemGroups })}
                    {renderDiffCard("Delivery slots", selectedBulkOrder.deliverySlots, previousState?.deliverySlots, { multiline: true, formatter: formatDeliverySlots })}
                    {renderDiffCard("Attendee groups", selectedBulkOrder.attendeeGroups, previousState?.attendeeGroups, { multiline: true, formatter: formatAttendeeGroups })}
                  </div>

                  <h5 style={{ marginTop: 16 }}>Organizer &amp; notes</h5>
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {renderDiffCard("Organizer name", selectedBulkOrder.organizer?.name || selectedBulkOrder.organizerName, previousState?.organizer?.name || previousState?.organizerName)}
                    {renderDiffCard("Organizer email", selectedBulkOrder.organizer?.email || selectedBulkOrder.organizerEmail, previousState?.organizer?.email || previousState?.organizerEmail)}
                    {renderDiffCard("Organizer mobile", selectedBulkOrder.organizer?.mobile || selectedBulkOrder.organizerMobile, previousState?.organizer?.mobile || previousState?.organizerMobile)}
                    {renderDiffCard("Requested vendors", selectedBulkOrder.requestedVendors, previousState?.requestedVendors, {
                      multiline: true,
                      formatter: (value) => {
                        if (!Array.isArray(value) || value.length === 0) return "—";
                        return value.join("\n");
                      }
                    })}
                  </div>

                  <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                    {renderDiffCard("Special instructions", selectedBulkOrder.specialInstructions, previousState?.specialInstructions, { multiline: true })}
                    {renderDiffCard("Notes", selectedBulkOrder.notes, previousState?.notes, { multiline: true })}
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

                <div style={{ marginTop: 20 }}>
                  <h4>Vendor Messages</h4>
                  {Array.isArray(selectedBulkOrder.vendorMessages) && selectedBulkOrder.vendorMessages.length > 0 ? (
                    <ul style={{ fontSize: 13, color: "#2c3e50" }}>
                      {selectedBulkOrder.vendorMessages.map((message) => (
                        <li key={message.id}>
                          {message.timestamp ? `${new Date(message.timestamp).toLocaleString()}: ` : ""}
                          {message.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: 13, color: "#7f8c8d" }}>No messages yet.</div>
                  )}
                </div>

                <div style={{ marginTop: 20 }}>
                  <h4>Vendor Responses</h4>
                  {Array.isArray(selectedBulkOrder.vendorResponses) && selectedBulkOrder.vendorResponses.length > 0 ? (
                    <ul style={{ fontSize: 13, color: "#2c3e50" }}>
                      {selectedBulkOrder.vendorResponses.map((response) => (
                        <li key={response.id}>
                          <strong>{response.status?.toUpperCase() || "STATUS"}</strong>
                          {response.timestamp ? ` · ${new Date(response.timestamp).toLocaleString()}` : ""}
                          {response.capacity != null ? ` · capacity ${response.capacity}` : ""}
                          {response.slotId ? ` · slot ${response.slotId}` : ""}
                          {response.message ? ` – ${response.message}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: 13, color: "#7f8c8d" }}>No responses yet.</div>
                  )}
                </div>

                <div style={{ marginTop: 20 }}>
                  <h4>Attachments</h4>
                  {Array.isArray(selectedBulkOrder.attachments) && selectedBulkOrder.attachments.length > 0 ? (
                    <ul style={{ fontSize: 13 }}>
                      {selectedBulkOrder.attachments.map((attachment) => (
                        <li key={attachment.id || attachment.url}>
                          <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                            {attachment.name || attachment.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: 13, color: "#7f8c8d" }}>No attachments provided.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const vendorManagementPanel = (
    <div>
      <div className="grid" style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div className="card">
          <div className="card-header">Create New Vendor</div>
          <form className="card-body" onSubmit={handleCreateSubmit}>
            <div className="form-group">
              <label>Active Food Court</label>
              <select
                value={selectedFoodCourt}
                onChange={(e) => onFoodCourtChange(e.target.value)}
                style={{ minWidth: 160 }}
              >
                {adminFoodCourtOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
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
                  <option key={vendor.vendorId ?? vendor.id} value={vendor.vendorId ?? vendor.id}>
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
                <li key={vendor.vendorId ?? vendor.id} style={{ padding: "8px 0", borderBottom: "1px solid #ecf0f1", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{vendor.shopName}</div>
                    <div style={{ fontSize: 12, color: "#7f8c8d" }}>{vendor.email}</div>
                    <div style={{ fontSize: 12, color: "#7f8c8d" }}>{vendor.username}</div>
                  </div>
                  <button
                    type="button"
                    style={{ background: "#e74c3c", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 4, cursor: "pointer" }}
                    onClick={() => handleDeleteVendor(vendor.vendorId ?? vendor.id)}
                    disabled={vendorDirectoryLoading}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Recently Removed Vendors</span>
          <button
            type="button"
            className="secondary-button"
            onClick={loadArchivedVendors}
            disabled={archivedLoading}
          >
            Refresh
          </button>
        </div>
        <div className="card-body" style={{ maxHeight: 220, overflowY: "auto" }}>
          {archivedLoading && <div>Loading archived vendors…</div>}
          {archivedError && <div style={{ color: "#c0392b" }}>{archivedError}</div>}
          {!archivedLoading && !archivedError && archivedVendors.length === 0 && (
            <p style={{ color: "#7f8c8d", fontSize: 14 }}>No vendors are pending restoration. Deleted vendors remain here for 7 days.</p>
          )}
          {!archivedLoading && !archivedError && archivedVendors.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {archivedVendors.map((archive) => (
                <li
                  key={archive.archiveId}
                  style={{
                    padding: "10px 8px",
                    borderBottom: "1px solid #ecf0f1",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{archive.shopName || `Shop ${archive.shopId}`}</div>
                    <div style={{ fontSize: 12, color: "#7f8c8d" }}>User: {archive.username}</div>
                    <div style={{ fontSize: 11, color: "#95a5a6" }}>
                      Expires: {new Date(archive.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => handleRestoreVendor(archive.archiveId)}
                    disabled={archivedLoading}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {adminSession && (
        <AdminVendorGrievances adminSession={adminSession} />
      )}
    </div>
  );

  const userManagementPanel = (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">User Management</div>
        <div className="card-body">
          <p style={{ margin: 0, color: "#7f8c8d" }}>
            Manage employee accounts and review concerns raised from the cafeteria floor. Use the panel below to respond
            to cleanliness, food quality, or vendor service issues submitted by employees.
          </p>
        </div>
      </div>
      <AdminEmployeeDirectory adminSession={adminSession} />
      <AdminEmployeeConcerns adminSession={adminSession} />
    </div>
  );

  const analyticsPanel = (
    <div className="card">
      <div className="card-header">Analytics Overview</div>
      <div className="card-body">
        <p style={{ margin: 0, color: "#7f8c8d" }}>
          Analytics dashboards and reporting widgets will appear here. Configure KPIs and visualizations later.
        </p>
      </div>
    </div>
  );

  const procurementPanel = (
    <div className="card">
      <div className="card-header">Procurement Console</div>
      <div className="card-body">
        <p style={{ margin: 0, color: "#7f8c8d" }}>
          Upcoming tools for purchase planning, vendor sourcing, and inventory restocking workflows.
        </p>
      </div>
    </div>
  );

  const sectionWindowPanel = (
    <div className="card">
      <div className="card-header">Section Window</div>
      <div className="card-body">
        <p style={{ margin: 0, color: "#7f8c8d" }}>
          Use this space to configure sectional menus, kiosk visibility, and scheduling windows in future updates.
        </p>
      </div>
    </div>
  );

  const financePanel = (
    <div className="card">
      <div className="card-header">Finance Hub</div>
      <div className="card-body">
        <p style={{ margin: 0, color: "#7f8c8d" }}>
          Financial summaries, billing reconciliations, and settlement workflows will be integrated here later.
        </p>
      </div>
    </div>
  );
  const [newCourtName, setNewCourtName] = useState("");
  const [renameCourtId, setRenameCourtId] = useState("");
  const [renameCourtName, setRenameCourtName] = useState("");

  const handleCreateCourt = async (event) => {
    event.preventDefault();
    const trimmedName = newCourtName.trim();
    if (!trimmedName) {
      toast.error("Provide a name for the food court");
      return;
    }
    const result = await onCreateFoodCourt?.({ name: trimmedName });
    if (result) {
      setNewCourtName("");
    }
  };

  const handleRenameCourt = async (event) => {
    event.preventDefault();
    if (!renameCourtId) {
      toast.error("Select a food court to rename");
      return;
    }
    const trimmed = renameCourtName.trim();
    if (!trimmed) {
      toast.error("Provide a new display name");
      return;
    }
    const result = await onUpdateFoodCourt?.(renameCourtId, { name: trimmed });
    if (result) {
      setRenameCourtName("");
    }
  };

  const foodCourtPanel = (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Food Court Registry</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="secondary-button" onClick={onRefreshFoodCourts} disabled={foodCourtsLoading}>
              Refresh
            </button>
          </div>
        </div>
        <div className="card-body">
          {foodCourtsLoading && <div>Loading food courts…</div>}
          {foodCourtsError && <div style={{ color: "#c0392b" }}>{foodCourtsError}</div>}
          {!foodCourtsLoading && !foodCourtsError && foodCourts.length === 0 && (
            <div style={{ color: "#7f8c8d" }}>No food courts found. Create one using the form below.</div>
          )}
          {!foodCourtsLoading && !foodCourtsError && foodCourts.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
              {foodCourts.map((court) => (
                <li key={court.id} style={{ padding: 12, border: "1px solid #ecf0f1", borderRadius: 8, background: "#f8f9fb" }}>
                  <div style={{ fontWeight: 600 }}>{court.name}</div>
                  <div style={{ fontSize: 12, color: "#7f8c8d" }}>ID: {court.id}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid" style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div className="card">
          <div className="card-header">Create Food Court</div>
          <form className="card-body" onSubmit={handleCreateCourt}>
            <div className="form-group">
              <label>Display Name</label>
              <input
                type="text"
                value={newCourtName}
                onChange={(e) => setNewCourtName(e.target.value)}
                placeholder="e.g., Food Court 3"
              />
            </div>
            <button type="submit" className="primary-button" style={{ width: "100%" }} disabled={foodCourtsLoading}>
              Create
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-header">Rename Food Court</div>
          <form className="card-body" onSubmit={handleRenameCourt}>
            <div className="form-group">
              <label>Select Food Court</label>
              <select
                value={renameCourtId}
                onChange={(e) => {
                  setRenameCourtId(e.target.value);
                  const meta = foodCourts.find((court) => court.id === e.target.value);
                  setRenameCourtName(meta?.name || "");
                }}
              >
                <option value="">-- Choose a court --</option>
                {foodCourts.map((court) => (
                  <option key={court.id} value={court.id}>
                    {court.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>New Display Name</label>
              <input
                type="text"
                value={renameCourtName}
                onChange={(e) => setRenameCourtName(e.target.value)}
                placeholder="Enter new name"
                disabled={!renameCourtId}
              />
            </div>
            <button type="submit" className="secondary-button" style={{ width: "100%" }} disabled={!renameCourtId || foodCourtsLoading}>
              Rename
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  const panelByKey = {
    bulk: bulkOrdersPanel,
    vendors: vendorManagementPanel,
    "food-courts": foodCourtPanel,
    users: userManagementPanel,
    analytics: analyticsPanel,
    procurement: procurementPanel,
    sections: sectionWindowPanel,
    finance: financePanel,
  };

  return (
    <div className="admin-control">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Admin Control Center</h2>
        <span style={{ fontSize: 13, color: "#6c7a89" }}>Signed in as {adminSession.username}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
        <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            type="button"
            style={navButtonStyle(activePanel === "bulk")}
            onClick={() => setActivePanel("bulk")}
          >
            Bulk Orders
          </button>
          <button
            type="button"
            style={navButtonStyle(activePanel === "vendors")}
            onClick={() => setActivePanel("vendors")}
          >
            Manage Vendors
          </button>
          <button
            type="button"
            style={navButtonStyle(activePanel === "food-courts")}
            onClick={() => setActivePanel("food-courts")}
          >
            Food Court Control
          </button>
          <button
            type="button"
            style={navButtonStyle(activePanel === "users")}
            onClick={() => setActivePanel("users")}
          >
            User Management
          </button>
          <button
            type="button"
            style={navButtonStyle(activePanel === "analytics")}
            onClick={() => setActivePanel("analytics")}
          >
            Analytics
          </button>
          <button
            type="button"
            style={navButtonStyle(activePanel === "procurement")}
            onClick={() => setActivePanel("procurement")}
          >
            Procurement
          </button>
          <button
            type="button"
            style={navButtonStyle(activePanel === "sections")}
            onClick={() => setActivePanel("sections")}
          >
            Section Window
          </button>
          <button
            type="button"
            style={navButtonStyle(activePanel === "finance")}
            onClick={() => setActivePanel("finance")}
          >
            Finance
          </button>
          <div style={{ fontSize: 12, color: "#95a5a6", marginTop: 8 }}>
            Select an option to view actions on the right.
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {panelByKey[activePanel] || panelByKey.bulk}
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
  vendors: PropTypes.arrayOf(PropTypes.object),
  onRequestRefresh: PropTypes.func,
  selectedFoodCourt: PropTypes.string,
  onFoodCourtChange: PropTypes.func,
  adminFoodCourtOptions: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ),
  foodCourts: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
    })
  ),
  foodCourtsLoading: PropTypes.bool,
  foodCourtsError: PropTypes.string,
  onCreateFoodCourt: PropTypes.func,
  onUpdateFoodCourt: PropTypes.func,
  onRefreshFoodCourts: PropTypes.func,
};

export default AdminControl;
