import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  fetchBulkOrders,
  createBulkOrder,
  updateBulkOrder,
  postBulkOrderVendorMessage,
  confirmBulkOrderSlot,
} from "../api";
import { toast } from "react-toastify";

const buildInitialFormState = (employeeRole) => ({
  eventName: "",
  eventType: "",
  eventTheme: "",
  eventDate: "",
  eventStart: "",
  eventEnd: "",
  location: "",
  building: "",
  floor: "",
  campus: employeeRole?.department || "",
  expectedHeadcount: "",
  specialInstructions: "",
  notes: "",
  organizerName: "",
  organizerEmail: "",
  organizerMobile: "",
  requestedVendorsText: "",
  pricingType: "vendor_rate",
  bulkDiscountPercent: "",
  bulkFlatRate: "",
});

const STATUS_COLORS = {
  draft: "#95a5a6",
  submitted_admin: "#8e44ad",
  needs_revision: "#d35400",
  approved_admin: "#2980b9",
  sent_to_vendor: "#27ae60",
  pending_vendor: "#f39c12",
  confirmed: "#27ae60",
  in_progress: "#2980b9",
  completed: "#16a085",
  cancelled: "#c0392b",
  admin_rejected: "#c0392b",
};

const STATUS_LABELS = {
  draft: "Draft",
  submitted_admin: "Submitted to admin",
  needs_revision: "Needs revision",
  approved_admin: "Approved by Admin",
  sent_to_vendor: "Sent to Vendor",
  pending_vendor: "Vendor Pending",
  confirmed: "Vendor Confirmed",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  admin_rejected: "Rejected",
};

const normalizeOrderStatus = (value) => (typeof value === "string" ? value.toLowerCase() : "");

const pricingModes = [
  { value: "vendor_rate", label: "Vendor Rate" },
  { value: "bulk_discount", label: "Bulk Discount" },
  { value: "custom_quote", label: "Custom Quote" },
];

const BulkOrderPortal = ({ token, employeeRole, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState("upcoming");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    eventName: "",
    eventType: "",
    eventTheme: "",
    eventDate: "",
    eventStart: "",
    eventEnd: "",
    location: "",
    building: "",
    floor: "",
    campus: employeeRole?.department || "",
    expectedHeadcount: "",
    specialInstructions: "",
    notes: "",
    organizerName: "",
    organizerEmail: "",
    organizerMobile: "",
    requestedVendorsText: "",
    pricingType: "vendor_rate",
    bulkDiscountPercent: "",
    bulkFlatRate: "",
  });
  const [deliverySlots, setDeliverySlots] = useState([]);
  const [slotDraft, setSlotDraft] = useState({
    label: "",
    start: "",
    end: "",
    notes: "",
  });
  const [itemGroups, setItemGroups] = useState([]);
  const [itemDraft, setItemDraft] = useState({
    name: "",
    quantity: "",
    unitPrice: "",
    notes: "",
  });
  const [attendeeGroups, setAttendeeGroups] = useState([]);
  const [attendeeDraft, setAttendeeDraft] = useState({
    label: "",
    count: "",
    notes: "",
  });
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [wizardMode, setWizardMode] = useState("create");
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [messageDrafts, setMessageDrafts] = useState({});
  const [confirmDrafts, setConfirmDrafts] = useState({});
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const loadOrderIntoWizard = useCallback((order) => {
    if (!order) return;
    const base = buildInitialFormState(employeeRole);
    setForm({
      ...base,
      eventName: order.eventName || "",
      eventType: order.eventType || "",
      eventTheme: order.eventTheme || "",
      eventDate: order.eventDate ? order.eventDate.slice(0, 10) : "",
      eventStart: order.eventStartTime ? new Date(order.eventStartTime).toISOString().slice(0, 16) : "",
      eventEnd: order.eventEndTime ? new Date(order.eventEndTime).toISOString().slice(0, 16) : "",
      location: order.location || "",
      building: order.building || "",
      floor: order.floor || "",
      campus: order.campus || "",
      notes: order.notes || "",
      specialInstructions: order.specialInstructions || "",
      expectedHeadcount: order.expectedHeadcount != null ? String(order.expectedHeadcount) : "",
      organizerName: order.organizerContact?.name || "",
      organizerEmail: order.organizerContact?.email || "",
      organizerMobile: order.organizerContact?.mobile || "",
      requestedVendorsText: Array.isArray(order.requestedVendors) ? order.requestedVendors.join("\n") : "",
      pricingType: order.pricing?.pricingType || order.pricing?.pricing_type || "vendor_rate",
      bulkDiscountPercent: order.pricing?.bulkDiscountPercent != null ? String(order.pricing.bulkDiscountPercent) : "",
      bulkFlatRate: order.pricing?.bulkFlatRate != null ? String(order.pricing.bulkFlatRate) : "",
    });
    setDeliverySlots(Array.isArray(order.deliverySlots) ? order.deliverySlots.map((slot) => ({
      id: slot.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: slot.label || "",
      startTime: slot.startTime,
      endTime: slot.endTime,
      notes: slot.notes || ""
    })) : []);
    setItemGroups(Array.isArray(order.itemGroups) ? order.itemGroups.map((item) => ({
      id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: item.name || "",
      quantity: item.quantity || 0,
      unitPrice: item.unitPrice || 0,
      notes: item.notes || "",
    })) : []);
    setAttendeeGroups(Array.isArray(order.attendeeGroups) ? order.attendeeGroups.map((group) => ({
      id: group.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: group.label || "",
      count: group.count || 0,
      notes: group.notes || "",
    })) : []);
    setSelectedOrderId(order.id);
    setEditingOrderId(order.id);
    setWizardMode("edit");
    setWizardOpen(true);
  }, [employeeRole]);

  const loadOrders = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchBulkOrders(token);
      if (res?.status === "ok" && Array.isArray(res.orders)) {
        setOrders(res.orders);
        setLastFetchedAt(new Date());
        setSelectedOrderId((prev) => {
          if (prev != null && res.orders.some((order) => Number(order.id) === Number(prev))) {
            return prev;
          }
          if (res.orders.length > 0) {
            return res.orders[0].id;
          }
          return null;
        });
      } else {
        setError(res?.message || "Failed to load bulk orders");
        setOrders([]);
        setLastFetchedAt(new Date());
      }
    } catch (err) {
      console.error("Bulk order fetch error", err);
      setError("Unable to load bulk orders");
      setLastFetchedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!token) return undefined;
    const interval = setInterval(() => {
      loadOrders();
    }, 15000);
    return () => clearInterval(interval);
  }, [token, loadOrders]);

  const upcomingOrders = useMemo(() => {
    if (!Array.isArray(orders)) return [];
    return orders.filter((order) => normalizeOrderStatus(order?.status) === "pending_vendor");
  }, [orders]);

  const pastOrders = useMemo(() => {
    if (!Array.isArray(orders)) return [];
    return orders.filter((order) => normalizeOrderStatus(order?.status) === "completed");
  }, [orders]);

  const selectedOrders = selectedStatus === "upcoming" ? upcomingOrders : pastOrders;
  const selectedOrder = orders.find((order) => Number(order.id) === Number(selectedOrderId));

  useEffect(() => {
    if (!selectedOrder) return;
    setMessageDrafts((prev) => {
      if (prev[selectedOrder.id] !== undefined) return prev;
      return { ...prev, [selectedOrder.id]: "" };
    });
    setConfirmDrafts((prev) => {
      if (prev[selectedOrder.id]) return prev;
      const slots = Array.isArray(selectedOrder.deliverySlots) ? selectedOrder.deliverySlots : [];
      const defaultSlotId = slots.find((slot) => slot.vendorConfirmation !== "confirmed")?.id || (slots[0] && slots[0].id) || null;
      return {
        ...prev,
        [selectedOrder.id]: {
          slotId: defaultSlotId,
          capacity: selectedOrder.expectedHeadcount || "",
          status: "confirmed",
          note: "",
        },
      };
    });
  }, [selectedOrder]);

  const resetWizard = useCallback(() => {
    setForm({
      eventName: "",
      eventType: "",
      eventTheme: "",
      eventDate: "",
      eventStart: "",
      eventEnd: "",
      location: "",
      building: "",
      floor: "",
      campus: employeeRole?.department || "",
      expectedHeadcount: "",
      specialInstructions: "",
      notes: "",
      organizerName: employeeRole?.role ? `${employeeRole.role}` : "",
      organizerEmail: "",
      organizerMobile: "",
      requestedVendorsText: "",
      pricingType: "vendor_rate",
      bulkDiscountPercent: "",
      bulkFlatRate: "",
    });
    setDeliverySlots([]);
    setSlotDraft({ label: "", start: "", end: "", notes: "" });
    setItemGroups([]);
    setItemDraft({ name: "", quantity: "", unitPrice: "", notes: "" });
    setAttendeeGroups([]);
    setAttendeeDraft({ label: "", count: "", notes: "" });
    setWizardOpen(false);
    setSelectedOrderId(null);
    setEditingOrderId(null);
    setWizardMode("create");
  }, [employeeRole?.department, employeeRole?.role]);

  const handleAddSlot = () => {
    if (!slotDraft.label || !slotDraft.start || !slotDraft.end) {
      toast.error("Provide label, start, and end for the slot");
      return;
    }
    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: slotDraft.label,
      startTime: new Date(slotDraft.start).toISOString(),
      endTime: new Date(slotDraft.end).toISOString(),
      notes: slotDraft.notes,
    };
    setDeliverySlots((prev) => [...prev, payload]);
    setSlotDraft({ label: "", start: "", end: "", notes: "" });
  };

  const handleAddItemGroup = () => {
    if (!itemDraft.name || !itemDraft.quantity) {
      toast.error("Enter item name and quantity");
      return;
    }
    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: itemDraft.name,
      quantity: Number(itemDraft.quantity) || 0,
      unitPrice: Number(itemDraft.unitPrice) || 0,
      notes: itemDraft.notes,
    };
    setItemGroups((prev) => [...prev, payload]);
    setItemDraft({ name: "", quantity: "", unitPrice: "", notes: "" });
  };

  const handleAddAttendeeGroup = () => {
    if (!attendeeDraft.label && !attendeeDraft.count) {
      toast.error("Add at least a description or headcount");
      return;
    }
    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: attendeeDraft.label || "Attendees",
      count: Number(attendeeDraft.count) || 0,
      notes: attendeeDraft.notes,
    };
    setAttendeeGroups((prev) => [...prev, payload]);
    setAttendeeDraft({ label: "", count: "", notes: "" });
  };

  const removeSlot = (id) => setDeliverySlots((prev) => prev.filter((slot) => slot.id !== id));
  const removeItemGroup = (id) => setItemGroups((prev) => prev.filter((item) => item.id !== id));
  const removeAttendee = (id) => setAttendeeGroups((prev) => prev.filter((group) => group.id !== id));

  const toIsoDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  const buildPayload = useCallback(() => {
    if (!form.eventName) {
      toast.error("Event name is required");
      return null;
    }
    if (!form.eventDate && deliverySlots.length === 0) {
      toast.error("Provide an event date or at least one delivery slot");
      return null;
    }
    if (itemGroups.length === 0) {
      toast.error("Add at least one item group");
      return null;
    }

    const requestedVendors = form.requestedVendorsText
      ? form.requestedVendorsText.split(/,|\n/).map((v) => v.trim()).filter(Boolean)
      : [];

    const payload = {
      eventName: form.eventName,
      eventType: form.eventType || undefined,
      eventTheme: form.eventTheme || undefined,
      eventDate: form.eventDate ? toIsoDate(form.eventDate) : null,
      eventStartTime: form.eventStart ? new Date(form.eventStart).toISOString() : null,
      eventEndTime: form.eventEnd ? new Date(form.eventEnd).toISOString() : null,
      location: form.location,
      building: form.building,
      floor: form.floor,
      campus: form.campus,
      notes: form.notes,
      specialInstructions: form.specialInstructions,
      expectedHeadcount: form.expectedHeadcount ? Number(form.expectedHeadcount) : undefined,
      deliverySlots,
      itemGroups,
      attendeeGroups,
      organizerName: form.organizerName,
      organizerEmail: form.organizerEmail,
      organizerMobile: form.organizerMobile,
      requestedVendors,
      pricing: {
        pricing_type: form.pricingType,
        bulk_discount_percent: form.bulkDiscountPercent ? Number(form.bulkDiscountPercent) : undefined,
        bulk_flat_rate: form.bulkFlatRate ? Number(form.bulkFlatRate) : undefined,
      },
      metadata: {
        submittedByDepartment: employeeRole?.department || null,
        organizerRole: employeeRole?.roleSlug || employeeRole?.role || null,
      },
    };

    return payload;
  }, [form, deliverySlots, itemGroups, attendeeGroups, employeeRole]);

  const handleSubmitOrder = async (evt) => {
    evt.preventDefault();
    const payload = buildPayload();
    if (!payload) return;
    try {
      setSubmitting(true);
      const res = await createBulkOrder(token, payload);
      if (res?.status === "ok" && res.order) {
        toast.success(`Bulk order #${res.order.id} created`);
        resetWizard();
        await loadOrders();
      } else {
        const message = res?.message || "Failed to create bulk order";
        toast.error(message);
      }
    } catch (err) {
      console.error("Create bulk order error", err);
      toast.error("Unable to create bulk order");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResubmitOrder = useCallback(async (evt) => {
    evt.preventDefault();
    if (!editingOrderId) return;
    const payload = buildPayload();
    if (!payload) return;
    try {
      setSubmitting(true);
      const res = await updateBulkOrder(token, editingOrderId, payload);
      if (res?.status === "ok" && res.order) {
        toast.success(`Bulk order #${editingOrderId} updated`);
        setOrders((prev) => prev.map((order) => (Number(order.id) === Number(editingOrderId) ? res.order : order)));
        resetWizard();
      } else {
        const message = res?.message || "Failed to update bulk order";
        toast.error(message);
      }
    } catch (err) {
      console.error("Update bulk order error", err);
      toast.error("Unable to update bulk order");
    } finally {
      setSubmitting(false);
    }
  }, [editingOrderId, buildPayload, token, resetWizard]);

  const handleUpdateStatus = async (orderId, status) => {
    if (!orderId || !status) return;
    try {
      const res = await updateBulkOrder(token, orderId, { status });
      if (res?.status === "ok" && res.order) {
        toast.success(`Order #${orderId} marked ${status}`);
        setOrders((prev) => prev.map((order) => (Number(order.id) === Number(orderId) ? res.order : order)));
        loadOrders();
      } else {
        toast.error(res?.message || "Failed to update order");
      }
    } catch (err) {
      toast.error("Could not update order status");
    }
  };

  const renderOrderCard = (order) => {
    const slots = Array.isArray(order.deliverySlots) ? order.deliverySlots : [];
    const attendees = Array.isArray(order.attendeeGroups) ? order.attendeeGroups : [];
    const color = STATUS_COLORS[order.status] || "#34495e";
    const statusLabel = STATUS_LABELS[order.status] || order.status;
    return (
      <div
        key={order.id}
        className="bulk-order-card"
        onClick={() => setSelectedOrderId(order.id)}
        style={{
          border: `1px solid ${color}`,
          borderRadius: 8,
          padding: 16,
          cursor: "pointer",
          background: selectedOrderId === order.id ? "#f0f6ff" : "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>#{order.id} · {order.eventName || "Untitled"}</h3>
          <span style={{
            padding: "4px 10px",
            borderRadius: 16,
            background: color,
            color: "#fff",
            fontSize: 12,
          }}>{statusLabel}</span>
        </div>
        <p style={{ marginTop: 6, marginBottom: 6 }}>{order.specialInstructions || order.notes || "No special notes."}</p>
        <div style={{ fontSize: 13, color: "#555" }}>
          <div>Location: {order.location || "TBD"}</div>
          <div>Guests: {order.expectedHeadcount || order.expectedGuests || "n/a"}</div>
          <div>Delivery slots: {slots.length > 0 ? slots.map((slot) => slot.label || new Date(slot.startTime).toLocaleString()).join(", ") : "Not scheduled"}</div>
          {attendees.length > 0 && (
            <div>Attendee groups: {attendees.map((group) => `${group.label} (${group.count || "—"})`).join(", ")}</div>
          )}
        </div>
      </div>
    );
  };

  const renderSelectedOrderDetails = () => {
    if (!selectedOrder) return null;
    const slots = Array.isArray(selectedOrder.deliverySlots) ? selectedOrder.deliverySlots : [];
    const itemList = Array.isArray(selectedOrder.itemGroups) ? selectedOrder.itemGroups : [];
    const attendees = Array.isArray(selectedOrder.attendeeGroups) ? selectedOrder.attendeeGroups : [];
    const vendorMessages = Array.isArray(selectedOrder.vendorMessages) ? selectedOrder.vendorMessages : [];
    const vendorResponses = Array.isArray(selectedOrder.vendorResponses) ? selectedOrder.vendorResponses : [];
    const adminReview = selectedOrder.adminReview || {};
    const decisions = Array.isArray(adminReview.decisions) ? adminReview.decisions : [];
    const canSubmitToAdmin = ["draft", "needs_revision"].includes(selectedOrder.status);
    const statusLabel = STATUS_LABELS[selectedOrder.status] || selectedOrder.status;
    const vendorContact = selectedOrder.vendorContact || {};
    const normalizedStatus = normalizeOrderStatus(selectedOrder.status);
    const isOrderClosed = ["completed", "cancelled", "admin_rejected"].includes(normalizedStatus);
    const vendorEmail = vendorContact.email || vendorContact.contactEmail || null;
    const vendorPhone = vendorContact.phone || vendorContact.contactPhone || vendorContact.mobile || null;
    const vendorShopId = selectedOrder.vendorShopId != null ? String(selectedOrder.vendorShopId) : null;
    const messageDraft = messageDrafts[selectedOrder.id] ?? "";
    const confirmDraft = confirmDrafts[selectedOrder.id] || { slotId: null, capacity: "", status: "confirmed", note: "" };
    const canSubmitVendorResponse = Boolean(vendorShopId) && !isOrderClosed && ["pending_vendor", "confirmed", "in_progress"].includes(selectedOrder.status);
    const canMessageVendor = Boolean(vendorShopId) && !isOrderClosed;

    return (
      <div className="bulk-order-details" style={{ marginTop: 24, padding: 20, background: "#f9fbfd", borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Bulk Order #{selectedOrder.id}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            {canSubmitToAdmin && (
              <button onClick={() => handleUpdateStatus(selectedOrder.id, "submitted_admin")} className="primary-button">
                Submit to Admin
              </button>
            )}
            {selectedOrder.status === "needs_revision" && (
              <button
                className="secondary-button"
                onClick={() => {
                  loadOrderIntoWizard(selectedOrder);
                }}
              >
                Edit & Resubmit
              </button>
            )}
            {selectedOrder.status && ["pending_vendor", "confirmed", "in_progress"].includes(selectedOrder.status) && (
              <button onClick={() => handleUpdateStatus(selectedOrder.id, "cancelled")} className="secondary-button" style={{ background: "#e74c3c", color: "#fff" }}>
                Cancel Order
              </button>
            )}
            <button onClick={() => handleUpdateStatus(selectedOrder.id, "completed")} className="secondary-button" disabled={!["in_progress", "pending_vendor", "confirmed"].includes(selectedOrder.status)}>
              Mark Completed
            </button>
          </div>
        </div>
        <p style={{ color: "#555" }}>{selectedOrder.specialInstructions || selectedOrder.notes || "No notes shared."}</p>
        <div style={{ marginTop: 8, fontSize: 13, color: "#7f8c8d" }}>
          <strong>Status:</strong> {statusLabel} · <strong>Admin Review:</strong> {adminReview.status || "—"}
        </div>

        <section style={{ marginTop: 16 }}>
          <h3>Schedule</h3>
          {slots.length === 0 ? (
            <div>No slots scheduled.</div>
          ) : (
            <ul>
              {slots.map((slot) => (
                <li key={slot.id}>
                  <strong>{slot.label || "Delivery"}</strong>: {slot.startTime ? new Date(slot.startTime).toLocaleString() : "TBD"}
                  {slot.endTime ? ` — ${new Date(slot.endTime).toLocaleString()}` : ""}
                  {slot.vendorConfirmation ? ` · Vendor status: ${slot.vendorConfirmation}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          <h3>Menu Groups</h3>
          {itemList.length === 0 ? (
            <div>No menu items captured.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Name</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {itemList.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td style={{ textAlign: "center" }}>{item.quantity}</td>
                    <td style={{ textAlign: "center" }}>₹{item.unitPrice}</td>
                    <td>{item.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          <h3>Attendee Snapshot</h3>
          {attendees.length === 0 ? (
            <div>No attendee groups recorded.</div>
          ) : (
            <ul>
              {attendees.map((group) => (
                <li key={group.id}>
                  {group.label}: {group.count || "—"}{group.notes ? ` – ${group.notes}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          <h3>Admin Decisions</h3>
          {decisions.length === 0 ? (
            <div>No admin feedback yet.</div>
          ) : (
            <ul>
              {decisions.slice(0, 5).map((decision) => (
                <li key={decision.id}>
                  <strong>{(decision.action || '').replace(/_/g, ' ')}</strong> · {decision.timestamp ? new Date(decision.timestamp).toLocaleString() : ''}
                  {decision.comment ? ` – ${decision.comment}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: 16 }}>
          <h3>Vendor Updates</h3>
          {vendorResponses.length === 0 && vendorMessages.length === 0 ? (
            <div>No updates from vendors yet.</div>
          ) : (
            <div className="vendor-updates" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <h4>Confirmations</h4>
                <ul>
                  {vendorResponses.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.status?.toUpperCase()}</strong> · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ""}
                      {entry.capacity != null ? ` · capacity ${entry.capacity}` : ""}
                      {entry.slotId ? ` · slot ${entry.slotId}` : ""}
                      {entry.message ? ` – ${entry.message}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <h4>Messages</h4>
                <ul>
                  {vendorMessages.map((entry) => (
                    <li key={entry.id}>
                      {entry.timestamp ? `${new Date(entry.timestamp).toLocaleString()}: ` : ""}
                      {entry.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {canMessageVendor && (
            <div style={{ marginTop: 12, padding: 12, background: "#fff", borderRadius: 8, border: "1px solid #dce6f5" }}>
              <h4 style={{ marginTop: 0 }}>Send message to vendor</h4>
              <p style={{ fontSize: 13, color: "#566573" }}>Use this box to share updates or questions. Messages appear instantly in the vendor dashboard.</p>
              <textarea
                value={messageDraft}
                onChange={(e) =>
                  setMessageDrafts((prev) => ({ ...prev, [selectedOrder.id]: e.target.value }))
                }
                placeholder="Type your message for the vendor..."
                rows={3}
                style={{ width: "100%", resize: "vertical", padding: 8 }}
              />
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  className="primary-button"
                  onClick={async () => {
                    if (!messageDraft.trim()) {
                      toast.error("Message cannot be empty");
                      return;
                    }
                    try {
                      const res = await postBulkOrderVendorMessage(token, selectedOrder.id, messageDraft.trim());
                      if (res?.status === "ok" && res.order) {
                        toast.success("Message sent to vendor");
                        setOrders((prev) => prev.map((order) => (order.id === selectedOrder.id ? res.order : order)));
                        setMessageDrafts((prev) => ({ ...prev, [selectedOrder.id]: "" }));
                      } else {
                        toast.error(res?.message || "Unable to send message");
                      }
                    } catch (error) {
                      console.error("Failed to post message", error);
                      toast.error("Unable to send message to vendor");
                    }
                  }}
                >
                  Send Message
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setMessageDrafts((prev) => ({ ...prev, [selectedOrder.id]: "" }))}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          {canSubmitVendorResponse && (
            <div style={{ marginTop: 16, padding: 12, background: "#fff", borderRadius: 8, border: "1px solid #dce6f5" }}>
              <h4 style={{ marginTop: 0 }}>Confirm delivery with vendor</h4>
              <p style={{ fontSize: 13, color: "#566573" }}>Share the vendor0s response back to the record. This keeps the organizer, admin, and vendor aligned.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <label style={{ flex: "1 1 180px" }}>
                  Slot
                  <select
                    value={confirmDraft.slotId || ""}
                    onChange={(e) =>
                      setConfirmDrafts((prev) => ({
                        ...prev,
                        [selectedOrder.id]: {
                          ...prev[selectedOrder.id],
                          slotId: e.target.value,
                        },
                      }))
                    }
                    style={{ display: "block", width: "100%", marginTop: 4 }}
                  >
                    {slots.map((slot) => (
                      <option key={slot.id} value={slot.id}>{slot.label || slot.id}</option>
                    ))}
                  </select>
                </label>
                <label style={{ flex: "1 1 140px" }}>
                  Capacity
                  <input
                    value={confirmDraft.capacity}
                    onChange={(e) =>
                      setConfirmDrafts((prev) => ({
                        ...prev,
                        [selectedOrder.id]: {
                          ...prev[selectedOrder.id],
                          capacity: e.target.value,
                        },
                      }))
                    }
                    type="number"
                    style={{ display: "block", width: "100%", marginTop: 4 }}
                  />
                </label>
                <label style={{ flex: "1 1 160px" }}>
                  Status
                  <select
                    value={confirmDraft.status}
                    onChange={(e) =>
                      setConfirmDrafts((prev) => ({
                        ...prev,
                        [selectedOrder.id]: {
                          ...prev[selectedOrder.id],
                          status: e.target.value,
                        },
                      }))
                    }
                    style={{ display: "block", width: "100%", marginTop: 4 }}
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                <textarea
                  value={confirmDraft.note}
                  onChange={(e) =>
                    setConfirmDrafts((prev) => ({
                      ...prev,
                      [selectedOrder.id]: {
                        ...prev[selectedOrder.id],
                        note: e.target.value,
                      },
                    }))
                  }
                  placeholder="Add an optional note (visible to vendor and admin)"
                  rows={3}
                  style={{ width: "100%", resize: "vertical", padding: 8 }}
                />
                <button
                  className="primary-button"
                  onClick={async () => {
                    try {
                      const payload = {
                        slotId: confirmDraft.slotId,
                        status: confirmDraft.status,
                        capacity: confirmDraft.capacity ? Number(confirmDraft.capacity) : undefined,
                        message: confirmDraft.note || undefined,
                      };
                      const res = await confirmBulkOrderSlot(token, selectedOrder.id, payload);
                      if (res?.status === "ok" && res.order) {
                        toast.success("Vendor response recorded");
                        setOrders((prev) => prev.map((order) => (order.id === selectedOrder.id ? res.order : order)));
                        setConfirmDrafts((prev) => ({
                          ...prev,
                          [selectedOrder.id]: {
                            ...prev[selectedOrder.id],
                            note: "",
                          },
                        }));
                      } else {
                        toast.error(res?.message || "Unable to record confirmation");
                      }
                    } catch (error) {
                      console.error("Failed to submit confirmation", error);
                      toast.error("Unable to confirm with vendor");
                    }
                  }}
                  disabled={!confirmDraft.slotId}
                >
                  Submit Vendor Confirmation
                </button>
              </div>
            </div>
          )}
          {isOrderClosed && (
            <div style={{ marginTop: 12, padding: 12, background: "#fdf6e3", borderRadius: 8, border: "1px solid #f1c40f", color: "#7d6608" }}>
              Messaging is unavailable because this order has been closed.
            </div>
          )}
        </section>

        {(vendorEmail || vendorPhone) && (
          <section style={{ marginTop: 16 }}>
            <h3>Contact Vendor</h3>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {vendorEmail && (
                <a className="secondary-button" href={`mailto:${vendorEmail}`} target="_blank" rel="noreferrer">
                  Email Vendor
                </a>
              )}
              {vendorPhone && (
                <>
                  <a className="secondary-button" href={`tel:${vendorPhone}`}>
                    Call Vendor
                  </a>
                  <a className="secondary-button" href={`sms:${vendorPhone}`}>
                    Text Vendor
                  </a>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    );
  };

  const upcomingCount = upcomingOrders.length;
  const pastCount = pastOrders.length;
  const vendorLockedCount = useMemo(() => {
    if (!Array.isArray(orders)) return 0;
    return orders.filter((order) => {
      if (!order) return false;
      if (order.status === "completed") return true;
      if (order.status === "confirmed") return true;
      const responses = Array.isArray(order.vendorResponses) ? order.vendorResponses : [];
      return responses.some((response) => String(response?.status || "").toLowerCase() === "confirmed");
    }).length;
  }, [orders]);

  return (
    <div className="bulk-portal" style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Bulk Order Planner</h1>
          <p style={{ margin: 0, color: "#555" }}>
            Organize multi-slot events, coordinate with vendors, and track deliveries.
          </p>
          <p style={{ margin: 0, color: "#777", fontSize: 13 }}>
            Signed in as {employeeRole?.role || "Employee"}{employeeRole?.department ? ` · ${employeeRole.department}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={onClose} className="secondary-button">Back to ordering</button>
          <button
            onClick={loadOrders}
            className="secondary-button"
            disabled={loading}
          >
            Refresh
          </button>
          <button onClick={() => { resetWizard(); setWizardMode("create"); setWizardOpen(true); }} className="primary-button">
            New Bulk Order
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: "#5f6f7d" }}>
        Last updated: {lastFetchedAt ? new Date(lastFetchedAt).toLocaleTimeString() : "--"}
      </div>

      <div style={{ marginTop: 24, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", background: "#ecf5ff", padding: 16, borderRadius: 12 }}>
          <h3 style={{ margin: 0 }}>Upcoming</h3>
          <p style={{ fontSize: 30, margin: "4px 0" }}>{upcomingCount}</p>
          <small>Includes draft, pending, and confirmed events.</small>
        </div>
        <div style={{ flex: "1 1 200px", background: "#f3f4f6", padding: 16, borderRadius: 12 }}>
          <h3 style={{ margin: 0 }}>Historical</h3>
          <p style={{ fontSize: 30, margin: "4px 0" }}>{pastCount}</p>
          <small>Completed or cancelled events.</small>
        </div>
        <div style={{ flex: "1 1 200px", background: "#fff7ec", padding: 16, borderRadius: 12 }}>
          <h3 style={{ margin: 0 }}>Vendor confirmed</h3>
          <p style={{ fontSize: 30, margin: "4px 0" }}>{vendorLockedCount}</p>
          <small>Events with vendor capacity locked.</small>
        </div>
      </div>

      {wizardOpen && (
        <div style={{ marginTop: 32, padding: 24, background: "#ffffff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Create Bulk Order</h2>
            <button onClick={resetWizard} className="secondary-button">Close</button>
          </div>
          <form
            onSubmit={wizardMode === "edit" ? handleResubmitOrder : handleSubmitOrder}
            style={{ marginTop: 16 }}
          >
            <section style={{ marginBottom: 24 }}>
              <h3>Event basics</h3>
              <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <label>
                  Event name*
                  <input type="text" value={form.eventName} onChange={(e) => setForm((prev) => ({ ...prev, eventName: e.target.value }))} required />
                </label>
                <label>
                  Event type
                  <input type="text" value={form.eventType} onChange={(e) => setForm((prev) => ({ ...prev, eventType: e.target.value }))} placeholder="Townhall, onboarding, ..." />
                </label>
                <label>
                  Theme
                  <input type="text" value={form.eventTheme} onChange={(e) => setForm((prev) => ({ ...prev, eventTheme: e.target.value }))} />
                </label>
                <label>
                  Event date
                  <input type="date" value={form.eventDate} onChange={(e) => setForm((prev) => ({ ...prev, eventDate: e.target.value }))} />
                </label>
                <label>
                  Start time
                  <input type="datetime-local" value={form.eventStart} onChange={(e) => setForm((prev) => ({ ...prev, eventStart: e.target.value }))} />
                </label>
                <label>
                  End time
                  <input type="datetime-local" value={form.eventEnd} onChange={(e) => setForm((prev) => ({ ...prev, eventEnd: e.target.value }))} />
                </label>
                <label>
                  Expected attendees
                  <input type="number" min="0" value={form.expectedHeadcount} onChange={(e) => setForm((prev) => ({ ...prev, expectedHeadcount: e.target.value }))} />
                </label>
                <label>
                  Campus / building
                  <input type="text" value={form.campus} onChange={(e) => setForm((prev) => ({ ...prev, campus: e.target.value }))} placeholder="Infosys Tower 3" />
                </label>
                <label>
                  Location details
                  <input type="text" value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} placeholder="Conference hall, cafeteria..." />
                </label>
                <label>
                  Building
                  <input type="text" value={form.building} onChange={(e) => setForm((prev) => ({ ...prev, building: e.target.value }))} />
                </label>
                <label>
                  Floor
                  <input type="text" value={form.floor} onChange={(e) => setForm((prev) => ({ ...prev, floor: e.target.value }))} />
                </label>
              </div>
            </section>

            <section style={{ marginBottom: 24 }}>
              <h3>Delivery slots</h3>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <input type="text" placeholder="Slot label" value={slotDraft.label} onChange={(e) => setSlotDraft((prev) => ({ ...prev, label: e.target.value }))} />
                <input type="datetime-local" value={slotDraft.start} onChange={(e) => setSlotDraft((prev) => ({ ...prev, start: e.target.value }))} />
                <input type="datetime-local" value={slotDraft.end} onChange={(e) => setSlotDraft((prev) => ({ ...prev, end: e.target.value }))} />
                <input type="text" placeholder="Notes" value={slotDraft.notes} onChange={(e) => setSlotDraft((prev) => ({ ...prev, notes: e.target.value }))} />
                <button type="button" onClick={handleAddSlot} className="secondary-button">Add slot</button>
              </div>
              {deliverySlots.length > 0 && (
                <ul style={{ marginTop: 12 }}>
                  {deliverySlots.map((slot) => (
                    <li key={slot.id}>
                      <strong>{slot.label}</strong> · {new Date(slot.startTime).toLocaleString()} — {new Date(slot.endTime).toLocaleString()}
                      <button type="button" onClick={() => removeSlot(slot.id)} style={{ marginLeft: 8 }}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={{ marginBottom: 24 }}>
              <h3>Menu plan</h3>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <input type="text" placeholder="Item group" value={itemDraft.name} onChange={(e) => setItemDraft((prev) => ({ ...prev, name: e.target.value }))} />
                <input type="number" min="0" placeholder="Quantity" value={itemDraft.quantity} onChange={(e) => setItemDraft((prev) => ({ ...prev, quantity: e.target.value }))} />
                <input type="number" min="0" placeholder="Unit price" value={itemDraft.unitPrice} onChange={(e) => setItemDraft((prev) => ({ ...prev, unitPrice: e.target.value }))} />
                <input type="text" placeholder="Notes" value={itemDraft.notes} onChange={(e) => setItemDraft((prev) => ({ ...prev, notes: e.target.value }))} />
                <button type="button" onClick={handleAddItemGroup} className="secondary-button">Add item</button>
              </div>
              {itemGroups.length > 0 && (
                <table style={{ width: "100%", marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Name</th>
                      <th>Quantity</th>
                      <th>Unit price</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {itemGroups.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td style={{ textAlign: "center" }}>{item.quantity}</td>
                        <td style={{ textAlign: "center" }}>₹{item.unitPrice}</td>
                        <td>{item.notes}</td>
                        <td style={{ textAlign: "center" }}>
                          <button type="button" onClick={() => removeItemGroup(item.id)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section style={{ marginBottom: 24 }}>
              <h3>Attendee groups</h3>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <input type="text" placeholder="Group label" value={attendeeDraft.label} onChange={(e) => setAttendeeDraft((prev) => ({ ...prev, label: e.target.value }))} />
                <input type="number" min="0" placeholder="Count" value={attendeeDraft.count} onChange={(e) => setAttendeeDraft((prev) => ({ ...prev, count: e.target.value }))} />
                <input type="text" placeholder="Notes" value={attendeeDraft.notes} onChange={(e) => setAttendeeDraft((prev) => ({ ...prev, notes: e.target.value }))} />
                <button type="button" onClick={handleAddAttendeeGroup} className="secondary-button">Add group</button>
              </div>
              {attendeeGroups.length > 0 && (
                <ul style={{ marginTop: 12 }}>
                  {attendeeGroups.map((group) => (
                    <li key={group.id}>
                      {group.label} · {group.count || "—"}
                      <button type="button" onClick={() => removeAttendee(group.id)} style={{ marginLeft: 8 }}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section style={{ marginBottom: 24 }}>
              <h3>Organizer & vendor preferences</h3>
              <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <label>
                  Organizer name
                  <input type="text" value={form.organizerName} onChange={(e) => setForm((prev) => ({ ...prev, organizerName: e.target.value }))} />
                </label>
                <label>
                  Organizer email
                  <input type="email" value={form.organizerEmail} onChange={(e) => setForm((prev) => ({ ...prev, organizerEmail: e.target.value }))} />
                </label>
                <label>
                  Organizer mobile
                  <input type="tel" value={form.organizerMobile} onChange={(e) => setForm((prev) => ({ ...prev, organizerMobile: e.target.value }))} />
                </label>
                <label>
                  Preferred vendors (comma separated)
                  <textarea value={form.requestedVendorsText} onChange={(e) => setForm((prev) => ({ ...prev, requestedVendorsText: e.target.value }))} rows={2} />
                </label>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label>
                  Pricing mode
                  <select value={form.pricingType} onChange={(e) => setForm((prev) => ({ ...prev, pricingType: e.target.value }))}>
                    {pricingModes.map((mode) => (
                      <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Bulk discount %
                  <input type="number" min="0" max="100" value={form.bulkDiscountPercent} onChange={(e) => setForm((prev) => ({ ...prev, bulkDiscountPercent: e.target.value }))} />
                </label>
                <label>
                  Flat rate (₹)
                  <input type="number" min="0" value={form.bulkFlatRate} onChange={(e) => setForm((prev) => ({ ...prev, bulkFlatRate: e.target.value }))} />
                </label>
              </div>
            </section>

            <section style={{ marginBottom: 24 }}>
              <h3>Additional notes</h3>
              <textarea
                value={form.specialInstructions}
                onChange={(e) => setForm((prev) => ({ ...prev, specialInstructions: e.target.value }))}
                placeholder="Dietary preferences, seating notes, setup instructions..."
                rows={3}
              />
              <textarea
                style={{ marginTop: 12 }}
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Internal notes for reference"
                rows={3}
              />
            </section>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button type="button" onClick={resetWizard} className="secondary-button">Reset</button>
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit bulk order"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button className={selectedStatus === "upcoming" ? "primary-button" : "secondary-button"} onClick={() => setSelectedStatus("upcoming")}>Upcoming</button>
            <button className={selectedStatus === "past" ? "primary-button" : "secondary-button"} onClick={() => setSelectedStatus("past")}>Past</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={loadOrders} className="secondary-button">Refresh</button>
          </div>
        </div>

        {loading && <div>Loading bulk orders…</div>}
        {error && <div style={{ color: "#c0392b" }}>{error}</div>}
        {!loading && selectedOrders.length === 0 && !error && (
          <div style={{ background: "#f8f9fa", padding: 24, borderRadius: 12 }}>
            No {selectedStatus === "upcoming" ? "upcoming" : "historical"} bulk orders yet.
            <button style={{ marginLeft: 12 }} className="secondary-button" onClick={() => setWizardOpen(true)}>Plan one</button>
          </div>
        )}

        {!loading && selectedOrders.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {selectedOrders.map(renderOrderCard)}
          </div>
        )}
      </div>

      {renderSelectedOrderDetails()}
    </div>
  );
};

BulkOrderPortal.propTypes = {
  token: PropTypes.string.isRequired,
  employeeRole: PropTypes.shape({
    role: PropTypes.string,
    roleSlug: PropTypes.string,
    department: PropTypes.string,
    bulkOrderEligible: PropTypes.bool,
  }),
  onClose: PropTypes.func.isRequired,
};

export default BulkOrderPortal;
