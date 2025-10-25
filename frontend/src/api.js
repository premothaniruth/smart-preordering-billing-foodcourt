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

export const employeeRequestOtp = async (mobile) => {
  const res = await fetch(`${API_URL}/employee/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile }),
  });
  return res.json();
};

export const employeeVerifyOtp = async (mobile, otp) => {
  const res = await fetch(`${API_URL}/employee/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile, otp }),
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

export const fetchAnalytics = async (token, period) => {
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  const res = await fetch(`${API_URL}/analytics${qs}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};

export const fetchUserOrders = async (userId) => {
  const res = await fetch(`${API_URL}/orders/user/${userId}`);
  return res.json();
};

export const toggleFavorite = async (userId, itemId) => {
  const res = await fetch(`${API_URL}/favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, itemId }),
  });
  return res.json();
};

export const fetchFavorites = async (userId) => {
  const res = await fetch(`${API_URL}/favorites/${userId}`);
  return res.json();
};

export const submitRating = async (orderId, rating, feedback) => {
  const res = await fetch(`${API_URL}/rating`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, rating, feedback }),
  });
  return res.json();
};

export const submitGrievance = async (grievance) => {
  const res = await fetch(`${API_URL}/grievance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(grievance),
  });
  return res.json();
};

export const fetchGrievances = async (token) => {
  const res = await fetch(`${API_URL}/grievances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};