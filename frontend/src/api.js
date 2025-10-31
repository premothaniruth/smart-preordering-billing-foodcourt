import { API_URL } from "./config";

/**
 * Fetch full menu (all shops and items)
 * @returns {Promise<any[]>}
 */
export const fetchMenu = async () => {
  const res = await fetch(`${API_URL}/menu`);
  return res.json();
};

export const employeeCheckUsername = async (username) => {
  const u = encodeURIComponent(username || '');
  const res = await fetch(`${API_URL}/employee/check-username?username=${u}`);
  return res.json();
};

export const employeeRegister = async ({ username, password, pin, mobile, email }) => {
  const res = await fetch(`${API_URL}/employee/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, pin, mobile, email })
  });
  return res.json();
};

// Employee profile
export const employeeProfile = async (token) => {
  const res = await fetch(`${API_URL}/employee/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  return res.json();
};

export const employeeProfileRequestOtp = async (token, action) => {
  const res = await fetch(`${API_URL}/employee/profile/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action })
  });
  return res.json();
};

export const employeeProfileUpdate = async (body) => {
  const res = await fetch(`${API_URL}/employee/profile/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
};

/** Employee password login */
export const employeePasswordLogin = async (username, password) => {
  const res = await fetch(`${API_URL}/employee/login-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
};

/** Employee 4-digit PIN login */
export const employeePinLogin = async (username, pin, mobileOrEmail) => {
  const res = await fetch(`${API_URL}/employee/login-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin, mobileOrEmail })
  });
  return res.json();
};

export const employeeResetPin = async (username, mobileOrEmail, newPin) => {
  const res = await fetch(`${API_URL}/employee/reset-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, mobileOrEmail, newPin })
  });
  return res.json();
};

export const employeeResetPassword = async (username, mobileOrEmail, newPassword) => {
  const res = await fetch(`${API_URL}/employee/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, mobileOrEmail, newPassword })
  });
  return res.json();
};

/**
 * Employee Apple Login: send Apple ID token to backend for verification
 * @param {string} idToken
 */
export const employeeAppleLogin = async (email) => {
  const res = await fetch(`${API_URL}/employee/apple-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  return res.json();
};

/**
 * Upload vendor item image
 * @param {File} file
 * @param {string} token vendor JWT
 * @returns {Promise<{status:string,path:string}>}
 */
export const preprocessVendorImage = async (file, options = {}) => {
  if (!file) throw new Error('No file');
  const allowed = ['image/jpeg','image/png','image/jpg'];
  let type = (file.type || '').toLowerCase();

  const readAsDataURL = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const dataUrlToBase64 = (dataUrl) => {
    const comma = String(dataUrl).indexOf(',');
    return comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl);
  };

  const hasTransparency = async (img, canvas) => {
    const ctx = canvas.getContext('2d');
    canvas.width = img.width; canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const step = Math.max(1, Math.floor(Math.max(img.width, img.height) / 400));
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4 + 3;
        if (data[i] < 255) return true;
      }
    }
    return false;
  };

  const ensureUnderLimit = async (blob) => {
    // Try to compress/resize to be <= 5MB and JPEG format
    const MAX_BYTES = 5 * 1024 * 1024;
    // If already allowed type and under size, return as-is
    if (allowed.includes((blob.type || '').toLowerCase()) && blob.size <= MAX_BYTES) {
      return { blob, mime: (blob.type || 'image/jpeg').toLowerCase() };
    }
    // Load image into canvas
    const dataUrl = await readAsDataURL(blob);
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });
    // Resize to max dimension
    const MAX_DIM = Number(options.maxDim || 1600);
    let { width, height } = img;
    const scale = Math.min(1, MAX_DIM / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // If original was PNG and has transparency and the resized PNG is <= 5MB, keep PNG
    if ((file.type || '').toLowerCase() === 'image/png') {
      try {
        const transparent = await hasTransparency(img, document.createElement('canvas'));
        if (transparent) {
          const pngBlob = await new Promise((resolve) => canvas.toBlob((b)=>resolve(b), 'image/png'));
          if (pngBlob && pngBlob.size <= MAX_BYTES) {
            return { blob: pngBlob, mime: 'image/png' };
          }
        }
      } catch {}
    }
    // Try multiple qualities
    const qualities = Array.isArray(options.qualities) && options.qualities.length > 0 ? options.qualities : [0.9, 0.8, 0.7, 0.6, 0.5];
    for (const q of qualities) {
      const out = await new Promise((resolve) => canvas.toBlob((b)=>resolve(b), 'image/jpeg', q));
      if (out && out.size <= MAX_BYTES) {
        return { blob: out, mime: 'image/jpeg' };
      }
    }
    // If still too large, final attempt with smaller max dims
    const MAX_DIM2 = Number(options.fallbackDim || 1200);
    const scale2 = Math.min(1, MAX_DIM2 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale2));
    canvas.height = Math.max(1, Math.round(height * scale2));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out2 = await new Promise((resolve) => canvas.toBlob((b)=>resolve(b), 'image/jpeg', 0.6));
    if (out2 && out2.size <= MAX_BYTES) return { blob: out2, mime: 'image/jpeg' };
    throw new Error('Unable to compress image under 5MB');
  };

  // If type not allowed or size too big, compress/convert
  let workingBlob = file;
  if (!allowed.includes(type) || file.size > 5 * 1024 * 1024) {
    const result = await ensureUnderLimit(file);
    workingBlob = result.blob;
    type = result.mime;
  }

  const finalDataUrl = await readAsDataURL(workingBlob);
  const base64 = dataUrlToBase64(finalDataUrl);
  return { name: file.name || 'image', mime: type, base64, dataUrl: finalDataUrl, size: workingBlob.size };
};

export const uploadVendorImagePrepared = async ({ name, mime, base64 }, token) => {
  const res = await fetch(`${API_URL}/vendor/upload-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    },
    body: JSON.stringify({ name, mime, data: base64 })
  });
  return res.json();
};

export const uploadVendorImage = async (file, token, options = {}) => {
  const prepared = await preprocessVendorImage(file, options);
  const res = await fetch(`${API_URL}/vendor/upload-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    },
    body: JSON.stringify({ name: prepared.name, mime: prepared.mime, data: prepared.base64 })
  });
  return res.json();
};

/**
 * Fetch all offers for a shop (management UI)
 * @param {string|number} shopId
 */
export const fetchOffers = async (shopId) => {
  const params = new URLSearchParams();
  if (shopId != null) params.set('shopId', String(shopId));
  const res = await fetch(`${API_URL}/offers?${params.toString()}`);
  return res.json();
};

/**
 * Fetch menu grouped by sections for a shop, respecting time windows
 * @param {string|number} shopId
 * @param {Date=} at
 * @returns {Promise<{shopId:number,shopName:string,sections:Array<{name:string,items:any[]}>}>}
 */
export const fetchMenuSections = async (shopId, at) => {
  const params = new URLSearchParams();
  params.set('includeSections', '1');
  if (shopId != null) params.set('shopId', String(shopId));
  if (at) params.set('at', at.toISOString());
  const res = await fetch(`${API_URL}/menu?${params.toString()}`);
  return res.json();
};

/**
 * Fetch section windows and names
 * @returns {Promise<{windows:Record<string,{start:string,end:string}>, names:string[]}>}
 */
export const fetchSectionsMeta = async () => {
  const res = await fetch(`${API_URL}/sections`);
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
 * Fetch combos for a shop
 * @param {string|number} shopId
 * @param {boolean=} activeOnly
 */
export const fetchCombos = async (shopId, activeOnly = true) => {
  const params = new URLSearchParams();
  if (shopId != null) params.set('shopId', String(shopId));
  if (activeOnly) params.set('activeOnly', '1');
  const res = await fetch(`${API_URL}/combos?${params.toString()}`);
  return res.json();
};

/**
 * Update combos for vendor shop
 * @param {any[]} combos
 * @param {string} token
 */
export const updateCombos = async (combos, token) => {
  const res = await fetch(`${API_URL}/combos`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ combos })
  });
  return res.json();
};

/**
 * Fetch active offers for a shop
 * @param {string|number} shopId
 */
export const fetchActiveOffers = async (shopId) => {
  const params = new URLSearchParams();
  if (shopId != null) params.set('shopId', String(shopId));
  const res = await fetch(`${API_URL}/offers/active?${params.toString()}`);
  return res.json();
};

/**
 * Update offers for vendor shop
 * @param {any[]} offers
 * @param {string} token
 */
export const updateOffers = async (offers, token) => {
  const res = await fetch(`${API_URL}/offers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ offers })
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
 * Employee Google Login (demo): send email to backend
 * @param {string} email
 * @returns {Promise<any>}
 */
export const employeeGoogleLogin = async (email) => {
  const res = await fetch(`${API_URL}/employee/google-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
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