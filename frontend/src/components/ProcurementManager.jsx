import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  fetchRecommendations,
  fetchHeadcountEntries,
  submitHeadcount,
  fetchProcurementTemplates,
  createProcurementTemplate,
  updateProcurementTemplate,
  deleteProcurementTemplate,
  fetchProcurementOrders,
  createProcurementOrder,
  fetchForecast,
} from "../api";

const formatNumber = (value, digits = 0) => Number(value || 0).toLocaleString("en-IN", {
  maximumFractionDigits: digits,
  minimumFractionDigits: digits,
});

const ProcurementManager = ({ token }) => {
  const [recommendationsState, setRecommendationsState] = useState({ loading: false, error: null, data: null });
  const [headcountEntries, setHeadcountEntries] = useState([]);
  const [headcountValue, setHeadcountValue] = useState(0);
  const [submittingHeadcount, setSubmittingHeadcount] = useState(false);

  const [templatesState, setTemplatesState] = useState({ loading: false, error: null, list: [] });
  const [ordersState, setOrdersState] = useState({ loading: false, error: null, list: [] });
  const [forecastState, setForecastState] = useState({ loading: false, error: null, data: null });

  const [view, setView] = useState("overview");
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [templateDraft, setTemplateDraft] = useState({ title: "", description: "", items: [] });

  const [orderDraft, setOrderDraft] = useState({ supplier: "", dueDate: "", notes: "", items: [], recommendationsSource: null });
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [uiError, setUiError] = useState(null);

  const loadRecommendations = useCallback(async () => {
    setRecommendationsState({ loading: true, error: null, data: null });
    try {
      const data = await fetchRecommendations(token);
      setRecommendationsState({ loading: false, error: null, data });
    } catch (error) {
      setRecommendationsState({ loading: false, error: error.message || "Failed to fetch recommendations", data: null });
    }
  }, [token]);

  const loadHeadcount = useCallback(async () => {
    try {
      const response = await fetchHeadcountEntries(token);
      if (response && Array.isArray(response.entries)) {
        setHeadcountEntries(response.entries);
        if (response.entries.length > 0) {
          setHeadcountValue(Number(response.entries[0].headcount || 0));
        }
      }
    } catch (error) {
      console.error("Failed to load headcount", error);
    }
  }, [token]);

  const loadTemplates = useCallback(async () => {
    setTemplatesState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetchProcurementTemplates(token);
      setTemplatesState({ loading: false, error: null, list: response.templates || [] });
    } catch (error) {
      setTemplatesState({ loading: false, error: error.message || "Failed to load templates", list: [] });
    }
  }, [token]);

  const loadOrders = useCallback(async () => {
    setOrdersState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetchProcurementOrders(token);
      setOrdersState({ loading: false, error: null, list: response.orders || [] });
    } catch (error) {
      setOrdersState({ loading: false, error: error.message || "Failed to load procurement orders", list: [] });
    }
  }, [token]);

  const loadForecast = useCallback(async () => {
    setForecastState({ loading: true, error: null, data: null });
    try {
      const data = await fetchForecast(token);
      setForecastState({ loading: false, error: null, data });
    } catch (error) {
      setForecastState({ loading: false, error: error.message || "Failed to load forecast", data: null });
    }
  }, [token]);

  useEffect(() => {
    loadRecommendations();
    loadHeadcount();
    loadTemplates();
    loadOrders();
    loadForecast();
  }, [loadRecommendations, loadHeadcount, loadTemplates, loadOrders, loadForecast]);

  const resetUiError = () => setUiError(null);

  const startNewTemplate = () => {
    resetUiError();
    setEditingTemplateId(null);
    setTemplateDraft({ title: "", description: "", items: [] });
    setView("template-editor");
  };

  const editTemplate = (template) => {
    resetUiError();
    setEditingTemplateId(template.id);
    setTemplateDraft({
      title: template.title || "",
      description: template.description || "",
      items: Array.isArray(template.items) ? template.items.map((item) => ({ ...item })) : [],
    });
    setView("template-editor");
  };

  const deleteTemplateHandler = async (templateId) => {
    if (!templateId) return;
    resetUiError();
    try {
      await deleteProcurementTemplate(token, templateId);
      await loadTemplates();
    } catch (error) {
      setUiError(error.message || "Failed to delete template");
    }
  };

  const addTemplateItem = () => {
    setTemplateDraft((prev) => ({
      ...prev,
      items: [...prev.items, { itemName: "", itemId: "", quantity: 0, unit: "" }],
    }));
  };

  const updateTemplateItem = (index, changes) => {
    setTemplateDraft((prev) => {
      const nextItems = prev.items.map((item, idx) => (idx === index ? { ...item, ...changes } : item));
      return { ...prev, items: nextItems };
    });
  };

  const removeTemplateItem = (index) => {
    setTemplateDraft((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }));
  };

  const saveTemplate = async (event) => {
    event.preventDefault();
    resetUiError();
    try {
      if (editingTemplateId) {
        await updateProcurementTemplate(token, editingTemplateId, templateDraft);
      } else {
        await createProcurementTemplate(token, templateDraft);
      }
      await loadTemplates();
      setView("overview");
    } catch (error) {
      setUiError(error.message || "Failed to save template");
    }
  };

  const startOrderFromRecommendations = () => {
    if (recommendations.length === 0) return;
    resetUiError();
    const seededItems = recommendations.map((rec) => ({
      itemName: rec.itemName || `Item ${rec.itemId}`,
      itemId: rec.itemId || "",
      quantity: rec.suggestedRestock || 0,
      unit: "units",
      source: "recommendation",
    }));
    setOrderDraft({ supplier: "", dueDate: "", notes: "", items: seededItems, recommendationsSource: "analytics" });
    setView("order-editor");
  };

  const startOrderFromTemplate = (template) => {
    resetUiError();
    const items = Array.isArray(template.items)
      ? template.items.map((item) => ({
          itemName: item.itemName || "",
          itemId: item.itemId || "",
          quantity: item.quantity || 0,
          unit: item.unit || "units",
          source: `template:${template.id}`,
        }))
      : [];
    setOrderDraft({ supplier: "", dueDate: "", notes: template.description || "", items, recommendationsSource: `template:${template.id}` });
    setView("order-editor");
  };

  const addOrderItem = () => {
    setOrderDraft((prev) => ({
      ...prev,
      items: [...prev.items, { itemName: "", itemId: "", quantity: 0, unit: "" }],
    }));
  };

  const updateOrderItem = (index, changes) => {
    setOrderDraft((prev) => {
      const nextItems = prev.items.map((item, idx) => (idx === index ? { ...item, ...changes } : item));
      return { ...prev, items: nextItems };
    });
  };

  const removeOrderItem = (index) => {
    setOrderDraft((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }));
  };

  const createOrder = async (event) => {
    event.preventDefault();
    resetUiError();
    setCreatingOrder(true);
    try {
      await createProcurementOrder(token, orderDraft);
      await loadOrders();
      setView("overview");
    } catch (error) {
      setUiError(error.message || "Failed to create procurement order");
    } finally {
      setCreatingOrder(false);
    }
  };

  const recommendations = useMemo(() => recommendationsState.data?.recommendations || [], [recommendationsState]);
  const forecastEntries = useMemo(() => forecastState.data?.baseline || [], [forecastState]);
  const forecastAlerts = useMemo(() => {
    if (!Array.isArray(forecastEntries) || forecastEntries.length === 0) return [];
    const threshold = Number(import.meta.env.VITE_FORECAST_ALERT_THRESHOLD || 50);
    return forecastEntries
      .filter((entry) => entry.projectedOrders >= threshold)
      .map((entry) => ({
        dayOffset: entry.dayOffset,
        projectedOrders: entry.projectedOrders,
      }));
  }, [forecastEntries]);

  const recommendationByItem = useMemo(() => {
    const map = new Map();
    recommendations.forEach((item) => {
      if (item?.itemId != null) {
        map.set(String(item.itemId), item);
      }
    });
    return map;
  }, [recommendations]);

  const handleHeadcountSubmit = async (event) => {
    event.preventDefault();
    const numeric = Number(headcountValue);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      alert("Please enter a positive headcount value");
      return;
    }
    setSubmittingHeadcount(true);
    try {
      await submitHeadcount(token, numeric);
      await loadHeadcount();
      await loadRecommendations();
      alert("Headcount updated successfully");
    } catch (error) {
      alert(error.message || "Failed to update headcount");
    } finally {
      setSubmittingHeadcount(false);
    }
  };

  const renderOverview = () => (
    <div className="procurement-overview" style={{ display: "grid", gap: 16 }}>
      {forecastAlerts.length > 0 && (
        <section
          className="card"
          style={{
            borderLeft: "4px solid #e67e22",
            background: "#fef5e7",
          }}
        >
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Upcoming Demand Alert</h3>
            <button type="button" onClick={loadForecast} disabled={forecastState.loading}>
              {forecastState.loading ? "Refreshing…" : "Refresh Forecast"}
            </button>
          </div>
          <ul style={{ marginTop: 8 }}>
            {forecastAlerts.map((alert) => (
              <li key={alert.dayOffset}>
                Day +{alert.dayOffset}: projected {Math.round(alert.projectedOrders)} orders across menu. Prepare procurement accordingly.
              </li>
            ))}
          </ul>
          {forecastState.error && (
            <div style={{ fontSize: 12, color: "#c0392b", marginTop: 6 }}>{forecastState.error}</div>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Workforce Headcount</h3>
          <form onSubmit={handleHeadcountSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min="1"
              value={headcountValue}
              onChange={(e) => setHeadcountValue(e.target.value)}
              required
              style={{ width: 120 }}
            />
            <button type="submit" disabled={submittingHeadcount}>
              {submittingHeadcount ? "Saving…" : "Update"}
            </button>
          </form>
        </div>
        <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
          <strong>Recent Updates</strong>
          <ul style={{ marginTop: 6 }}>
            {headcountEntries.length === 0 && <li>No headcount submitted yet.</li>}
            {headcountEntries.slice(0, 5).map((entry, idx) => (
              <li key={idx}>
                {entry.headcount} people · {new Date(entry.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                {entry.source ? ` (${entry.source})` : ""}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Restock Recommendations</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={loadRecommendations} disabled={recommendationsState.loading}>Refresh</button>
            <button onClick={startOrderFromRecommendations} disabled={recommendations.length === 0}>Create Order</button>
          </div>
        </div>
        {recommendationsState.loading ? (
          <div>Loading recommendations…</div>
        ) : recommendationsState.error ? (
          <div className="error">{recommendationsState.error}</div>
        ) : recommendations.length === 0 ? (
          <div>No recommendations available yet. Update headcount or wait for analytics data.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Avg Daily Consumption</th>
                  <th>Expected Demand ({recommendationsState.data?.forecastWindowDays || 7} days)</th>
                  <th>Current Inventory</th>
                  <th>Suggested Restock</th>
                  <th>Safety Stock</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((rec) => (
                  <tr key={rec.itemId || rec.itemName}>
                    <td>{rec.itemName || `Item ${rec.itemId}`}</td>
                    <td>{formatNumber(rec.averageDailyConsumption, 2)}</td>
                    <td>{formatNumber(rec.expectedConsumption, 2)}</td>
                    <td>{rec.currentInventory != null ? formatNumber(rec.currentInventory) : "—"}</td>
                    <td><strong>{formatNumber(rec.suggestedRestock)}</strong></td>
                    <td>{formatNumber(rec.safetyStock, 2)}</td>
                    <td>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {(rec.rationale || []).map((line, idx) => (
                          <li key={idx}>{line}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Forecast Snapshot</h3>
          <span style={{ fontSize: 12, color: "#777" }}>
            Horizon: {forecastState.data?.horizonDays || 0} days · Generated {forecastState.data?.generatedAt ? new Date(forecastState.data.generatedAt).toLocaleString() : "--"}
          </span>
        </div>
        {forecastState.loading ? (
          <div>Loading forecast…</div>
        ) : forecastState.error ? (
          <div className="error">{forecastState.error}</div>
        ) : forecastEntries.length === 0 ? (
          <div>No forecast data yet. Ensure recent activity is captured.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Day Offset</th>
                  <th>Projected Orders</th>
                  <th>Linked Recommendations</th>
                </tr>
              </thead>
              <tbody>
                {forecastEntries.map((entry) => (
                  <tr key={entry.dayOffset}>
                    <td>Day +{entry.dayOffset}</td>
                    <td>{formatNumber(entry.projectedOrders, 1)}</td>
                    <td>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {(forecastState.data?.recommendations || [])
                          .filter((rec) => rec.suggestedRestock > 0)
                          .slice(0, 5)
                          .map((rec) => (
                            <li key={rec.itemId || rec.itemName}>
                              {rec.itemName || `Item ${rec.itemId}`} · restock {formatNumber(rec.suggestedRestock)}
                            </li>
                          ))}
                        {forecastState.data?.recommendations?.length > 5 && <li>…more</li>}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );

  const renderTemplatesPanel = () => (
    <section className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Procurement Templates</h3>
        <button onClick={startNewTemplate}>New Template</button>
      </div>
      {templatesState.loading ? (
        <div>Loading templates…</div>
      ) : templatesState.error ? (
        <div className="error">{templatesState.error}</div>
      ) : templatesState.list.length === 0 ? (
        <div>No templates yet. Use recommendations to seed your first template.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", marginTop: 12 }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Description</th>
                <th>Items</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templatesState.list.map((tpl) => (
                <tr key={tpl.id}>
                  <td>{tpl.title}</td>
                  <td>{tpl.description || "—"}</td>
                  <td>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                      {(tpl.items || []).map((item, idx) => (
                        <li key={idx}>
                          {item.itemName || item.itemId || "Item"} · {formatNumber(item.quantity)} {item.unit || "units"}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{tpl.updatedAt ? new Date(tpl.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                  <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => startOrderFromTemplate(tpl)}>Use Template</button>
                    <button onClick={() => editTemplate(tpl)}>Edit</button>
                    <button onClick={() => deleteTemplateHandler(tpl.id)} style={{ background: "#e74c3c", color: "#fff" }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const renderOrdersPanel = () => (
    <section className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Procurement Orders</h3>
        <button onClick={startOrderFromRecommendations} disabled={recommendations.length === 0}>
          New Order
        </button>
      </div>
      {ordersState.loading ? (
        <div>Loading procurement orders…</div>
      ) : ordersState.error ? (
        <div className="error">{ordersState.error}</div>
      ) : ordersState.list.length === 0 ? (
        <div>No procurement orders yet. Use recommendations or a template to create your first order.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", marginTop: 12 }}>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Supplier</th>
                <th>Due Date</th>
                <th>Items</th>
                <th>Notes</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {ordersState.list.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.supplier || "—"}</td>
                  <td>{order.dueDate ? new Date(order.dueDate).toLocaleDateString("en-IN") : "—"}</td>
                  <td>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                      {(order.items || []).map((item, idx) => (
                        <li key={idx}>
                          {item.itemName || item.itemId || "Item"} · {formatNumber(item.quantity)} {item.unit || "units"}
                          {item.source ? ` (${item.source})` : ""}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{order.notes || "—"}</td>
                  <td>{order.createdAt ? new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const renderTemplateEditor = () => (
    <div className="card" style={{ display: "grid", gap: 16 }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>{editingTemplateId ? "Edit Template" : "New Template"}</h3>
        <button onClick={() => setView("overview")}>Back</button>
      </div>
      <form onSubmit={saveTemplate} className="template-form" style={{ display: "grid", gap: 12 }}>
        <label>
          Title
          <input
            type="text"
            value={templateDraft.title}
            onChange={(e) => setTemplateDraft((prev) => ({ ...prev, title: e.target.value }))}
            required
          />
        </label>
        <label>
          Description
          <textarea
            value={templateDraft.description}
            onChange={(e) => setTemplateDraft((prev) => ({ ...prev, description: e.target.value }))}
            rows={2}
          />
        </label>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong>Items</strong>
            <button type="button" onClick={addTemplateItem}>Add Item</button>
          </div>
          {templateDraft.items.length === 0 && <div style={{ fontSize: 12, color: "#777" }}>No items yet.</div>}
          {templateDraft.items.map((item, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 0.6fr 0.6fr auto", gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                placeholder="Item name"
                value={item.itemName}
                onChange={(e) => updateTemplateItem(idx, { itemName: e.target.value })}
              />
              <input
                type="text"
                placeholder="Item ID"
                value={item.itemId || ""}
                onChange={(e) => updateTemplateItem(idx, { itemId: e.target.value })}
              />
              <input
                type="number"
                min="0"
                placeholder="Qty"
                value={item.quantity}
                onChange={(e) => updateTemplateItem(idx, { quantity: e.target.value })}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  type="text"
                  value={item.unit}
                  onChange={(e) => updateTemplateItem(idx, { unit: e.target.value })}
                  placeholder="Unit"
                  style={{ width: 80 }}
                />
                <button type="button" onClick={() => removeTemplateItem(idx)} style={{ background: "#e74c3c", color: "#fff" }}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit">{editingTemplateId ? "Save Changes" : "Create Template"}</button>
          <button type="button" onClick={() => setView("overview")}>Cancel</button>
        </div>
      </form>
    </div>
  );

  const renderOrderEditor = () => (
    <div className="card" style={{ display: "grid", gap: 16 }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>New Procurement Order</h3>
        <button onClick={() => setView("overview")}>Back</button>
      </div>
      <form onSubmit={createOrder} className="order-form" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <label>
            Supplier
            <input
              type="text"
              value={orderDraft.supplier}
              onChange={(e) => setOrderDraft((prev) => ({ ...prev, supplier: e.target.value }))}
              placeholder="Supplier name or contact"
            />
          </label>
          <label>
            Due Date
            <input
              type="date"
              value={orderDraft.dueDate}
              onChange={(e) => setOrderDraft((prev) => ({ ...prev, dueDate: e.target.value }))}
            />
          </label>
        </div>
        <label>
          Notes
          <textarea
            rows={3}
            value={orderDraft.notes}
            onChange={(e) => setOrderDraft((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Instructions for supplier"
          />
        </label>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong>Order Items</strong>
            <button type="button" onClick={addOrderItem}>Add Item</button>
          </div>
          {orderDraft.items.length === 0 && <div style={{ fontSize: 12, color: "#777" }}>No items yet.</div>}
          {orderDraft.items.map((item, idx) => (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 0.6fr 0.5fr auto", gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                placeholder="Item name"
                value={item.itemName}
                onChange={(e) => updateOrderItem(idx, { itemName: e.target.value })}
              />
              <input
                type="text"
                placeholder="Item ID"
                value={item.itemId || ""}
                onChange={(e) => updateOrderItem(idx, { itemId: e.target.value })}
              />
              <input
                type="number"
                min="0"
                placeholder="Qty"
                value={item.quantity}
                onChange={(e) => updateOrderItem(idx, { quantity: e.target.value })}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  type="text"
                  value={item.unit}
                  onChange={(e) => updateOrderItem(idx, { unit: e.target.value })}
                  placeholder="Unit"
                  style={{ width: 80 }}
                />
                <button type="button" onClick={() => removeOrderItem(idx)} style={{ background: "#e74c3c", color: "#fff" }}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={creatingOrder}>{creatingOrder ? "Creating…" : "Create Order"}</button>
          <button type="button" onClick={() => setView("overview")}>Cancel</button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="procurement-manager" style={{ display: "grid", gap: 16 }}>
      <div className="view-selector" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setView("overview")} className={view === "overview" ? "active" : ""}>Overview</button>
        <button onClick={startNewTemplate}>New Template</button>
        <button onClick={startOrderFromRecommendations} disabled={recommendations.length === 0}>New Order</button>
      </div>

      {uiError && (
        <div className="error" style={{ background: "#fdecea", border: "1px solid #f5c6cb", color: "#721c24", padding: 12, borderRadius: 8 }}>
          {uiError}
        </div>
      )}

      {view === "overview" && (
        <>
          {renderOverview()}
          {renderTemplatesPanel()}
          {renderOrdersPanel()}
        </>
      )}

      {view === "template-editor" && renderTemplateEditor()}

      {view === "order-editor" && renderOrderEditor()}
    </div>
  );
};

ProcurementManager.propTypes = {
  token: PropTypes.string.isRequired,
};

export default ProcurementManager;
