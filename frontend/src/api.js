import { API_URL } from "./config";

/**
 * Fetch full menu (all shops and items)
 * @returns {Promise<any[]>}
 */
export const fetchMenu = async () => {
  const res = await fetch(`${API_URL}/menu`);
  return res.json();
};

/**
 * Vendor login
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{token?:string, message?:string}>}
 */
export const vendorLogin = async (username, password) => {
  const res = await fetch(`${API_URL}/vendor/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
};

/**
 * Request OTP for employee login
 * @param {string} mobile - 10-digit mobile number
 * @returns {Promise<any>}
 */
export const employeeRequestOtp = async (mobile) => {
  const res = await fetch(`${API_URL}/employee/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile }),
  });
  return res.json();
};

/**
 * Verify OTP for employee and receive a session token
 * @param {string} mobile
 * @param {string} otp
 * @returns {Promise<any>}
 */
export const employeeVerifyOtp = async (mobile, otp) => {
  const res = await fetch(`${API_URL}/employee/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile, otp }),
  });
  return res.json();
};

/**
 * Replace vendor shop menu items
 * @param {any[]} items
 * @param {string} token - vendor bearer token
 * @returns {Promise<any>}
 */
export const updateMenu = async (items, token) => {
  const res = await fetch(`${API_URL}/menu`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items }),
  });
  return res.json();
};

/**
 * Place a user order
 * @param {{items:any[], user:string, scheduledTime?:string, shopId:string}} order
 * @returns {Promise<any>}
 */
export const placeOrder = async (order) => {
  const res = await fetch(`${API_URL}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  return res.json();
};

/**
 * Fetch vendor orders (their shop only)
 * @param {string} token
 * @returns {Promise<any>}
 */
export const fetchOrders = async (token) => {
  const res = await fetch(`${API_URL}/orders`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

/**
 * Mark order as ready
 * @param {number} orderId
 * @param {string} token
 * @returns {Promise<any>}
 */
export const markOrderReady = async (orderId, token) => {
  const res = await fetch(`${API_URL}/order/ready/${orderId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

/**
 * Extend order prep time
 * @param {number} orderId
 * @param {number} addMinutes
 * @param {string} token
 * @returns {Promise<any>}
 */
export const extendOrderPrep = async (orderId, addMinutes, token) => {
  const res = await fetch(`${API_URL}/order/extend/${orderId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ addMinutes })
  });
  return res.json();
};

/**
 * Revoke previously extended prep time
 * @param {number} orderId
 * @param {string} token
 * @returns {Promise<any>}
 */
export const revokeOrderExtension = async (orderId, token) => {
  const res = await fetch(`${API_URL}/order/extend-reset/${orderId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

/**
 * Mark order picked/completed
 * @param {number} orderId
 * @param {string} token
 * @returns {Promise<any>}
 */
export const markOrderPicked = async (orderId, token) => {
  const res = await fetch(`${API_URL}/order/picked/${orderId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

/**
 * Fetch analytics
 * @param {string} token
 * @param {('daily'|'monthly'|'quarterly'|'yearly'|'')} period
 * @returns {Promise<any>}
 */
export const fetchAnalytics = async (token, period) => {
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  const res = await fetch(`${API_URL}/analytics${qs}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
};

/**
 * Fetch orders for a user
 * @param {string} userId
 * @returns {Promise<any>}
 */
export const fetchUserOrders = async (userId) => {
  const res = await fetch(`${API_URL}/orders/user/${userId}`);
  return res.json();
};

/**
 * Fetch feedbacks for this vendor's shop
 * @param {string} token
 * @returns {Promise<any>}
 */
export const fetchVendorFeedbacks = async (token) => {
  const res = await fetch(`${API_URL}/vendor/feedbacks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

/**
 * Fetch public feedbacks (optionally filtered)
 * @param {{ratingMin?:number, days?:number}} params
 * @returns {Promise<any>}
 */
export const fetchPublicFeedbacks = async ({ ratingMin, days } = {}) => {
  const params = new URLSearchParams();
  if (ratingMin) params.set('ratingMin', String(ratingMin));
  if (days) params.set('days', String(days));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_URL}/feedbacks${qs}`);
  return res.json();
};

/**
 * Toggle favorite for user/item
 * @param {string} userId
 * @param {number} itemId
 * @returns {Promise<any>}
 */
export const toggleFavorite = async (userId, itemId) => {
  const res = await fetch(`${API_URL}/favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, itemId }),
  });
  return res.json();
};

/**
 * Get user's favorite item ids
 * @param {string} userId
 * @returns {Promise<any>}
 */
export const fetchFavorites = async (userId) => {
  const res = await fetch(`${API_URL}/favorites/${userId}`);
  return res.json();
};

/**
 * Submit rating/feedback
 * @param {number} orderId
 * @param {number} rating
 * @param {string} feedback
 * @returns {Promise<any>}
 */
export const submitRating = async (orderId, rating, feedback) => {
  const res = await fetch(`${API_URL}/rating`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, rating, feedback }),
  });
  return res.json();
};

/**
 * Submit grievance from user
 * @param {{orderId?:number,billingId?:string,issueType:string,description:string,contactPreference?:string,shopId?:string}} grievance
 * @returns {Promise<any>}
 */
export const submitGrievance = async (grievance) => {
  const res = await fetch(`${API_URL}/grievance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(grievance),
  });
  return res.json();
};

/**
 * Fetch grievances for vendor
 * @param {string} token
 * @returns {Promise<any>}
 */
export const fetchGrievances = async (token) => {
  const res = await fetch(`${API_URL}/grievances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};