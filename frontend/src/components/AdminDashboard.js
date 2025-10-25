import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchOrders, markOrderReady, fetchMenu, extendOrderPrep } from "../api";

const AdminDashboard = ({ token }) => {
  const [orders, setOrders] = useState([]);
  const [menu, setMenu] = useState([]);
  const overdueNotifiedRef = useRef(new Set());
  const OVERDUE_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    loadOrders();
    fetchMenu().then(setMenu);
    const interval = setInterval(loadOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  // tick every second for countdown rendering
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const remainingTime = (o) => {
    if (!o.estimatedReadyTime) return null;
    const now = Date.now();
    const eta = new Date(o.estimatedReadyTime).getTime();
    const diff = eta - now; // ms
    return diff;
  };

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

  const markReady = (id) => {
    markOrderReady(id, token).then(() => loadOrders());
  };

  return (
    <div>
      <h2>Vendor Dashboard - Live Orders</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
        Total Orders: {orders.length} | Pending: {orders.filter(o => o.status === 'pending').length}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setMuted(m => !m)}>{muted ? 'Unmute Alerts' : 'Mute Alerts'}</button>
        <span style={{ fontSize: 12, color: '#777' }}>(Overdue sound alerts)</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#555' }}>Bulk extend pending:</span>
        <button onClick={() => handleBulkExtend(5)}>+5 min</button>
        <button onClick={() => handleBulkExtend(10)}>+10 min</button>
        <button onClick={() => handleBulkExtend(20)}>+20 min</button>
      </div>
      
      <div style={{ overflowX: "auto" }}>
        <table border="1" cellPadding="10" width="100%">
          <thead>
            <tr>
              <th>Billing ID</th>
              <th>User</th>
              <th>Shop</th>
              <th>Items</th>
              <th>Remarks</th>
              <th>Scheduled For</th>
              <th>Prep Time</th>
              <th>Countdown</th>
              <th>Extend</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan="8" style={{ textAlign: "center", padding: 30, color: "#999" }}>
                  No orders yet
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} style={{ background: o.status === 'pending' ? '#fff3cd' : '#d4edda' }}>
                <td><strong>{o.billingId}</strong></td>
                <td>{o.user}</td>
                <td>{getShopName(o.shopId)}</td>
                <td>
                  {o.items.map((it, idx) => (
                    <div key={idx} style={{ fontSize: 12, marginBottom: 4 }}>
                      {it.name} {it.option && `(${it.option})`} x{it.quantity}
                    </div>
                  ))}
                </td>
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
                <td style={{ fontSize: 12 }}>
                  {o.scheduledTime ? new Date(o.scheduledTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}
                </td>
                <td>{o.prepTime} mins</td>
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
                <td>
                  {o.status === 'pending' && (
                    <ExtendControl order={o} token={token} onExtended={loadOrders} />
                  )}
                </td>
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
                <td>
                  {o.status === "pending" && (
                    <button onClick={() => markReady(o.id)} style={{ background: "#27ae60" }}>
                      Mark Ready
                    </button>
                  )}
                  {o.status === "ready" && <span style={{ color: "#27ae60" }}>✓ Ready</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ExtendControl = ({ order, token, onExtended }) => {
  const [mins, setMins] = useState(5);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!mins || mins <= 0) return;
    setLoading(true);
    try {
      await extendOrderPrep(order.id, mins, token);
      onExtended && onExtended();
    } finally {
      setLoading(false);
    }
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="number" min="1" value={mins} onChange={(e)=>setMins(Number(e.target.value)||0)} style={{ width: 60 }} />
      <button onClick={submit} disabled={loading || !mins}>+ Extend</button>
      <span style={{ fontSize: 12, color: '#777', marginLeft: 6 }}>Quick:</span>
      <button disabled={loading} onClick={async ()=>{ setLoading(true); try { await extendOrderPrep(order.id, 5, token); onExtended && onExtended(); } finally { setLoading(false);} }}>+5</button>
      <button disabled={loading} onClick={async ()=>{ setLoading(true); try { await extendOrderPrep(order.id, 10, token); onExtended && onExtended(); } finally { setLoading(false);} }}>+10</button>
      <button disabled={loading} onClick={async ()=>{ setLoading(true); try { await extendOrderPrep(order.id, 20, token); onExtended && onExtended(); } finally { setLoading(false);} }}>+20</button>
    </div>
  );
};

export default AdminDashboard;