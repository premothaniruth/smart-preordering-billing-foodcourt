import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchOrders, markOrderReady, fetchMenu, extendOrderPrep, markOrderPicked, revokeOrderExtension } from "../api";

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
  const orderPrepOverride = coerceNumber(order.prepTime, 0);
  const basePrepMinutes = Math.max(derivedPrep, orderPrepOverride);
  const vendorLoadMultiplier = computeVendorLoadMultiplier({ order, pendingOrdersCount, now });
  const adjustedPrepMinutes = basePrepMinutes * vendorLoadMultiplier;
  const adjustedPrepMs = adjustedPrepMinutes * 60000;

  const orderTypeRaw = order?.orderType ? String(order.orderType).toLowerCase() : null;
  const scheduledTimeValue = order?.scheduledTime ? Date.parse(order.scheduledTime) : NaN;
  const inferredType = orderTypeRaw || (!Number.isNaN(scheduledTimeValue) ? "pre-order" : "live");
  const orderType = inferredType === "pre-order" ? "pre-order" : "live";

  let startTime = now;
  let targetTime = now + adjustedPrepMs;
  let countdownMs = adjustedPrepMs;
  let status = "in-progress";
  let prefix = "Ready in";
  let message = "";

  if (orderType === "pre-order" && !Number.isNaN(scheduledTimeValue)) {
    targetTime = scheduledTimeValue;
    startTime = scheduledTimeValue - adjustedPrepMs;
    countdownMs = startTime - now;
    if (countdownMs > 0) {
      status = "waiting";
      prefix = "Prep starts in";
    } else {
      status = "due";
      prefix = "Start preparing now";
      message = "Serve by";
    }
  } else {
    const createdAt = order?.createdAt ? Date.parse(order.createdAt) : NaN;
    startTime = Number.isNaN(createdAt) ? now : createdAt;
    targetTime = startTime + adjustedPrepMs;
    countdownMs = targetTime - now;
    if (countdownMs > 0) {
      status = "in-progress";
      prefix = "Ready in";
    } else {
      status = "overdue";
      prefix = "Prep window elapsed";
      message = "Expected ready";
    }
  }

  const label = formatCountdown(Math.max(countdownMs, 0));
  const helperParts = [];
  helperParts.push(`Base ${formatMinutes(basePrepMinutes)}`);
  helperParts.push(`Adj ${formatMinutes(adjustedPrepMinutes)} (×${vendorLoadMultiplier.toFixed(2)})`);
  if (orderType === "pre-order" && !Number.isNaN(targetTime)) {
    helperParts.push(`Serve ${new Date(targetTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`);
  } else if (!Number.isNaN(targetTime)) {
    helperParts.push(`ETA ${new Date(targetTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`);
  }

  return {
    orderId: order.id,
    orderType,
    basePrepMinutes,
    adjustedPrepMinutes,
    vendorLoadMultiplier,
    countdownMs,
    startTime,
    targetTime,
    status,
    label,
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

  const isPositive = info.countdownMs > 0;
  const color = info.status === "overdue" ? "#e74c3c" : info.status === "due" ? "#e67e22" : "#2c3e50";
  const primaryText = isPositive ? `${info.prefix}: ${info.label}` : info.prefix;
  const secondaryPrefix = !isPositive && info.message ? `${info.message}: ` : "";
  const secondaryValue = !isPositive && !Number.isNaN(info.targetTime)
    ? new Date(info.targetTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div id={info.domId} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }} aria-live="polite">
      <span style={{ fontWeight: 700, color }}>{primaryText}</span>
      {(!isPositive && secondaryValue) && (
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
  const [tab, setTab] = useState('current'); // 'current' | 'ready' | 'completed'
  const overdueNotifiedRef = useRef(new Set());
  const OVERDUE_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";
  const [muted, setMuted] = useState(() => (localStorage.getItem('vendorSoundFirstLoginDone') ? true : false));
  // Low stock toggle
  const [showLowStock, setShowLowStock] = useState(false);
  const [lowStockThreshold, setLowStockThreshold] = useState(10);
  const vendorShopId = (() => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.shopId || null;
    } catch { return null; }
  })();

  useEffect(() => {
    loadOrders();
    fetchMenu().then(setMenu);
    if (!localStorage.getItem('vendorSoundFirstLoginDone')) {
      try { localStorage.setItem('vendorSoundFirstLoginDone', '1'); } catch {}
    }
    const interval = setInterval(loadOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  // tick every second for countdown rendering
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // per-item restock handled via Menu Editor; see low-stock table button below

  const loadOrders = () => {
    fetchOrders(token).then(setOrders);
  };

  const prepTimesByShop = useMemo(() => buildPrepTimesByShop(menu), [menu]);

  const pendingOrdersCount = useMemo(
    () => orders.filter((o) => o.status === 'pending').length,
    [orders]
  );

  const countdownMap = useMemo(() => {
    const now = Date.now();
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

  const handleRestockLow = async () => {
    const shop = menu.find(s => s.shopId === vendorShopId);
    if (!shop || !Array.isArray(shop.items)) return;
    const ok = window.confirm(`Restock ${lowStockItems.length} low-stock items to 100?`);
    if (!ok) return;
    const updated = shop.items.map(it => (Number(it.inventory ?? 100) <= Number(lowStockThreshold) ? { ...it, inventory: 100 } : it));
    const res = await updateMenu(updated, token);
    if (res && res.status === 'success') {
      const fresh = await fetchMenu();
      setMenu(fresh);
      toast.success('Restocked low-stock items to 100');
      window.dispatchEvent(new CustomEvent('menu:updated'));
    } else {
      toast.error('Failed to restock');
    }
  };

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
  }, [orders, tab, tick, remainingTime]);

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
      </div>
    </div>
  );
};

/**
 * ExtendControl
 * Quick control to extend an order's prep time in minutes.
 * @param {{ order: any, token: string, onExtended?: ()=>void }} props
 */
const ExtendControl = ({ order, token, onExtended }) => {
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button disabled={loading} onClick={async ()=>{ setLoading(true); try { await extendOrderPrep(order.id, 5, token); onExtended && onExtended(); } finally { setLoading(false);} }}>+5</button>
      <button disabled={loading} onClick={async ()=>{ setLoading(true); try { await extendOrderPrep(order.id, 10, token); onExtended && onExtended(); } finally { setLoading(false);} }}>+10</button>
    </div>
  );
};

export default AdminDashboard;