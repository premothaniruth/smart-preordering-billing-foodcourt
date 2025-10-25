import { API_URL } from "./config";

export const fetchMenu = async () => {
  const res = await fetch(`${API_URL}/menu`);
  return res.json();
};

export const vendorLogin = async (username, password) => {
  const res = await fetch(`${API_URL}/vendor/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
};

export const updateMenu = async (items, token) => {
  const res = await fetch(`${API_URL}/menu`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items }),
  });
  return res.json();
};

export const placeOrder = async (order) => {
  const res = await fetch(`${API_URL}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  return res.json();
};

export const fetchOrders = async (token) => {
  const res = await fetch(`${API_URL}/orders`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

export const markOrderReady = async (orderId, token) => {
  const res = await fetch(`${API_URL}/order/ready/${orderId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

export const fetchAnalytics = async (token) => {
  const res = await fetch(`${API_URL}/analytics`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};
