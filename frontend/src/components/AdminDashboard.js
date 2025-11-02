import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  fetchOrders,
  markOrderReady,
  fetchMenu,
  extendOrderPrep,
  markOrderPicked,
  revokeOrderExtension,
  fetchBulkOrders,
  postBulkOrderVendorMessage,
  confirmBulkOrderSlot,
  updateMenu,
} from "../api";

const DEFAULT_PREP_MINUTES = 5;
const MAX_LOAD_MULTIPLIER = 3;

const coerceNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const formatCountdown = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
};

const formatMinutes = (minutes) => {
  const rounded = Math.round(minutes * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}m` : `${rounded.toFixed(1)}m`;
};

const computeCustomizationExtraMinutes = (customization) => {
  if (!customization) return 0;
  let extra = 0;
  if (customization.extraPrepMinutes != null) {
    extra += coerceNumber(customization.extraPrepMinutes, 0);
  }
  const cookLevel = String(customization.cookLevel || "").toLowerCase();
  if (cookLevel === "well-done" || cookLevel === "extra-crispy") {
    extra += 2;
  }
  const notes = String(customization.notes || "").toLowerCase();
  if (notes.includes("extra")) {
    extra += 1;
  }
  if (notes.includes("very hot") || notes.includes("very spicy")) {
    extra += 1;
  }
  return extra;
};

const buildPrepTimesByShop = (menu) => {
  const map = new Map();
  const addItem = (shopMap, item) => {
    if (!item || item.id == null) return;
    const itemId = String(item.id);
    const prep = coerceNumber(item.prepTime, DEFAULT_PREP_MINUTES);
    if (!shopMap.has(itemId)) {
      shopMap.set(itemId, prep);
    }
  };
  (menu || []).forEach((shop) => {
    if (!shop) return;
    const shopMap = new Map();
    if (Array.isArray(shop.items)) {
      shop.items.forEach((item) => addItem(shopMap, item));
    }
    if (Array.isArray(shop.categories)) {
      shop.categories.forEach((category) => {
        if (!Array.isArray(category?.items)) return;
        category.items.forEach((item) => addItem(shopMap, item));
      });
    }
    map.set(String(shop.shopId), shopMap);
  });
  return map;
};

const computeItemPrepMinutes = (item, orderShopId, prepTimesByShop) => {
  const quantity = Math.max(1, coerceNumber(item?.quantity, 1));
  const shopPrepMap = prepTimesByShop.get(String(orderShopId));
  const lookupPrep = shopPrepMap?.get(String(item?.id));
  const basePrep = coerceNumber(item?.prepTime, lookupPrep ?? DEFAULT_PREP_MINUTES);
  const extra = computeCustomizationExtraMinutes(item?.customization);
  const perUnit = Math.max(basePrep + extra, DEFAULT_PREP_MINUTES);
  return perUnit * quantity;
};

const computeVendorLoadMultiplier = ({ order, pendingOrdersCount, now }) => {
  if (order?.vendorLoadMultiplier != null) {
    const direct = coerceNumber(order.vendorLoadMultiplier, 1);
    return Math.min(Math.max(direct, 0.5), MAX_LOAD_MULTIPLIER);
  }

  let multiplier = 1;

  if (pendingOrdersCount > 0) {
    const queuePressure = Math.min(0.75, pendingOrdersCount * 0.05);
    multiplier += queuePressure;
  }

  const referenceTime = order?.scheduledTime ? Date.parse(order.scheduledTime) : now;
  const date = new Date(Number.isNaN(referenceTime) ? now : referenceTime);
  const hour = date.getHours();
  if ((hour >= 7 && hour < 9) || (hour >= 12 && hour < 15) || (hour >= 19 && hour < 21)) {
    multiplier += 0.2;
  }

  if (order?.loadTags && Array.isArray(order.loadTags)) {
    if (order.loadTags.includes("high-traffic")) multiplier += 0.15;
    if (order.loadTags.includes("staff-shortage")) multiplier += 0.1;
  }

  if (order?.loadMultiplierOverride != null) {
    multiplier = coerceNumber(order.loadMultiplierOverride, multiplier);
  }

  return Math.min(Math.max(multiplier, 0.5), MAX_LOAD_MULTIPLIER);
};

const computeOrderCountdown = (order, { now, pendingOrdersCount, prepTimesByShop }) => {
  if (!order) return null;

  const items = Array.isArray(order.items) ? order.items : [];
  let maxItemPrepMinutes = 0;
  items.forEach((item) => {
    maxItemPrepMinutes = Math.max(maxItemPrepMinutes, computeItemPrepMinutes(item, order.shopId, prepTimesByShop));
  });

  const derivedPrep = Math.max(maxItemPrepMinutes, DEFAULT_PREP_MINUTES);
  const basePrepMinutes = order?.basePrepTime != null
    ? Math.max(coerceNumber(order.basePrepTime, DEFAULT_PREP_MINUTES), DEFAULT_PREP_MINUTES)
    : derivedPrep;
  const effectivePrepMinutes = order?.prepTime != null
    ? Math.max(coerceNumber(order.prepTime, basePrepMinutes), basePrepMinutes)
    : basePrepMinutes;

  const vendorLoadMultiplier = computeVendorLoadMultiplier({ order, pendingOrdersCount, now });
  const estimatedReady = order?.estimatedReadyTime ? Date.parse(order.estimatedReadyTime) : NaN;
  const scheduledTimeValue = order?.scheduledTime ? Date.parse(order.scheduledTime) : NaN;
  const createdAtValue = order?.createdAt ? Date.parse(order.createdAt) : NaN;

  const orderTypeRaw = order?.orderType ? String(order.orderType).toLowerCase() : null;
  const inferredType = orderTypeRaw || (!Number.isNaN(scheduledTimeValue) ? "pre-order" : "live");
  const orderType = inferredType === "pre-order" ? "pre-order" : "live";

  let targetTime = !Number.isNaN(estimatedReady)
    ? estimatedReady
    : (() => {
        const baseStart = !Number.isNaN(createdAtValue) ? createdAtValue : now;
        const adjustedPrepMinutes = effectivePrepMinutes * vendorLoadMultiplier;
        return baseStart + adjustedPrepMinutes * 60000;
      })();

  if (orderType === "pre-order" && !Number.isNaN(scheduledTimeValue)) {
    targetTime = Math.max(targetTime, scheduledTimeValue);
  }

  const prepDurationMs = effectivePrepMinutes * 60000;
  let startTime = targetTime - prepDurationMs;
  if (Number.isNaN(startTime) || !Number.isFinite(startTime)) {
    startTime = !Number.isNaN(createdAtValue) ? createdAtValue : now;
  }

  const timeUntilReady = targetTime - now;
  const timeUntilStart = startTime - now;
  const displayCountdownMs = timeUntilStart > 0 ? timeUntilStart : timeUntilReady;

  let status = "in-progress";
  let prefix = "Ready in";
  let message = "Serve by";

  if (timeUntilStart > 0) {
    status = "waiting";
    prefix = "Prep starts in";
  } else if (timeUntilReady <= 0) {
    status = "overdue";
    prefix = "Prep window elapsed";
    message = "Expected ready";
  }

  const helperParts = [];
  helperParts.push(`Prep ${formatMinutes(effectivePrepMinutes)}`);
  const extensionMinutes = coerceNumber(order?.etaExtensionMinutes, 0);
  if (extensionMinutes > 0) {
    helperParts.push(`Extended +${extensionMinutes}m`);
  }
  if (Number.isFinite(vendorLoadMultiplier) && !Number.isNaN(vendorLoadMultiplier) && vendorLoadMultiplier !== 1 && Number.isNaN(estimatedReady)) {
    helperParts.push(`Load ×${vendorLoadMultiplier.toFixed(2)}`);
  }
  if (!Number.isNaN(targetTime)) {
    helperParts.push(`ETA ${new Date(targetTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`);
  }

  return {
    orderId: order.id,
    orderType,
    basePrepMinutes,
    adjustedPrepMinutes: effectivePrepMinutes,
    vendorLoadMultiplier,
    countdownMs: timeUntilReady,
    displayCountdownMs,
    startTime,
    targetTime,
    status,
    label: formatCountdown(Math.max(displayCountdownMs, 0)),
    prefix,
    message,
    helperText: helperParts.join(" · "),
    domId: `order-countdown-${order.id}`
  };
};

const CountdownDisplay = ({ info }) => {
  if (!info) {
    return <span style={{ color: "#999" }}>—</span>;
  }

  const color = info.status === "overdue" ? "#e74c3c" : info.status === "waiting" ? "#2980b9" : "#2c3e50";
  const timerStyle = {
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    fontSize: 18,
    letterSpacing: 1,
    color,
  };
  const primaryText = `${info.prefix}:`;
  const secondaryPrefix = info.status === "overdue" && info.message ? `${info.message}: ` : "ETA: ";
  const secondaryValue = !Number.isNaN(info.targetTime)
    ? new Date(info.targetTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div id={info.domId} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }} aria-live="polite">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, color }}>{primaryText}</span>
        <span style={timerStyle}>{info.label}</span>
      </div>
      {secondaryValue && (
        <span style={{ fontSize: 11, color: "#8e44ad" }}>{secondaryPrefix}{secondaryValue}</span>
      )}
      <span style={{ fontSize: 11, color: "#7f8c8d" }}>{info.helperText}</span>
    </div>
  );
};

/**
 * AdminDashboard
 * Displays vendor's live orders with tabs (Current/Ready/Completed), sorting and actions.
 * @param {{ token: string }} props
 */

const AdminDashboard = ({ token }) => {
  const [orders, setOrders] = useState([]);
  const [menu, setMenu] = useState([]);
  const [tab, setTab] = useState("current");
  const [muted, setMuted] = useState(false);
  const [bulkOrders, setBulkOrders] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const OVERDUE_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";
  // Low stock toggle
  const [showLowStock, setShowLowStock] = useState(false);
  const [lowStockThreshold] = useState(10);
  const overdueNotifiedRef = useRef(new Set());
  const vendorShopId = (() => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.shopId || null;
    } catch { return null; }
  })();

  const loadOrders = useCallback(() => {
    fetchOrders(token).then(setOrders);
  }, [token]);

  useEffect(() => {
    loadOrders();
    fetchMenu().then(setMenu);
    if (!localStorage.getItem('vendorSoundFirstLoginDone')) {
      try { localStorage.setItem('vendorSoundFirstLoginDone', '1'); } catch {}
    }
    const interval = setInterval(() => loadOrders(), 5000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  // tick every second for countdown rendering
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // per-item restock handled via Menu Editor; see low-stock table button below

  const prepTimesByShop = useMemo(() => buildPrepTimesByShop(menu), [menu]);

  const pendingOrdersCount = useMemo(
    () => orders.filter((o) => o.status === 'pending').length,
    [orders]
  );

  const countdownMap = useMemo(() => {
    const now = Date.now() + tick * 0;
    const map = new Map();
    orders.forEach((order) => {
      const info = computeOrderCountdown(order, { now, pendingOrdersCount, prepTimesByShop });
      if (info) {
        map.set(order.id, info);
      }
    });
    return map;
  }, [orders, pendingOrdersCount, prepTimesByShop, tick]);

  const remainingTime = useCallback(
    (order) => {
      const info = countdownMap.get(order.id);
      return info ? info.countdownMs : null;
    },
    [countdownMap]
  );

  // Play overdue sound once when an order first becomes overdue
  useEffect(() => {
    const overduePending = orders.filter((o) => {
      if (o.status !== 'pending') return false;
      const info = countdownMap.get(o.id);
      return info && info.orderType === 'live' && info.countdownMs != null && info.countdownMs < 0;
    });
    overduePending.forEach(o => {
      if (!overdueNotifiedRef.current.has(o.id)) {
        overdueNotifiedRef.current.add(o.id);
        if (!muted) {
          try { new Audio(OVERDUE_SOUND).play(); } catch {}
        }
      }
    });
  }, [orders, countdownMap, tick, muted]);

  const handleBulkExtend = async (mins) => {
    const targets = orders.filter(o => o.status === 'pending');
    if (targets.length === 0) return;
    const ok = window.confirm(`Extend all ${targets.length} pending orders by ${mins} minutes?`);
    if (!ok) return;
    await Promise.all(targets.map(o => extendOrderPrep(o.id, mins, token)));
    loadOrders();
  };

  const getShopName = (shopId) =>
    menu.find((s) => s.shopId === shopId)?.shopName || shopId;
  const vendorShopName = getShopName(vendorShopId);
  const [bulkMins, setBulkMins] = useState(5);
  const lowStockItems = useMemo(() => {
    const shop = menu.find(s => s.shopId === vendorShopId);
    if (!shop || !Array.isArray(shop.items)) return [];
    return shop.items.filter(it => Number(it.inventory ?? 100) <= Number(lowStockThreshold));
  }, [menu, vendorShopId, lowStockThreshold]);

  const markReady = (id) => {
    markOrderReady(id, token).then(() => loadOrders());
  };

  // derive visible orders based on current tab with sort priorities
  const visibleOrders = useMemo(() => {
    const list = orders.slice();
    if (tab === 'current') {
      // only pending
      const pending = list.filter(o => o.status === 'pending');
      // sort: overdue first, then by remaining time ascending
      return pending.sort((a,b) => {
        const ra = remainingTime(a);
        const rb = remainingTime(b);
        const oa = (ra !== null && ra < 0) ? 1 : 0;
        const ob = (rb !== null && rb < 0) ? 1 : 0;
        if (oa !== ob) return ob - oa; // overdue first
        const va = ra == null ? Number.POSITIVE_INFINITY : ra;
        const vb = rb == null ? Number.POSITIVE_INFINITY : rb;
        return va - vb;
      });
    } else if (tab === 'ready') {
      // ready tab
      return list.filter(o => o.status === 'ready').sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      return list.filter(o => o.status === 'completed').sort((a,b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
    }
  }, [orders, tab, remainingTime]);

  const loadBulkOrders = useCallback(async () => {
    if (!token) return;
    try {
      setBulkLoading(true);
      setBulkError(null);
      const res = await fetchBulkOrders(token, { status: 'pending_vendor' });
      if (res?.status === "ok" && Array.isArray(res.orders)) {
        setBulkOrders(res.orders);
      } else {
        setBulkError(res?.message || "Failed to load bulk orders");
      }
    } catch (error) {
      console.error("Failed to load bulk orders", error);
      setBulkError("Failed to load bulk orders");
    } finally {
      setBulkLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadBulkOrders();
  }, [loadBulkOrders]);

  const bulkOrdersByStatus = useMemo(() => {
    const grouped = new Map();
    bulkOrders.forEach((order) => {
      const status = order?.status || "unknown";
      if (!grouped.has(status)) {
        grouped.set(status, []);
      }
      grouped.get(status).push(order);
    });
    return grouped;
  }, [bulkOrders]);

  const handleBulkMessage = useCallback(
    async (orderId, message) => {
      if (!token || !message) return;
      try {
        const res = await postBulkOrderVendorMessage(token, orderId, message);
        if (res?.status === "ok" && res.order) {
          setBulkOrders((prev) => prev.map((order) => (order.id === orderId ? res.order : order)));
        }
      } catch (error) {
        console.error("Failed to post bulk message", error);
      }
    },
    [token]
  );

  const handleBulkConfirm = useCallback(
    async (orderId, payload) => {
      if (!token) return;
      try {
        const res = await confirmBulkOrderSlot(token, orderId, payload);
        if (res?.status === "ok" && res.order) {
          setBulkOrders((prev) => prev.map((order) => (order.id === orderId ? res.order : order)));
        }
      } catch (error) {
        console.error("Failed to confirm bulk order slot", error);
      }
    },
    [token]
  );

  return (
    <div>
      <h2>{vendorShopName || 'Vendor'} Dashboard</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
        Total Orders: {orders.length} | Pending: {orders.filter(o => o.status === 'pending').length}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setMuted(m => !m)}>{muted ? 'Unmute Alerts' : 'Mute Alerts'}</button>
        <span style={{ fontSize: 12, color: '#777' }}>(Overdue sound alerts)</span>
        <button onClick={() => setShowLowStock(v => !v)}>
          {showLowStock ? 'Hide Low Stock' : `Low Stock Items (${lowStockItems.length})`}
        </button>
      </div>
      {showLowStock && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">Low Stock Items (≤ {lowStockThreshold})</div>
          {lowStockItems.length === 0 ? (
            <div style={{ padding: 10, fontSize: 13, color: '#666' }}>No low stock items.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table border="1" cellPadding="8" width="100%">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Inventory</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockItems.map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.name}</td>
                      <td style={{ color: '#e67e22', fontWeight: 700 }}>{Number(it.inventory ?? 0)}</td>
                      <td>
                        <button onClick={()=>window.dispatchEvent(new CustomEvent('navigate:menu-editor', { detail: { to: 'menu-editor', itemId: it.id } }))}>Restock</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('current')} className={tab==='current' ? 'active' : ''}>Current</button>
        <button onClick={() => setTab('ready')} className={tab==='ready' ? 'active' : ''}>Ready</button>
        <button onClick={() => setTab('completed')} className={tab==='completed' ? 'active' : ''}>Completed</button>
        <button onClick={() => setTab('bulk')} className={tab==='bulk' ? 'active' : ''}>Bulk Orders</button>
      </div>
      {tab === 'current' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#555' }}>Bulk extend pending by</span>
          <input type="number" min="1" value={bulkMins} onChange={(e)=>setBulkMins(Number(e.target.value)||0)} style={{ width: 80 }} />
          <span>mins</span>
          <button onClick={() => bulkMins>0 && handleBulkExtend(bulkMins)}>Extend All</button>
        </div>
      )}
      
      <div style={{ overflowX: "auto" }}>
        {tab !== "bulk" && (
          <table border="1" cellPadding="10" width="100%">
            <thead>
              <tr>
                <th>Billing ID</th>
                <th>User</th>
                <th>Items</th>
                {tab !== 'completed' && <th>Remarks</th>}
                {tab !== 'completed' && <th>Scheduled For</th>}
                {tab === 'current' && <th>Prep Time</th>}
                {tab === 'current' && <th>Countdown</th>}
                {tab === 'current' && <th>Extend</th>}
                <th>Status</th>
                {tab !== 'completed' && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {visibleOrders.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: 30, color: "#999" }}>
                    No orders to display
                  </td>
                </tr>
              )}
              {visibleOrders.map((o) => (
                <tr key={o.id} style={{ background: o.status === 'pending' ? '#fff3cd' : (o.status === 'ready' ? '#d4edda' : '#f8f9fa') }}>
                  <td><strong>{o.billingId}</strong></td>
                  <td>{o.user}</td>
                  <td>
                    {o.items.map((it, idx) => (
                      <div key={idx} style={{ fontSize: 12, marginBottom: 4 }}>
                        {it.name} {it.option && `(${it.option})`} x{it.quantity}
                      </div>
                    ))}
                  </td>
                  {tab !== 'completed' && (
                    <td style={{ fontSize: 11 }}>
                      {o.items.map((it, idx) => (
                        it.customization && it.customization.notes ? (
                          <div key={idx} style={{ marginBottom: 8, padding: 4, background: "#f8f9fa", borderRadius: 4 }}>
                            <strong>{it.name}:</strong>
                            <div>📝 {it.customization.notes}</div>
                          </div>
                        ) : null
                      ))}
                    </td>
                  )}
                  {tab !== 'completed' && (
                    <td style={{ fontSize: 12 }}>
                      {o.scheduledTime ? new Date(o.scheduledTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}
                    </td>
                  )}
                  {tab === 'current' && <td>{o.prepTime} mins</td>}
                  {tab === 'current' && (
                    <td>
                      <CountdownDisplay info={countdownMap.get(o.id)} />
                    </td>
                  )}
                  {tab === 'current' && (
                    <td>
                      {o.status === 'pending' && (
                        <ExtendControl order={o} token={token} onExtended={loadOrders} />
                      )}
                      {o.status === 'pending' && (o.etaExtensionMinutes || 0) > 0 && (remainingTime(o) === null || remainingTime(o) >= 0) && (
                        <div style={{ marginTop: 6 }}>
                          <button
                            style={{ background: '#e74c3c' }}
                            onClick={async () => {
                              const ok = window.confirm('Revoke extended time and restore previous ETA?');
                              if (!ok) return;
                              await revokeOrderExtension(o.id, token);
                              loadOrders();
                            }}
                          >Revoke Extension</button>
                        </div>
                      )}
                    </td>
                  )}
                  <td>
                    <span className={`badge badge-${o.status === 'ready' ? 'success' : 'warning'}`}>
                      {o.status.toUpperCase()}
                    </span>
                    {o.status === 'pending' && (() => {
                      const info = countdownMap.get(o.id);
                      return info && info.orderType === 'live' && info.countdownMs < 0;
                    })() && (
                      <span style={{
                        marginLeft: 8,
                        background: '#e74c3c',
                        color: '#fff',
                        borderRadius: 12,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 700
                      }}>OVERDUE</span>
                    )}
                  </td>
                  {tab !== 'completed' && (
                    <td>
                      {o.status === "pending" && (
                        <button onClick={() => markReady(o.id)} style={{ background: "#27ae60" }}>
                          Mark Ready
                        </button>
                      )}
                      {o.status === "ready" && (
                        <>
                          <span style={{ color: "#27ae60", marginRight: 8 }}>✓ Ready</span>
                          <button onClick={async () => { await markOrderPicked(o.id, token); loadOrders(); }} style={{ background: "#2c3e50" }}>Mark Picked</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {tab === "bulk" && (
        <div className="bulk-orders-wrapper">
          {bulkLoading ? (
            <div style={{ padding: 16 }}>Loading bulk orders…</div>
          ) : bulkError ? (
            <div className="error" style={{ padding: 16 }}>{bulkError}</div>
          ) : bulkOrders.length === 0 ? (
            <div style={{ padding: 16 }}>No bulk orders yet.</div>
          ) : (
            Array.from(bulkOrdersByStatus.entries()).map(([status, list]) => (
              <div key={status} className="bulk-section">
                <h3 style={{ marginTop: 24 }}>{status.toUpperCase()} ({list.length})</h3>
                <div className="bulk-list">
                  {list.map((order) => (
                    <BulkOrderCard
                      key={order.id}
                      order={order}
                      onPostMessage={handleBulkMessage}
                      onConfirm={handleBulkConfirm}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const ExtendControl = ({ order, token, onExtended }) => {
  const [minutes, setMinutes] = useState(() => {
    const base = Number(order?.etaExtensionMinutes) || 0;
    return base > 0 ? base : 5;
  });
  const [submitting, setSubmitting] = useState(false);

  const handleExtend = async () => {
    const mins = Number(minutes) || 0;
    if (mins <= 0 || !order?.id) return;
    try {
      setSubmitting(true);
      await extendOrderPrep(order.id, mins, token);
      onExtended?.();
    } catch (error) {
      console.error("Failed to extend order", error);
      window.alert("Could not extend order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="number"
        min="1"
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value) || 0)}
        style={{ width: 70 }}
        disabled={submitting}
      />
      <span style={{ fontSize: 12 }}>mins</span>
      <button onClick={handleExtend} disabled={submitting}>
        {submitting ? "Extending…" : "Extend"}
      </button>
    </div>
  );
};

const BulkOrderCard = ({ order, onPostMessage, onConfirm }) => {
  const [message, setMessage] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState(() => {
    const slots = Array.isArray(order?.deliverySlots) ? order.deliverySlots : [];
    return slots.length > 0 ? String(slots[0].id) : "";
  });
  const [responseStatus, setResponseStatus] = useState("confirmed");
  const [capacity, setCapacity] = useState("");

  const slots = Array.isArray(order.deliverySlots) ? order.deliverySlots : [];
  const attendees = Array.isArray(order.attendeeGroups) ? order.attendeeGroups : [];
  const vendorResponses = Array.isArray(order.vendorResponses) ? order.vendorResponses : [];
  const vendorMessages = Array.isArray(order.vendorMessages) ? order.vendorMessages : [];

  const handleSendMessage = () => {
    if (!message.trim()) return;
    onPostMessage?.(order.id, message.trim());
    setMessage("");
  };

  const handleConfirm = () => {
    if (!selectedSlotId && slots.length > 0) return;
    onConfirm?.(order.id, {
      slotId: selectedSlotId || (slots[0] && slots[0].id),
      status: responseStatus,
      capacity: capacity ? Number(capacity) : undefined,
      message,
    });
    setMessage("");
    setCapacity("");
  };

  return (
    <div className="bulk-card">
      <div className="bulk-card-header">
        <div>
          <strong>#{order.id}</strong> · {order.eventName || "Untitled Event"}
        </div>
        <div>Status: <strong>{(order.status || '').toUpperCase()}</strong></div>
      </div>
      <div className="bulk-card-body">
        <div className="bulk-meta">
          <div>Organizer: {order.organizerContact?.name || order.organizer?.name || '—'}</div>
          <div>Guests: {order.expectedHeadcount || order.expectedGuests || 'n/a'}</div>
          <div>Location: {order.location || '—'}</div>
          <div>Notes: {order.specialInstructions || order.notes || 'None'}</div>
        </div>
        <div className="bulk-slots">
          <h4>Delivery Slots</h4>
          {slots.length === 0 ? (
            <div>Not specified</div>
          ) : (
            <ul>
              {slots.map((slot) => (
                <li key={slot.id}>
                  <label>
                    <input
                      type="radio"
                      name={`slot-${order.id}`}
                      checked={String(selectedSlotId) === String(slot.id)}
                      onChange={() => setSelectedSlotId(String(slot.id))}
                    />
                    {slot.label || slot.startTime} · {new Date(slot.startTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    {slot.vendorConfirmation ? ` (${slot.vendorConfirmation})` : ""}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {attendees.length > 0 && (
          <div className="bulk-attendees">
            <h4>Attendee Groups</h4>
            <ul>
              {attendees.map((group) => (
                <li key={group.id}>
                  {group.label}: {group.count} {group.notes ? `– ${group.notes}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="bulk-actions">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Share updates or ask questions"
          />
          <div className="bulk-action-row">
            <select value={responseStatus} onChange={(e) => setResponseStatus(e.target.value)}>
              <option value="confirmed">Confirm slot</option>
              <option value="pending">Need clarification</option>
              <option value="rejected">Cannot fulfill</option>
            </select>
            <input
              type="number"
              min="0"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Capacity"
              style={{ width: 120 }}
            />
          </div>
          <div className="bulk-button-row">
            <button onClick={handleConfirm} className="primary-button">Submit Response</button>
            <button onClick={handleSendMessage} className="secondary-button">Post Message</button>
          </div>
        </div>
        <div className="bulk-history">
          <h4>Recent Vendor Responses</h4>
          {vendorResponses.length === 0 ? (
            <div>No confirmations yet.</div>
          ) : (
            <ul>
              {vendorResponses.slice(0, 3).map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.status?.toUpperCase()}</strong> · {new Date(entry.timestamp).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  {entry.capacity != null ? ` · capacity ${entry.capacity}` : ""}
                  {entry.message ? ` – ${entry.message}` : ""}
                </li>
              ))}
            </ul>
          )}
          {vendorMessages.length > 0 && (
            <div className="bulk-messages">
              <h4>Message Thread</h4>
              <ul>
                {vendorMessages.slice(0, 3).map((entry) => (
                  <li key={entry.id}>
                    {new Date(entry.timestamp).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}: {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;