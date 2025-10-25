import React, { useEffect, useState } from "react";
import { fetchOrders, markOrderReady, fetchMenu } from "../api";

const AdminDashboard = ({ token }) => {
  const [orders, setOrders] = useState([]);
  const [menu, setMenu] = useState([]);

  useEffect(() => {
    loadOrders();
    fetchMenu().then(setMenu);
    const interval = setInterval(loadOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadOrders = () => {
    fetchOrders(token).then(setOrders);
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
      
      <div style={{ overflowX: "auto" }}>
        <table border="1" cellPadding="10" width="100%">
          <thead>
            <tr>
              <th>Billing ID</th>
              <th>User</th>
              <th>Shop</th>
              <th>Items</th>
              <th>Remarks</th>
              <th>Prep Time</th>
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
                <td>{o.prepTime} mins</td>
                <td>
                  <span className={`badge badge-${o.status === 'ready' ? 'success' : 'warning'}`}>
                    {o.status.toUpperCase()}
                  </span>
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

export default AdminDashboard;