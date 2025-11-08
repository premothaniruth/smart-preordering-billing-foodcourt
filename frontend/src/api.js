import { API_URL } from "./config";

/**
 * Fetch full menu (all shops and items)
 * @returns {Promise<any[]>}
 */
export const fetchMenu = async (foodCourt) => {
  const params = new URLSearchParams();
  if (foodCourt) params.set('foodCourt', foodCourt);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/menu${qs ? `?${qs}` : ''}`);
  return res.json();
};

export const fetchForecast = async (token) => {
  const res = await fetch(`${API_URL}/analytics/forecast`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch forecast: ${res.status}`);
  }
  return res.json();
};

export const fetchProcurementTasks = async (token) => {
  const res = await fetch(`${API_URL}/procurement/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch procurement tasks: ${res.status}`);
  }
  return res.json();
};

export const generateProcurementTask = async (token) => {
  const res = await fetch(`${API_URL}/procurement/tasks/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) {
    return null;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to generate procurement task: ${res.status}`);
  }
  return res.json();
};

export const approveProcurementTask = async (token, taskId, payload = {}) => {
  const res = await fetch(`${API_URL}/procurement/tasks/${taskId}/approve`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to approve task: ${res.status}`);
  }
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

export const fetchBulkOrders = async (token, params = {}) => {
  const url = new URL(`${API_URL}/bulk-orders`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") {
      url.searchParams.append(key, value);
    }
  });

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: token,
    },
  });

  if (!res.ok) {
    return { status: "error", message: "Failed to fetch bulk orders" };
  }
  return res.json();
};

export const createBulkOrder = async (token, payload) => {
  const res = await fetch(`${API_URL}/bulk-orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify(payload),
  });
  return res.json();
};

export const updateBulkOrder = async (token, orderId, updates) => {
  const res = await fetch(`${API_URL}/bulk-orders/${orderId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ updates }),
  });
  return res.json();
};

export const postBulkOrderVendorMessage = async (token, orderId, message) => {
  const res = await fetch(`${API_URL}/bulk-orders/${orderId}/vendor-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ message }),
  });
  return res.json();
};

export const confirmBulkOrderSlot = async (token, orderId, payload) => {
  const res = await fetch(`${API_URL}/bulk-orders/${orderId}/vendor-confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify(payload),
  });
  return res.json();
};

const buildAdminHeaders = (session) => {
  if (!session || !session.username || !session.password) return {};
  return {
    'x-admin-username': session.username,
    'x-admin-password': session.password,
  };
};

export const fetchAdminBulkOrders = async (session, params = {}, foodCourt) => {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (foodCourt) search.set('foodCourt', foodCourt);
  const qs = search.toString();
  const res = await fetch(`${API_URL}/admin/bulk-orders${qs ? `?${qs}` : ''}`, {
    headers: buildAdminHeaders(session),
  });
  return res.json();
};

export const fetchAdminVendors = async (session, foodCourt) => {
  const url = new URL(`${API_URL}/admin/vendors`);
  if (foodCourt) url.searchParams.set('foodCourt', foodCourt);
  const res = await fetch(url.toString(), {
    headers: buildAdminHeaders(session),
  });
  return res.json();
};

export const fetchAdminFoodCourts = async (session) => {
  const res = await fetch(`${API_URL}/admin/food-courts`, {
    headers: buildAdminHeaders(session),
  });
  return res.json();
};

export const fetchFoodCourts = async () => {
  const res = await fetch(`${API_URL}/food-courts`);
  return res.json();
};

export const createAdminFoodCourt = async (session, payload) => {
  const res = await fetch(`${API_URL}/admin/food-courts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAdminHeaders(session),
    },
    body: JSON.stringify(payload || {}),
  });
  return res.json();
};

export const updateAdminFoodCourt = async (session, id, payload) => {
  const res = await fetch(`${API_URL}/admin/food-courts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...buildAdminHeaders(session),
    },
    body: JSON.stringify(payload || {}),
  });
  return res.json();
};

export const deleteAdminVendor = async (session, vendorId, foodCourt) => {
  const url = new URL(`${API_URL}/admin/vendor/${vendorId}`);
  if (foodCourt) url.searchParams.set('foodCourt', foodCourt);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: buildAdminHeaders(session),
  });
  return res.json();
};

export const fetchArchivedVendors = async (session, foodCourt) => {
  const url = new URL(`${API_URL}/admin/vendor-archives`);
  if (foodCourt) url.searchParams.set('foodCourt', foodCourt);
  const res = await fetch(url.toString(), {
    headers: buildAdminHeaders(session),
  });
  return res.json();
};

export const restoreArchivedVendor = async (session, archiveId, foodCourt) => {
  const res = await fetch(`${API_URL}/admin/vendor-archives/${archiveId}/restore`, {
    method: "POST",
    headers: {
      'Content-Type': 'application/json',
      ...buildAdminHeaders(session),
    },
    body: JSON.stringify({ foodCourt }),
  });
  return res.json();
};

export const submitAdminBulkDecision = async (session, orderId, { action, comment }, foodCourt) => {
  const res = await fetch(`${API_URL}/admin/bulk-orders/${orderId}/decision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAdminHeaders(session),
    },
    body: JSON.stringify({ action, comment, foodCourt }),
  });
  return res.json();
};

export const sendBulkOrderToVendor = async (session, orderId, payload = {}, foodCourt) => {
  const res = await fetch(`${API_URL}/admin/bulk-orders/${orderId}/send-to-vendor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAdminHeaders(session),
    },
    body: JSON.stringify({ ...payload, foodCourt }),
  });
  return res.json();
};

export const employeeRequestOtp = async (mobile) => {
  const res = await fetch(`${API_URL}/employee/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile })
  });
  return res.json();
};

export const employeeVerifyOtp = async (mobile, otp) => {
  const res = await fetch(`${API_URL}/employee/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile, otp })
  });
  return res.json();
};

export const expressInterest = async ({ token, shopId, itemId }) => {
  const res = await fetch(`${API_URL}/interest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'x-employee-token': token,
    },
    body: JSON.stringify({ shopId, itemId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to express interest: ${res.status}`);
  }
  return res.json();
};

export const fetchInterestSummary = async (token) => {
  const res = await fetch(`${API_URL}/vendor/interest/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to load interest summary: ${res.status}`);
  }
  return res.json();
};

export const updateInterestThreshold = async (token, threshold) => {
  const res = await fetch(`${API_URL}/vendor/interest/threshold`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ threshold }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to update interest threshold: ${res.status}`);
  }
  return res.json();
};

export const submitEmployeeConcern = async (token, concern) => {
  const res = await fetch(`${API_URL}/employee/concerns`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'x-employee-token': token,
    },
    body: JSON.stringify(concern),
  });
  return res.json();
};

export const fetchEmployeeConcerns = async (token) => {
  const res = await fetch(`${API_URL}/employee/concerns`, {
    headers: {
      Authorization: token,
      'x-employee-token': token,
    },
  });
  return res.json();
};

export const fetchAdminEmployeeConcerns = async (session) => {
  const res = await fetch(`${API_URL}/admin/employee-concerns`, {
    headers: buildAdminHeaders(session),
  });
  return res.json();
};

export const updateAdminEmployeeConcern = async (concernId, updates, session) => {
  const res = await fetch(`${API_URL}/admin/employee-concerns/${concernId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...buildAdminHeaders(session),
    },
    body: JSON.stringify(updates),
  });
  return res.json();
};

export const fetchAdminEmployees = async (session) => {
  const res = await fetch(`${API_URL}/admin/employees`, {
    headers: buildAdminHeaders(session),
  });
  return res.json();
};

export const deleteAdminEmployee = async (session, employeeId) => {
  const res = await fetch(`${API_URL}/admin/employees/${employeeId}`, {
    method: 'DELETE',
    headers: buildAdminHeaders(session),
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

export const employeeProfileRequestOtp = async (token, action) => {
  const res = await fetch(`${API_URL}/employee/profile/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action })
  });
  return res.json();
};

export const walletTopUp = async (token, amount, provider = 'google-pay') => {
  const res = await fetch(`${API_URL}/wallet/topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, amount, provider })
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
export const fetchOffers = async (shopId, foodCourt) => {
  const params = new URLSearchParams();
  if (shopId != null) params.set('shopId', String(shopId));
  if (foodCourt) params.set('foodCourt', foodCourt);
  const res = await fetch(`${API_URL}/offers?${params.toString()}`);
  return res.json();
};

/**
 * Fetch menu grouped by sections for a shop, respecting time windows
 * @param {string|number} shopId
 * @param {Date=} at
 * @returns {Promise<{shopId:number,shopName:string,sections:Array<{name:string,items:any[]}>}>}
 */
export const fetchMenuSections = async (shopId, at, foodCourt) => {
  const params = new URLSearchParams();
  params.set('includeSections', '1');
  if (shopId != null) params.set('shopId', String(shopId));
  if (at instanceof Date) params.set('at', at.toISOString());
  if (foodCourt) params.set('foodCourt', foodCourt);
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
 * @returns {Promise<{token?:string, message?:string, foodCourt?:string}>}
 */
export const vendorLogin = async (username, password, foodCourt = "fc-1") => {
  const res = await fetch(`${API_URL}/vendor/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, foodCourt }),
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
export const placeOrder = async (order, foodCourt) => {
  const headers = { "Content-Type": "application/json" };
  if (foodCourt) headers['x-food-court'] = foodCourt;
  const res = await fetch(`${API_URL}/order`, {
    method: "POST",
    headers,
    body: JSON.stringify(order),
  });
  return res.json();
};

export const fetchEmployeePointsSummary = async (token) => {
  const res = await fetch(`${API_URL}/employee/points/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return res.json();
};

/**
 * Fetch combos for a shop
 * @param {string|number} shopId
 * @param {boolean=} activeOnly
 */
export const fetchCombos = async (shopId, activeOnly = true, foodCourt) =>
{
  const params = new URLSearchParams();
  if (shopId != null) params.set('shopId', String(shopId));
  if (activeOnly) params.set('activeOnly', '1');
  if (foodCourt) params.set('foodCourt', foodCourt);
  const res = await fetch(`${API_URL}/combos?${params.toString()}`);
  return res.json();
};

/**
 * Update combos for vendor shop
 * @param {any[]} combos
 * @param {string} token
 */
export const updateCombos = async (combos, token, foodCourt) => {
  const res = await fetch(`${API_URL}/combos`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ combos, foodCourt })
  });
  return res.json();
};

/**
 * Fetch active offers for a shop
 * @param {string|number} shopId
 */
export const fetchActiveOffers = async (shopId, foodCourt) => {
  const params = new URLSearchParams();
  if (shopId != null) params.set('shopId', String(shopId));
  if (foodCourt) params.set('foodCourt', foodCourt);
  const res = await fetch(`${API_URL}/offers/active?${params.toString()}`);
  return res.json();
};

/**
 * Update offers for vendor shop
 * @param {any[]} offers
 * @param {string} token
 */
export const updateOffers = async (offers, token, foodCourt) => {
  const res = await fetch(`${API_URL}/offers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ offers, foodCourt })
  });
  return res.json();
};

/**
 * Preview active offers against a hypothetical cart
 * @param {{shopId:string|number, items:any[], scheduledTime?:string}} payload
 */
export const previewOffers = async ({ shopId, items, scheduledTime, foodCourt }) => {
  const res = await fetch(`${API_URL}/offers/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopId, items, scheduledTime, foodCourt })
  });
  return res.json();
};

/**
 * Fetch vendor orders (their shop only)
 * @param {string} token
 * @returns {Promise<any>}
 */
export const fetchOrders = async (token, foodCourt) => {
  const headers = { Authorization: `Bearer ${token}` };
  if (foodCourt) {
    headers['x-food-court'] = foodCourt;
  }
  const res = await fetch(`${API_URL}/orders`, {
    headers,
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
 * Trigger an SOS alert
 * @param {{ role:string, actorName:string, message?:string }} payload
 */
export const triggerSosAlert = async (payload = {}) => {
  const res = await fetch(`${API_URL}/sos/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.json();
};

/**
 * Resolve SOS alert
 * @param {{ actorName:string, note?:string }} payload
 */
export const resolveSosAlert = async (payload = {}) => {
  const res = await fetch(`${API_URL}/sos/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.json();
};

/**
 * Fetch current SOS status
 */
export const fetchSosStatus = async () => {
  const res = await fetch(`${API_URL}/sos/status`);
  return res.json();
};

/**
 * Fetch analytics
 * @param {string} token
 * @param {('daily'|'monthly'|'quarterly'|'yearly'|'')} period
 * @param {('hour'|'day'|'week')} granularity
 * @returns {Promise<any>}
 */
export const fetchAnalytics = async (token, period, granularity, foodCourt, { onFallback } = {}) => {
  const realtimeParams = new URLSearchParams();
  if (granularity) realtimeParams.set("granularity", granularity);
  realtimeParams.set("includeInventory", "true");
  if (foodCourt) realtimeParams.set("foodCourt", foodCourt);

  const realtimeRes = await fetch(`${API_URL}/analytics/summary?${realtimeParams.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (realtimeRes.ok) {
    const payload = await realtimeRes.json();
    return { ...payload, source: "realtime" };
  }

  if (typeof onFallback === "function") {
    try {
      onFallback(realtimeRes.status);
    } catch (callbackError) {
      console.warn("fetchAnalytics onFallback handler threw", callbackError);
    }
  }

  const params = new URLSearchParams();
  if (period) params.set("period", period);
  if (granularity) params.set("granularity", granularity);
  if (foodCourt) params.set("foodCourt", foodCourt);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const fallbackRes = await fetch(`${API_URL}/analytics${qs}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!fallbackRes.ok) {
    throw new Error(`Failed to fetch analytics: ${fallbackRes.status}`);
  }
  const fallbackPayload = await fallbackRes.json();
  return { ...fallbackPayload, source: "historical" };
};

export const downloadAnalyticsExport = async (token, format = "json") => {
  const params = new URLSearchParams();
  if (format) params.set("format", format);
  const res = await fetch(`${API_URL}/analytics/export/current?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to export analytics: ${res.status}`);
  }
  return res;
};

export const uploadHistoricAnalytics = async (token, file) => {
  if (!file) {
    throw new Error("Please choose a file to upload");
  }
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/analytics/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.message || `Failed to upload analytics: ${res.status}`;
    throw new Error(message);
  }
  return payload;
};

export const fetchRecommendations = async (token, foodCourt) => {
  const params = new URLSearchParams();
  if (foodCourt) params.set('foodCourt', foodCourt);
  const res = await fetch(`${API_URL}/analytics/recommendations${params.size ? `?${params.toString()}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch recommendations: ${res.status}`);
  }
  return res.json();
};

export const fetchHeadcountEntries = async (token, foodCourt) => {
  const params = new URLSearchParams();
  if (foodCourt) params.set('foodCourt', foodCourt);
  const res = await fetch(`${API_URL}/analytics/headcount${params.size ? `?${params.toString()}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch headcount: ${res.status}`);
  }
  return res.json();
};

export const submitHeadcount = async (token, headcount, foodCourt) => {
  const res = await fetch(`${API_URL}/analytics/headcount`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ headcount, foodCourt }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to submit headcount: ${res.status}`);
  }
  return res.json();
};

export const fetchProcurementTemplates = async (token) => {
  const res = await fetch(`${API_URL}/procurement/templates`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch templates: ${res.status}`);
  }
  return res.json();
};

export const createProcurementTemplate = async (token, payload) => {
  const res = await fetch(`${API_URL}/procurement/templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to create template: ${res.status}`);
  }
  return res.json();
};

export const updateProcurementTemplate = async (token, id, payload) => {
  const res = await fetch(`${API_URL}/procurement/templates/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to update template: ${res.status}`);
  }
  return res.json();
};

export const deleteProcurementTemplate = async (token, id) => {
  const res = await fetch(`${API_URL}/procurement/templates/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to delete template: ${res.status}`);
  }
  return res.json();
};

export const fetchProcurementOrders = async (token) => {
  const res = await fetch(`${API_URL}/procurement/orders`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch procurement orders: ${res.status}`);
  }
  return res.json();
};

export const createProcurementOrder = async (token, payload) => {
  const res = await fetch(`${API_URL}/procurement/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to create procurement order: ${res.status}`);
  }
  return res.json();
};

/**
 * Fetch orders for a user
 * @param {string} userId
 * @returns {Promise<any>}
 */
export const fetchUserOrders = async (userId, foodCourt) => {
  const params = new URLSearchParams();
  if (foodCourt) params.set('foodCourt', foodCourt);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/orders/user/${userId}${qs ? `?${qs}` : ''}`);
  return res.json();
};

/**
 * Cancel a scheduled order for a user
 * @param {number} orderId
 * @param {string} userId
 * @param {string=} reason
 * @returns {Promise<any>}
 */
export const cancelOrder = async (orderId, userId, reason = "", foodCourt) => {
  const headers = { 'Content-Type': 'application/json' };
  if (foodCourt) headers['x-food-court'] = foodCourt;
  const res = await fetch(`${API_URL}/order/cancel/${orderId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ userId, reason })
  });
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
export const toggleFavorite = async (userId, itemId, foodCourt) => {
  const headers = { "Content-Type": "application/json" };
  if (foodCourt) headers['x-food-court'] = foodCourt;
  const res = await fetch(`${API_URL}/favorites`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userId, itemId }),
  });
  return res.json();
};

/**
 * Get user's favorite item ids
 * @param {string} userId
 * @returns {Promise<any>}
 */
export const fetchFavorites = async (userId, foodCourt) => {
  const headers = { "Content-Type": "application/json" };
  if (foodCourt) headers['x-food-court'] = foodCourt;
  const res = await fetch(`${API_URL}/favorites/${userId}`, {
    headers,
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
export const submitRating = async (orderId, rating, feedback, foodCourt) => {
  const headers = { "Content-Type": "application/json" };
  if (foodCourt) headers['x-food-court'] = foodCourt;
  const res = await fetch(`${API_URL}/rating`, {
    method: "POST",
    headers,
    body: JSON.stringify({ orderId, rating, feedback })
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

/**
 * Submit grievance from vendor to admin
 * @param {{subject:string,description:string,priority?:'low'|'medium'|'high'}} grievance
 * @param {string} token Vendor bearer token
 */
export const submitVendorGrievance = async (grievance, token) => {
  const res = await fetch(`${API_URL}/vendor/grievances`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(grievance),
  });
  return res.json();
};

/**
 * Fetch grievances raised by current vendor
 * @param {string} token
 */
export const fetchVendorGrievances = async (token) => {
  const res = await fetch(`${API_URL}/vendor/grievances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

/**
 * Fetch all vendor grievances for admin desk
 * @param {{username:string,password:string}} session
 */
export const fetchAdminVendorGrievances = async (session) => {
  const res = await fetch(`${API_URL}/admin/vendor-grievances`, {
    headers: buildAdminHeaders(session),
  });
  return res.json();
};

/**
 * Update a vendor grievance from admin side
 * @param {number} grievanceId
 * @param {{status?:string,adminNote?:string}} updates
 * @param {{username:string,password:string}} session
 */
export const updateAdminVendorGrievance = async (grievanceId, updates, session) => {
  const res = await fetch(`${API_URL}/admin/vendor-grievances/${grievanceId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...buildAdminHeaders(session),
    },
    body: JSON.stringify(updates),
  });
  return res.json();
};

/**
 * Create a new vendor
 * @param {object} data
 * @param {{username:string,password:string}} session
 */
export const createVendor = async (data, session, foodCourt) => {
  const res = await fetch(`${API_URL}/admin/vendor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAdminHeaders(session) },
    body: JSON.stringify({ ...data, foodCourt }),
  });
  return res.json();
};

/**
 * Update a vendor
 * @param {number} vendorId
 * @param {object} data
 * @param {{username:string,password:string}} session
 */
export const updateVendor = async (vendorId, data, session, foodCourt) => {
  const url = new URL(`${API_URL}/admin/vendor/${vendorId}`);
  if (foodCourt) url.searchParams.set('foodCourt', foodCourt);
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...buildAdminHeaders(session) },
    body: JSON.stringify({ ...data, foodCourt }),
  });
  return res.json();
};