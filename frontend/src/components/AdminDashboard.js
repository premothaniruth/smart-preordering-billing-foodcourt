import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchOrders, markOrderReady, fetchMenu, extendOrderPrep, markOrderPicked, revokeOrderExtension } from "../api";

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

  // compute remaining ms to ETA; negative means overdue
  const remainingTime = (o) => {
    if (!o.estimatedReadyTime) return null;
    const now = Date.now();
    const eta = new Date(o.estimatedReadyTime).getTime();
    const diff = eta - now; // ms
    return diff;
  };

  // per-item restock handled via Menu Editor; see low-stock table button below

  const formatDuration = (ms) => {
    const sign = ms < 0 ? '-' : '';
    const abs = Math.abs(ms);
    const m = Math.floor(abs / 60000);
    const s = Math.floor((abs % 60000) / 1000);
    return `${sign}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const loadOrders = () => {
    fetchOrders(token).then(setOrders);
  };

  // Play overdue sound once when an order first becomes overdue
  useEffect(() => {
    const overduePending = orders.filter(o => o.status === 'pending' && remainingTime(o) !== null && remainingTime(o) < 0);
    overduePending.forEach(o => {
      if (!overdueNotifiedRef.current.has(o.id)) {
        overdueNotifiedRef.current.add(o.id);
        if (!muted) {
          try { new Audio(OVERDUE_SOUND).play(); } catch {}
        }
      }
    });
  }, [orders, tick, muted]);

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
  }, [orders, tab, tick]);

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
                    {o.estimatedReadyTime ? (
                      <span style={{
                        fontWeight: 600,
                        color: (remainingTime(o) !== null && remainingTime(o) < 0 && o.status === 'pending') ? '#e74c3c' : '#2c3e50'
                      }}>
                        {formatDuration(remainingTime(o))}
                      </span>
                    ) : (
                      <span style={{ color: '#999' }}>—</span>
                    )}
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
                  {o.status === 'pending' && remainingTime(o) !== null && remainingTime(o) < 0 && (
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