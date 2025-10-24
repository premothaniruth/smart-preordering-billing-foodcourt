import React, { useEffect, useState } from "react";
import { fetchOrders, markOrderReady, fetchMenu } from "../api";

const AdminDashboard = ({ token }) => {
  const [orders, setOrders] = useState([]);
  const [menu, setMenu] = useState([]);

  useEffect(() => {
    loadOrders();
    fetchMenu().then(setMenu);
    const interval = setInterval(loadOrders, 3000);
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
      <table border="1" cellPadding="10" width="100%">
        <thead>
          <tr>
            <th>ID</th>
            <th>User</th>
            <th>Shop</th>
            <th>Items</th>
            <th>Scheduled</th>
            <th>Status</th>
            <th>Mark Ready</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.user}</td>
              <td>{getShopName(o.shopId)}</td>
              <td>{o.items.map((i) => i.name).join(", ")}</td>
              <td>{o.scheduledTime ? new Date(o.scheduledTime).toLocaleString() : "Immediate"}</td>
              <td>{o.status}</td>
              <td>
                {o.status === "pending" && (
                  <button onClick={() => markReady(o.id)}>Mark Ready</button>
                )}
                {o.status === "ready" && "Ready"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminDashboard;