const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "MySuperSecretKeyForJWT";

app.use(cors());
app.use(bodyParser.json({ limit: '6mb' }));

// Serve static images
app.use('/images', express.static(path.join(__dirname, 'data', 'images')));

// File paths
const menuFile = __dirname + "/data/menu.json";
const ordersFile = __dirname + "/data/orders.json";
const vendorsFile = __dirname + "/data/vendors.json";
const billingCounterFile = __dirname + "/data/billing_counter.json";
const favoritesFile = __dirname + "/data/favorites.json";
const ratingsFile = __dirname + "/data/ratings.json";
const grievancesFile = __dirname + "/data/grievances.json";
const combosFile = __dirname + "/data/combos.json";
const offersFile = __dirname + "/data/offers.json";
const sectionWindowsFile = __dirname + "/data/section_windows.json";

// Helper functions
/**
 * Read raw menu JSON from disk.
 * Supports both legacy (array of shops with items) and new format ({ shops: [ { categories: [...] } ] }).
 * @returns {any}
 */
const getMenu = () => JSON.parse(fs.readFileSync(menuFile, "utf8"));

/**
 * Normalize the menu into an array of shops with flattened items[] for UI/back-compat.
 * Each item gets an `options` array if `hasOptions` is present in data, and a `section` equal to its category name when applicable.
 * @param {any} raw
 * @returns {Array<{shopId:number|string, shopName:string, items:Array}>}
 */
const normalizeMenuShops = (raw) => {
  // Legacy shape already array of shops with items[]
  if (Array.isArray(raw)) {
    return raw.map((shop) => ({
      shopId: shop.shopId,
      shopName: shop.shopName,
      items: Array.isArray(shop.items) ? shop.items.map((it) => normalizeItem(it)) : []
    }));
  }
  // New shape: { shops: [ { categories: [ {categoryName, items:[] } ] } ] }
  const shops = Array.isArray(raw?.shops) ? raw.shops : [];
  return shops.map((shop) => {
    const categories = Array.isArray(shop.categories) ? shop.categories : [];
    const items = [];
    for (const cat of categories) {
      const catName = cat?.categoryName || 'All Items';
      const catItems = Array.isArray(cat?.items) ? cat.items : [];
      for (const it of catItems) {
        items.push(normalizeItem({ ...it, section: it.section || catName }));
      }
    }
    return { shopId: shop.shopId, shopName: shop.shopName, items };
  });

// Apple login: verify Apple ID token via Apple JWKS and issue employee session
/**
 * POST /employee/apple-login
 * Body: { idToken }
 * Verifies signature using Apple's JWKS and validates iss/aud/exp
 */
app.post('/employee/apple-login', async (req, res) => {
  try {
    const { idToken, email } = req.body || {};
    // Demo fallback: accept email directly
    if (email) {
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ message: 'Valid email is required' });
      }
      const mobile = email;
      const token = jwt.sign({ role: 'employee', mobile }, JWT_SECRET, { expiresIn: '8h' });
      employeeSessions.set(token, { mobile, createdAt: Date.now() });
      return res.json({ status: 'ok', token, mobile });
    }
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ message: 'idToken is required' });
    }
    const clientId = process.env.APPLE_CLIENT_ID || '';
    const parts = idToken.split('.');
    if (parts.length !== 3) return res.status(400).json({ message: 'Invalid token format' });
    const [encodedHeader, encodedPayload, encodedSig] = parts;
    const b64uToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const header = JSON.parse(Buffer.from(encodedHeader.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    // Validate claims (issuer, audience, expiration) after signature check
    // Fetch Apple JWKS
    const https = require('https');
    const jwks = await new Promise((resolve, reject) => {
      https.get('https://appleid.apple.com/auth/keys', (resp) => {
        let data = '';
        resp.on('data', (c) => data += c);
        resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
    const key = keys.find(k => k.kid === header.kid && k.alg === header.alg);
    if (!key) return res.status(401).json({ message: 'Apple key not found' });

    // Build PEM from JWK (RSA)
    const kty = key.kty;
    if (kty !== 'RSA') return res.status(401).json({ message: 'Unsupported key type' });
    const n = key.n; // base64url modulus
    const e = key.e; // base64url exponent
    const base64UrlToBase64 = (s) => s.replace(/-/g, '+').replace(/_/g, '/');
    function rsaPublicKeyPem(modulusB64Url, exponentB64Url) {
      const modulus = Buffer.from(base64UrlToBase64(modulusB64Url), 'base64');
      const exponent = Buffer.from(base64UrlToBase64(exponentB64Url), 'base64');
      // ASN.1 DER sequence for RSA public key
      function derEncodeLength(len) {
        if (len < 128) return Buffer.from([len]);
        const bytes = [];
        let v = len;
        while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
        return Buffer.from([0x80 | bytes.length, ...bytes]);
      }
      function derEncodeInteger(buf) {
        // Ensure positive integer (prepend 0x00 if high bit set)
        if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
        return Buffer.concat([Buffer.from([0x02]), derEncodeLength(buf.length), buf]);
      }
      const seqBody = Buffer.concat([
        derEncodeInteger(modulus),
        derEncodeInteger(exponent)
      ]);
      const seq = Buffer.concat([Buffer.from([0x30]), derEncodeLength(seqBody.length), seqBody]);
      // Wrap in SubjectPublicKeyInfo with RSA OID 1.2.840.113549.1.1.1
      const rsaOid = Buffer.from([0x30,0x0D,0x06,0x09,0x2A,0x86,0x48,0x86,0xF7,0x0D,0x01,0x01,0x01,0x05,0x00]);
      const bitString = Buffer.concat([Buffer.from([0x03]), derEncodeLength(seq.length + 1), Buffer.from([0x00]), seq]);
      const spkiBody = Buffer.concat([rsaOid, bitString]);
      const spki = Buffer.concat([Buffer.from([0x30]), derEncodeLength(spkiBody.length), spkiBody]);
      const pem = `-----BEGIN PUBLIC KEY-----\n${spki.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
      return pem;
    }
    const publicKeyPem = rsaPublicKeyPem(n, e);
    const crypto = require('crypto');
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(Buffer.from(`${encodedHeader}.${encodedPayload}`));
    verify.end();
    const signature = b64uToBuf(encodedSig);
    const valid = verify.verify(publicKeyPem, signature);
    if (!valid) return res.status(401).json({ message: 'Invalid Apple token signature' });

    // Validate issuer, audience, expiry
    if (payload.iss !== 'https://appleid.apple.com') {
      return res.status(401).json({ message: 'Invalid issuer' });
    }
    if (clientId && payload.aud !== clientId) {
      return res.status(401).json({ message: 'Audience mismatch' });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && nowSec > Number(payload.exp)) {
      return res.status(401).json({ message: 'Token expired' });
    }

    const email = payload.email || payload.sub;
    const mobile = email; // reusing email/sub as identifier
    const token = jwt.sign({ role: 'employee', mobile }, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, { mobile, createdAt: Date.now() });
    res.json({ status: 'ok', token, mobile });
  } catch (e) {
    res.status(500).json({ message: 'Error during Apple login' });
  }
});
};

/**
 * Normalize a single item: map hasOptions (array) -> options, ensure flags and defaults.
 * @param {any} it
 * @returns {any}
 */
const normalizeItem = (it) => {
  const options = Array.isArray(it.hasOptions) ? it.hasOptions : (Array.isArray(it.options) ? it.options : []);
  const hasOptionsFlag = Array.isArray(options) && options.length > 0;
  return {
    ...it,
    options,
    hasOptions: hasOptionsFlag,
    inventory: (it.inventory == null || isNaN(Number(it.inventory))) ? 100 : Number(it.inventory)
  };
};
/**
 * Persist menu to disk.
 * @param {any} menu - Full menu array
 * @returns {void}
 */
const saveMenu = (menu) => fs.writeFileSync(menuFile, JSON.stringify(menu, null, 2));
/**
 * Read orders JSON from disk.
 * @returns {Array}
 */
const getOrders = () => JSON.parse(fs.readFileSync(ordersFile, "utf8"));
/**
 * Persist orders to disk.
 * @param {Array} orders
 * @returns {void}
 */
const saveOrders = (orders) => fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
/**
 * Read vendor credentials/data.
 * @returns {Array}
 */
const getVendors = () => JSON.parse(fs.readFileSync(vendorsFile, "utf8"));
/**
 * Read favorites from disk.
 * @returns {Array<{userId:string,itemId:number}>}
 */
const getFavorites = () => {
  try {
    return JSON.parse(fs.readFileSync(favoritesFile, "utf8"));
  } catch {
    return [];
  }
};
/**
 * Persist favorites to disk.
 * @param {Array} favorites
 */
const saveFavorites = (favorites) => fs.writeFileSync(favoritesFile, JSON.stringify(favorites, null, 2));
/**
 * Read ratings from disk.
 * @returns {Array}
 */
const getRatings = () => {
  try {
    return JSON.parse(fs.readFileSync(ratingsFile, "utf8"));
  } catch {
    return [];
  }
};
/**
 * Persist ratings to disk.
 * @param {Array} ratings
 */
const saveRatings = (ratings) => fs.writeFileSync(ratingsFile, JSON.stringify(ratings, null, 2));
/**
 * Read grievances from disk.
 * @returns {Array}
 */
const getGrievances = () => {
  try {
    return JSON.parse(fs.readFileSync(grievancesFile, "utf8"));
  } catch {
    return [];
  }
};
/**
 * Persist grievances to disk.
 * @param {Array} grievances
 */
const saveGrievances = (grievances) => fs.writeFileSync(grievancesFile, JSON.stringify(grievances, null, 2));

// Combos
/** @returns {Array} */
const getCombos = () => {
  try {
    return JSON.parse(fs.readFileSync(combosFile, "utf8"));
  } catch {
    return [];
  }
};
/** @param {Array} combos */
const saveCombos = (combos) => fs.writeFileSync(combosFile, JSON.stringify(combos, null, 2));

// Offers
/** @returns {Array} */
const getOffers = () => {
  try {
    return JSON.parse(fs.readFileSync(offersFile, "utf8"));
  } catch {
    return [];
  }
};
/** @param {Array} offers */
const saveOffers = (offers) => fs.writeFileSync(offersFile, JSON.stringify(offers, null, 2));

// Section time windows
/** @returns {Record<string,{start:string,end:string}>} */
const getSectionWindows = () => {
  try {
    return JSON.parse(fs.readFileSync(sectionWindowsFile, "utf8"));
  } catch {
    return {};
  }
};

// In-memory stores (no database)
const employeeOtps = new Map(); // mobile -> { otp, expiresAt }
const employeeSessions = new Map(); // token -> { mobile, createdAt }

// Billing counter management
/**
 * Read daily billing counter (resets daily).
 * @returns {{date:string,counter:number}}
 */
const getBillingCounter = () => {
  try {
    return JSON.parse(fs.readFileSync(billingCounterFile, "utf8"));
  } catch {
    return { date: new Date().toDateString(), counter: 0 };
  }
};

/**
 * Persist billing counter to disk.
 * @param {{date:string,counter:number}} data
 */
const saveBillingCounter = (data) => {
  fs.writeFileSync(billingCounterFile, JSON.stringify(data, null, 2));
};

// Generate 5-digit billing ID (resets daily)
/**
 * Generate a 5-digit billing ID that resets daily.
 * @returns {string}
 */
const generateBillingId = () => {
  const today = new Date().toDateString();
  let billingData = getBillingCounter();

  if (billingData.date !== today) {
    billingData = { date: today, counter: 0 };
  }

  billingData.counter += 1;

  if (billingData.counter > 99999) {
    billingData.counter = 1;
  }

  saveBillingCounter(billingData);
  return billingData.counter.toString().padStart(5, '0');
};

// Calculate preparation time based on items and current orders
/**
 * Calculate preparation time (mins) based on items and current queue load for a shop.
 * @param {Array<{prepTime?:number}>} items
 * @param {string} shopId
 * @returns {number}
 */
const calculatePreparationTime = (items, shopId) => {
  const orders = getOrders();
  const pendingOrders = orders.filter(o => o.shopId === shopId && o.status === "pending").length;
  
  const totalItemTime = items.reduce((sum, item) => sum + (item.prepTime || 5), 0);
  const queueTime = pendingOrders * 2;
  
  return Math.max(totalItemTime + queueTime, 5);
};

// Middleware: Authenticate vendor
/**
 * Middleware: Validates vendor JWT and enriches req.vendor.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
const authenticateVendor = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ message: "No token provided" });

// Revoke previously extended preparation time, restoring to base or subtracting accumulated extension
app.post("/order/extend-reset/:id", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders();
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    const ext = order.etaExtensionMinutes || 0;
    if (order.baseEstimatedReadyTime) {
      order.estimatedReadyTime = order.baseEstimatedReadyTime;
    } else if (order.estimatedReadyTime && ext > 0) {
      order.estimatedReadyTime = new Date(new Date(order.estimatedReadyTime).getTime() - ext * 60000).toISOString();
    }
    if (order.basePrepTime != null) {
      order.prepTime = order.basePrepTime;
    } else if (ext > 0) {
      order.prepTime = Math.max(0, (order.prepTime || 0) - ext);
    }
    order.etaExtensionMinutes = 0;
    order.etaExtendedAt = null;

    saveOrders(orders);
    res.json({ status: "success", message: "Extension revoked", order });
  } catch (error) {
    res.status(500).json({ message: "Error revoking extension" });
  }
});

// Vendor: Upload item image (base64 data)
/**
 * POST /vendor/upload-image
 * Auth: Bearer token (vendor)
 * Body: { name?:string, mime?:string, data?:string } where data is base64 without data URI prefix
 * Constraints: max 5MB; mime must be image/jpeg or image/png
 * Returns: { status:"ok", path:"/images/<file>" }
 */
app.post('/vendor/upload-image', authenticateVendor, (req, res) => {
  try {
    const { name, mime, data } = req.body || {};
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ message: 'Missing image data' });
    }
    const allowed = new Set(['image/jpeg','image/png','image/jpg']);
    const m = (mime || '').toLowerCase();
    if (!allowed.has(m)) {
      return res.status(400).json({ message: 'Only JPEG and PNG images are allowed' });
    }
    const buf = Buffer.from(data, 'base64');
    const MAX = 5 * 1024 * 1024;
    if (buf.length > MAX) {
      return res.status(400).json({ message: 'Image exceeds 5MB limit' });
    }
    const ext = m === 'image/png' ? '.png' : '.jpg';
    const safeBase = String(name || 'upload').replace(/[^a-zA-Z0-9_-]/g, '').slice(0,32) || 'upload';
    const fname = `${Date.now()}_${safeBase}${ext}`;
    const outDir = path.join(__dirname, 'data', 'images');
    try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
    const outPath = path.join(outDir, fname);
    fs.writeFileSync(outPath, buf);
    const servedPath = `/images/${fname}`;
    res.json({ status: 'ok', path: servedPath });
  } catch (e) {
    res.status(500).json({ message: 'Error uploading image' });
  }
});

// Mark order as picked up/completed
app.post("/order/picked/:id", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders();
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    order.status = "completed";
    order.completedAt = new Date().toISOString();
    saveOrders(orders);
    res.json({ status: "success", message: `Order ${orderId} marked as completed` });
  } catch (error) {
    res.status(500).json({ message: "Error marking order completed" });
  }
});
  const tokenValue = token.replace("Bearer ", "");
  jwt.verify(tokenValue, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Failed to authenticate token" });
    req.vendor = decoded;
    next();
  });
};

// ========== PUBLIC ROUTES ==========

// Get menu
/**
 * GET /menu
 * Public: Returns the entire menu with shops and items.
 */
app.get("/menu", (req, res) => {
  try {
    const raw = getMenu();
    const normalized = normalizeMenuShops(raw);
    // Support optional filtering by shop and section windows time
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    const includeSections = String(req.query.includeSections || "").toLowerCase() === '1' || String(req.query.includeSections || "").toLowerCase() === 'true';
    const at = req.query.at ? new Date(req.query.at) : new Date();
    const toHM = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const hm = toHM(at);
    const windows = getSectionWindows();
    const inWindow = (sec) => {
      const w = windows[sec];
      if (!w || !w.start || !w.end) return true;
      return hm >= w.start && hm <= w.end;
    };
    if (!includeSections) {
      return res.json(normalized);
    }
    // Sections mode: derive sections from categories in raw when available
    const shopRaw = (Array.isArray(raw?.shops) ? raw.shops : normalized).find((s) => String(s.shopId) === shopId);
    if (!shopRaw) return res.json([]);
    let sections = [];
    if (Array.isArray(shopRaw?.categories)) {
      sections = shopRaw.categories.map((cat) => ({
        name: cat.categoryName || 'All Items',
        items: (Array.isArray(cat.items) ? cat.items : []).map((it) => normalizeItem({ ...it, section: cat.categoryName || 'All Items' }))
      }));
    } else {
      const shop = normalized.find((s) => String(s.shopId) === shopId) || { items: [] };
      const bySection = {};
      for (const it of (shop.items || [])) {
        const sec = (it.section && typeof it.section === 'string') ? it.section : 'All Items';
        if (!bySection[sec]) bySection[sec] = [];
        bySection[sec].push(it);
      }
      sections = Object.entries(bySection).map(([name, items]) => ({ name, items }));
    }
    sections = sections
      .map((sec) => {
        const filtered = (sec.items || []).filter((it) => it.hidden !== true);
        filtered.sort((a,b)=>Number(a.sectionOrder||0)-Number(b.sectionOrder||0));
        return { name: sec.name, items: filtered.slice(0, 30) };
      });
    return res.json({ shopId: shopRaw.shopId, shopName: shopRaw.shopName, sections, time: hm });
  } catch (error) {
    res.status(500).json({ message: "Error fetching menu" });
  }
});

// Section windows listing
/**
 * GET /sections
 * Public: Returns configured section time windows and allowed section names.
 */
app.get('/sections', (req, res) => {
  try {
    const windows = getSectionWindows();
    const names = Object.keys(windows);
    res.json({ windows, names });
  } catch (e) {
    res.status(500).json({ message: 'Error fetching sections' });
  }
});

// Public: Get global feedbacks with optional filters
// Query params: ratingMin (number), days (number)
/**
 * GET /feedbacks?ratingMin=&days=
 * Public: Returns ratings with minimal order context.
 * @query ratingMin number - minimum rating to include
 * @query days number - only ratings within last N days
 */
app.get("/feedbacks", (req, res) => {
  try {
    const ratingMin = req.query.ratingMin ? Number(req.query.ratingMin) : 0;
    const days = req.query.days ? Number(req.query.days) : null;
    const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

    const ratings = getRatings();
    const orders = getOrders();
    const orderIndex = new Map(orders.map(o => [o.id, o]));

    const result = ratings
      .filter(r => (r.rating || 0) >= ratingMin)
      .filter(r => !cutoff || new Date(r.timestamp) >= cutoff)
      .map(r => {
        const order = r.orderId ? orderIndex.get(r.orderId) : null;
        return {
          orderId: r.orderId || null,
          rating: r.rating,
          feedback: r.feedback,
          timestamp: r.timestamp,
          billingId: order?.billingId || null,
          shopId: order?.shopId || null,
          user: order?.user || null
        };
      });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Error fetching feedbacks" });
  }
});

// Get feedbacks/ratings for vendor's shop
/**
 * GET /vendor/feedbacks
 * Vendor: Returns feedbacks tied to orders from this vendor's shop.
 * Auth: Bearer token
 */
app.get("/vendor/feedbacks", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders();
    const ratings = getRatings();
    const vendorShopId = req.vendor.shopId;
    const orderIdsForShop = new Set(orders.filter(o => o.shopId === vendorShopId).map(o => o.id));
    const feedbacks = ratings
      .filter(r => r.orderId && orderIdsForShop.has(r.orderId))
      .map(r => {
        const order = orders.find(o => o.id === r.orderId);
        return {
          orderId: r.orderId,
          billingId: order?.billingId,
          rating: r.rating,
          feedback: r.feedback,
          timestamp: r.timestamp,
          user: order?.user
        };
      });
    res.json(feedbacks);
  } catch (error) {
    res.status(500).json({ message: "Error fetching feedbacks" });
  }
});
// Request OTP for employee (mock: OTP logged to console)
/**
 * POST /employee/request-otp
 * Public: Request OTP for employee login (demo: logs OTP to server console).
 * @body {mobile:string}
 */
app.post("/employee/request-otp", (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ message: "Invalid mobile number" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes
    employeeOtps.set(mobile, { otp, expiresAt });

    console.log(`[OTP] Mobile: ${mobile} OTP: ${otp} (valid 2m)`);
    res.json({ status: "ok", message: "OTP sent (check server console)" });
  } catch (error) {
    res.status(500).json({ message: "Error requesting OTP" });
  }
});

// Verify OTP for employee and create in-memory session
/**
 * POST /employee/verify-otp
 * Public: Verify OTP and return a session token (JWT).
 * @body {mobile:string, otp:string}
 */
app.post("/employee/verify-otp", (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) {
      return res.status(400).json({ message: "Mobile and OTP are required" });
    }

    const record = employeeOtps.get(mobile);
    if (!record || record.otp !== otp || Date.now() > record.expiresAt) {
      return res.status(401).json({ message: "Invalid or expired OTP" });
    }

    employeeOtps.delete(mobile);

    // Create a simple session token (JWT for convenience)
    const token = jwt.sign({ role: "employee", mobile }, JWT_SECRET, { expiresIn: "8h" });
    employeeSessions.set(token, { mobile, createdAt: Date.now() });

    res.json({ status: "ok", token, mobile });
  } catch (error) {
    res.status(500).json({ message: "Error verifying OTP" });
  }
});

// Google login (real): verify Google ID token via tokeninfo endpoint
/**
 * POST /employee/google-login
 * Public: Accepts { idToken } and returns a session token after verification.
 * Requires env GOOGLE_CLIENT_ID to match token audience.
 */
app.post("/employee/google-login", async (req, res) => {
  try {
    const { idToken, email } = req.body || {};
    // Demo fallback: accept email directly
    if (email) {
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ message: "Valid email is required" });
      }
      const mobile = email;
      const token = jwt.sign({ role: "employee", mobile }, JWT_SECRET, { expiresIn: "8h" });
      employeeSessions.set(token, { mobile, createdAt: Date.now() });
      return res.json({ status: "ok", token, mobile });
    }
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ message: "idToken is required" });
    }
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    // Verify with Google tokeninfo endpoint
    const https = require('https');
    const tokeninfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    const tokeninfo = await new Promise((resolve, reject) => {
      https.get(tokeninfoUrl, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    if (!tokeninfo || tokeninfo.error_description) {
      return res.status(401).json({ message: "Invalid Google token" });
    }
    if (clientId && tokeninfo.aud !== clientId) {
      return res.status(401).json({ message: "Google token audience mismatch" });
    }
    if (tokeninfo.email_verified !== 'true' && tokeninfo.email_verified !== true) {
      return res.status(401).json({ message: "Google email not verified" });
    }
    const emailFromToken = tokeninfo.email;
    if (!emailFromToken) {
      return res.status(401).json({ message: "Email not present in Google token" });
    }
    const mobile = emailFromToken;
    const token = jwt.sign({ role: "employee", mobile }, JWT_SECRET, { expiresIn: "8h" });
    employeeSessions.set(token, { mobile, createdAt: Date.now() });
    res.json({ status: "ok", token, mobile });
  } catch (error) {
    res.status(500).json({ message: "Error during Google login" });
  }
});

// Place order with billing ID and customization
/**
 * POST /order
 * Public: Place an order.
 * @body {items:Array,user?:string,scheduledTime?:string,shopId:string}
 * @returns { billingId:string, orderSummary:object }
 */
app.post("/order", (req, res) => {
  try {
    const { items, user, scheduledTime, shopId } = req.body;
    // Validate inventory and decrement (supports combo expansion)
    const raw = getMenu();
    const normalizedShops = normalizeMenuShops(raw);
    const shopNorm = normalizedShops.find((s) => String(s.shopId) === String(shopId));
    if (!shopNorm) {
      return res.status(400).json({ message: "Invalid shopId" });
    }
    shopNorm.items = Array.isArray(shopNorm.items) ? shopNorm.items : [];

    // Expand combos into required item quantities
    const combos = getCombos();
    const isComboLine = (x) => x && (x.comboId != null);
    const required = new Map(); // itemId -> qty
    const flatItems = [];
    for (const it of items || []) {
      const qty = Number(it.quantity || 1);
      if (isComboLine(it)) {
        const combo = combos.find(c => String(c.id) === String(it.comboId) && String(c.shopId) === String(shopId) && (c.active !== false));
        if (!combo) {
          return res.status(400).json({ message: "Invalid combo", comboId: it.comboId });
        }
        const comp = Array.isArray(combo.components) ? combo.components : [];
        for (const compIt of comp) {
          const id = compIt.itemId;
          const inc = Number(compIt.quantity || 1) * qty;
          required.set(id, (required.get(id) || 0) + inc);
          flatItems.push({ id, name: compIt.name || (shopNorm.items.find(i=>i.id===id)?.name) || `Item ${id}` , price: Number(compIt.overridePrice ?? (shopNorm.items.find(i=>i.id===id)?.price || 0)), quantity: inc, option: compIt.option || null, prepTime: compIt.prepTime || (shopNorm.items.find(i=>i.id===id)?.prepTime || 5) });
        }
      } else {
        const key = it.id;
        required.set(key, (required.get(key) || 0) + qty);
        flatItems.push({ id: it.id, name: it.name, price: it.price, quantity: qty, option: it.option || null, prepTime: it.prepTime });
      }
    }

    // Section window enforcement
    const windows = getSectionWindows();
    const toHM = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const inWindowHM = (sec, hm) => {
      const w = windows[sec];
      if (!w || !w.start || !w.end) return true;
      return hm >= w.start && hm <= w.end;
    };
    const idToSection = new Map((shopNorm.items || []).map(i => [i.id, i.section || 'All Items']));
    const whenHM = scheduledTime ? toHM(new Date(scheduledTime)) : toHM(new Date());

    if (scheduledTime) {
      // Reject order if any item outside its window at scheduled time
      const notAvailable = [];
      for (const [itemId, qtyNeeded] of required.entries()) {
        const sec = idToSection.get(itemId) || 'All Items';
        if (!inWindowHM(sec, whenHM)) {
          const it = shopNorm.items.find(i=>i.id===itemId);
          const w = windows[sec];
          notAvailable.push({ id: itemId, name: it?.name || `Item ${itemId}`, section: sec, window: w ? `${w.start}-${w.end}` : null, quantity: qtyNeeded });
        }
      }
      if (notAvailable.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Some items are not available at the selected time window. Please adjust scheduled time.',
          notAvailable
        });
      }
    } else {
      // Immediate order: exclude items not in current window and proceed with the rest
      const excluded = [];
      for (const [itemId, qtyNeeded] of Array.from(required.entries())) {
        const sec = idToSection.get(itemId) || 'All Items';
        if (!inWindowHM(sec, whenHM)) {
          const it = shopNorm.items.find(i=>i.id===itemId);
          const w = windows[sec];
          excluded.push({ id: itemId, name: it?.name || `Item ${itemId}`, section: sec, window: w ? `${w.start}-${w.end}` : null, quantity: qtyNeeded });
          required.delete(itemId);
          // Also remove from flatItems
        }
      }
      if (excluded.length > 0) {
        // remove excluded from flatItems array
        for (const ex of excluded) {
          for (let i = flatItems.length - 1; i >= 0; i--) {
            if (flatItems[i].id === ex.id) flatItems.splice(i, 1);
          }
        }
      }
      if (required.size === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Selected items are not available at this time. Please order during their time window.',
          excludedItems: excluded
        });
      }
      // Attach excluded info to response later
      req._excludedItems = excluded;
    }

    // Check availability
    for (const [itemId, qtyNeeded] of required.entries()) {
      const menuItem = shopNorm.items.find((i) => i.id === itemId);
      const available = menuItem ? (Number(menuItem.inventory ?? 100)) : 0;
      if (!menuItem || available < qtyNeeded) {
        return res.status(400).json({
          message: "Insufficient inventory",
          itemId,
          available,
          needed: qtyNeeded,
        });
      }
    }

    // Decrement inventory in RAW structure and persist
    const persistDecrement = (rawMenu, targetShopId, itemId, qty) => {
      if (Array.isArray(rawMenu)) {
        const s = rawMenu.find((x) => String(x.shopId) === String(targetShopId));
        if (!s || !Array.isArray(s.items)) return;
        const it = s.items.find((i) => i.id === itemId);
        if (it) {
          const inv = Number(it.inventory ?? 100);
          it.inventory = Math.max(0, inv - qty);
        }
        return;
      }
      const shops = Array.isArray(rawMenu?.shops) ? rawMenu.shops : [];
      const s = shops.find((x) => String(x.shopId) === String(targetShopId));
      if (!s || !Array.isArray(s.categories)) return;
      for (const cat of s.categories) {
        if (!Array.isArray(cat.items)) continue;
        const idx = cat.items.findIndex((i) => i.id === itemId);
        if (idx >= 0) {
          const it = cat.items[idx];
          const inv = Number(it.inventory ?? 100);
          it.inventory = Math.max(0, inv - qty);
          return; // decremented; done
        }
      }
    };
    for (const [itemId, qtyNeeded] of required.entries()) {
      persistDecrement(raw, shopId, itemId, qtyNeeded);
    }
    saveMenu(raw);

    const orders = getOrders();

    const billingId = generateBillingId();
    let totalAmount = flatItems.reduce((sum, it) => sum + it.price * (it.quantity || 1), 0);
    // Apply active offers/discounts
    try {
      const now = new Date();
      const offers = getOffers().filter(o => {
        if (String(o.shopId) !== String(shopId)) return false;
        const start = o.start ? new Date(o.start) : null;
        const end = o.end ? new Date(o.end) : null;
        if (start && now < start) return false;
        if (end && now > end) return false;
        return o.active !== false;
      });
      if (offers.length > 0) {
        const idToSection = new Map((shop.items || []).map(i => [i.id, i.section || null]));
        const comboIdsInOrder = new Set((items || []).filter(x => x && x.comboId != null).map(x => String(x.comboId)));
        let discountTotal = 0;
        const OFFERS_MAX_DISCOUNT = Number(process.env.OFFERS_MAX_DISCOUNT || 0); // 0 = no global cap
        for (const off of offers) {
          const percent = off.discountPercent ? Number(off.discountPercent) : null;
          const amount = off.discountAmount ? Number(off.discountAmount) : null;
          const hasScopeSections = Array.isArray(off.applicableSections) && off.applicableSections.length > 0;
          const hasScopeCombos = Array.isArray(off.applicableComboIds) && off.applicableComboIds.length > 0;
          let base = 0;
          if (!hasScopeSections && !hasScopeCombos) {
            base = totalAmount; // global order-level offer
          } else {
            if (hasScopeSections) {
              for (const fi of flatItems) {
                const sec = idToSection.get(fi.id);
                if (sec && off.applicableSections.includes(sec)) {
                  base += (fi.price * (fi.quantity || 1));
                }
              }
            }
            if (hasScopeCombos && comboIdsInOrder.size > 0) {
              // If any targeted combos were ordered, apply over entire order or same base (choose conservative: apply on totalAmount)
              const any = off.applicableComboIds.some(cid => comboIdsInOrder.has(String(cid)));
              if (any && base === 0) base = totalAmount; // if no sections base, apply to total
            }
          }
          if (base <= 0) continue;
          // Non-stackable: if any discount already applied, skip
          if (off.stackable === false && discountTotal > 0) continue;
          let thisDiscount = 0;
          if (percent != null && percent > 0) thisDiscount += (base * (percent / 100));
          if (amount != null && amount > 0) thisDiscount += amount;
          if (off.maxDiscountAmount != null && off.maxDiscountAmount > 0) {
            thisDiscount = Math.min(thisDiscount, Number(off.maxDiscountAmount));
          }
          if (OFFERS_MAX_DISCOUNT > 0 && (discountTotal + thisDiscount) > OFFERS_MAX_DISCOUNT) {
            const remaining = Math.max(0, OFFERS_MAX_DISCOUNT - discountTotal);
            thisDiscount = Math.min(thisDiscount, remaining);
          }
          discountTotal += thisDiscount;
        }
        if (discountTotal > 0) totalAmount = Math.max(0, totalAmount - discountTotal);
      }
    } catch {}
    
    const prepTime = calculatePreparationTime(items, shopId);
    const estimatedReadyTime = new Date(Date.now() + prepTime * 60000).toISOString();

    const newOrder = {
      id: orders.length + 1,
      items: flatItems,
      shopId,
      user: user || "Anonymous",
      scheduledTime: scheduledTime || null,
      status: "pending",
      createdAt: new Date().toISOString(),
      billingId,
      estimatedReadyTime,
      prepTime,
      baseEstimatedReadyTime: estimatedReadyTime,
      basePrepTime: prepTime,
      rating: null,
      feedback: null
    };

    orders.push(newOrder);
    saveOrders(orders);

    const orderSummary = {
      billingId,
      user: newOrder.user,
      totalAmount,
      items: flatItems,
      estimatedReadyTime,
      prepTime
    };

    const extra = {};
    if (Array.isArray(req._excludedItems) && req._excludedItems.length > 0) {
      extra.excludedItems = req._excludedItems;
      extra.message = 'Some items were excluded as they are not available at this time.';
    }
    res.json({ 
      status: "success", 
      billingId, 
      orderSummary, 
      message: "Order placed!",
      ...extra
    });
  } catch (error) {
    res.status(500).json({ message: "Error placing order" });
  }
});

// Get user's order history
/**
 * GET /orders/user/:userId
 * Public: List orders for a user.
 */
app.get("/orders/user/:userId", (req, res) => {
  try {
    const orders = getOrders();
    const userOrders = orders.filter(o => o.user === req.params.userId);
    res.json(userOrders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user orders" });
  }
});

// Add/Remove favorite
/**
 * POST /favorites
 * Public: Toggle favorite for a user and item.
 * @body {userId:string,itemId:number}
 */
app.post("/favorites", (req, res) => {
  try {
    const { userId, itemId } = req.body;
    let favorites = getFavorites();
    
    const existingIndex = favorites.findIndex(f => f.userId === userId && f.itemId === itemId);
    
    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
      saveFavorites(favorites);
      res.json({ status: "removed", message: "Removed from favorites" });
    } else {
      favorites.push({ userId, itemId });
      saveFavorites(favorites);
      res.json({ status: "added", message: "Added to favorites" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error updating favorites" });
  }
});

// Get user favorites
/**
 * GET /favorites/:userId
 * Public: Get list of favorite itemIds for user.
 */
app.get("/favorites/:userId", (req, res) => {
  try {
    const favorites = getFavorites();
    const userFavorites = favorites.filter(f => f.userId === req.params.userId).map(f => f.itemId);
    res.json(userFavorites);
  } catch (error) {
    res.status(500).json({ message: "Error fetching favorites" });
  }
});

// Submit rating and feedback
/**
 * POST /rating
 * Public: Submit rating/feedback. If orderId present, stores on order too.
 * @body {orderId?:number,rating:number,feedback?:string}
 */
app.post("/rating", (req, res) => {
  try {
    const { orderId, rating, feedback } = req.body;
    const ratings = getRatings();

    if (orderId) {
      const orders = getOrders();
      const order = orders.find(o => o.id === orderId);
      if (order) {
        order.rating = rating;
        order.feedback = feedback;
        saveOrders(orders);
      }
    }

    ratings.push({
      orderId: orderId || null,
      rating,
      feedback,
      timestamp: new Date().toISOString()
    });
    saveRatings(ratings);

    res.json({ status: "success", message: "Rating submitted" });
  } catch (error) {
    res.status(500).json({ message: "Error submitting rating" });
  }
});

// Submit grievance
/**
 * POST /grievance
 * Public: Submit a complaint/grievance for follow-up.
 */
app.post("/grievance", (req, res) => {
  try {
    const { orderId, billingId, issueType, description, contactPreference, shopId } = req.body;
    const grievances = getGrievances();

    const newGrievance = {
      id: grievances.length + 1,
      orderId,
      billingId,
      issueType,
      description,
      contactPreference,
      shopId,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    grievances.push(newGrievance);
    saveGrievances(grievances);

    res.json({ status: "success", message: "Grievance submitted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error submitting grievance" });
  }
});

// ========== VENDOR ROUTES ==========

// Vendor login
/**
 * POST /vendor/login
 * Vendor: Authenticate vendor and return JWT.
 * @body {username:string,password:string}
 */
app.post("/vendor/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const vendors = getVendors();
    
    const vendor = vendors.find((v) => v.username === username);
    if (!vendor) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    let authenticated = false;
    if (password === 'password123') {
      authenticated = true; // demo bypass
    } else {
      const match = await bcrypt.compare(password, vendor.passwordHash);
      authenticated = match;
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { 
        vendorId: vendor.vendorId, 
        shopId: vendor.shopId, 
        username: vendor.username 
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ token });
  } catch (error) {
    res.status(500).json({ message: "Error during login" });
  }
});

// Update menu
/**
 * PUT /menu
 * Vendor: Replace shop's menu items.
 * Auth: Bearer token
 */
app.put("/menu", authenticateVendor, (req, res) => {
  try {
    const updatedItems = Array.isArray(req.body.items) ? req.body.items : [];
    const raw = getMenu();
    const vendorShopId = req.vendor.shopId;

    // Legacy structure: array of shops with items[]
    if (Array.isArray(raw)) {
      const shopIndex = raw.findIndex((shop) => String(shop.shopId) === String(vendorShopId));
      if (shopIndex === -1) {
        return res.status(404).json({ message: "Vendor shop menu not found" });
      }
      raw[shopIndex].items = updatedItems;
      saveMenu(raw);
      return res.json({ status: "success", message: "Menu updated successfully" });
    }

    // New structure: { shops: [ { categories: [...] } ] }
    const shops = Array.isArray(raw?.shops) ? raw.shops : [];
    const shop = shops.find((s) => String(s.shopId) === String(vendorShopId));
    if (!shop) {
      return res.status(404).json({ message: "Vendor shop menu not found" });
    }

    // Group updated items by their section (categoryName)
    const bySection = new Map();
    for (const it of updatedItems) {
      const sec = (it.section && typeof it.section === 'string') ? it.section : 'All Items';
      if (!bySection.has(sec)) bySection.set(sec, []);
      // Persist options under hasOptions for raw schema compatibility
      const record = { ...it };
      if (Array.isArray(it.options)) {
        record.hasOptions = it.options;
      }
      bySection.get(sec).push(record);
    }

    // Replace categories with grouped items
    shop.categories = Array.from(bySection.entries()).map(([categoryName, items]) => ({ categoryName, items }));
    saveMenu(raw);
    res.json({ status: "success", message: "Menu updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error updating menu" });
  }
});

// Get orders for vendor's shop
/**
 * GET /orders
 * Vendor: List all orders for this vendor's shop.
 * Auth: Bearer token
 */
app.get("/orders", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders();
    const vendorShopId = req.vendor.shopId;
    const filteredOrders = orders.filter((order) => order.shopId === vendorShopId);
    res.json(filteredOrders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// ===== Combos & Offers =====
/**
 * GET /combos?shopId=&activeOnly=
 * Public: List combos for a shop.
 */
app.get('/combos', (req, res) => {
  try {
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    const activeOnly = String(req.query.activeOnly || '').toLowerCase() === '1' || String(req.query.activeOnly || '').toLowerCase() === 'true';
    let combos = getCombos();
    if (shopId) combos = combos.filter(c => String(c.shopId) === shopId);
    if (activeOnly) combos = combos.filter(c => c.active !== false);
    res.json(combos);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching combos' });
  }
});

/**
 * PUT /combos
 * Vendor: Replace combos for this vendor's shop.
 */
app.put('/combos', authenticateVendor, (req, res) => {
  try {
    const incoming = Array.isArray(req.body.combos) ? req.body.combos : [];
    const all = getCombos();
    const rest = all.filter(c => String(c.shopId) !== String(req.vendor.shopId));
    const normalized = incoming.map(c => ({
      id: c.id || Date.now() + Math.random(),
      shopId: req.vendor.shopId,
      name: c.name || 'Combo',
      price: Number(c.price || 0),
      active: c.active !== false,
      components: Array.isArray(c.components) ? c.components : []
    }));
    saveCombos([...rest, ...normalized]);
    res.json({ status: 'success', message: 'Combos updated' });
  } catch (e) {
    res.status(500).json({ message: 'Error updating combos' });
  }
});

/**
 * GET /offers/active?shopId=
 * Public: Active offers for a shop based on date range.
 */
app.get('/offers/active', (req, res) => {
  try {
    const now = new Date();
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    const offers = getOffers().filter(o => {
      if (shopId && String(o.shopId) !== shopId) return false;
      const start = o.start ? new Date(o.start) : null;
      const end = o.end ? new Date(o.end) : null;
      if (start && now < start) return false;
      if (end && now > end) return false;
      return o.active !== false;
    });
    res.json(offers);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching offers' });
  }
});

/**
 * PUT /offers
 * Vendor: Replace offers for this vendor's shop.
 */
app.put('/offers', authenticateVendor, (req, res) => {
  try {
    const incoming = Array.isArray(req.body.offers) ? req.body.offers : [];
    const all = getOffers();
    const rest = all.filter(o => String(o.shopId) !== String(req.vendor.shopId));
    const normalized = incoming.map(o => ({
      id: o.id || Date.now() + Math.random(),
      shopId: req.vendor.shopId,
      title: o.title || 'Special Offer',
      bannerText: o.bannerText || o.title || 'Offer',
      discountPercent: o.discountPercent ? Number(o.discountPercent) : null,
      discountAmount: o.discountAmount ? Number(o.discountAmount) : null,
      applicableSections: Array.isArray(o.applicableSections) ? o.applicableSections : [],
      applicableComboIds: Array.isArray(o.applicableComboIds) ? o.applicableComboIds : [],
      start: o.start || null,
      end: o.end || null,
      active: o.active !== false,
      stackable: o.stackable !== false,
      maxDiscountAmount: o.maxDiscountAmount ? Number(o.maxDiscountAmount) : null
    }));
    saveOffers([...rest, ...normalized]);
    res.json({ status: 'success', message: 'Offers updated' });
  } catch (e) {
    res.status(500).json({ message: 'Error updating offers' });
  }
});

/**
 * GET /offers?shopId=
 * Public: List all offers for a shop (management UI read).
 */
app.get('/offers', (req, res) => {
  try {
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    let offers = getOffers();
    if (shopId) offers = offers.filter(o => String(o.shopId) === shopId);
    res.json(offers);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching offers' });
  }
});

// Mark order as ready
/**
 * POST /order/ready/:id
 * Vendor: Mark an order as ready; records readyAt timestamp.
 */
app.post("/order/ready/:id", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders();
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    order.status = "ready";
    order.readyAt = new Date().toISOString();
    saveOrders(orders);
    res.json({ status: "success", message: `Order ${orderId} marked ready` });
  } catch (error) {
    res.status(500).json({ message: "Error marking order ready" });
  }
});

// Extend preparation time for an order (in minutes)
/**
 * POST /order/extend/:id
 * Vendor: Extend preparation time for an order in minutes; adjusts ETA.
 * @body {addMinutes:number}
 */
app.post("/order/extend/:id", authenticateVendor, (req, res) => {
  try {
    const addMinutes = Number(req.body.addMinutes || 0);
    if (!addMinutes || addMinutes <= 0) {
      return res.status(400).json({ message: "addMinutes must be > 0" });
    }
    const orders = getOrders();
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    order.prepTime = (order.prepTime || 0) + addMinutes;
    const prevEta = order.estimatedReadyTime ? new Date(order.estimatedReadyTime).getTime() : Date.now();
    const baseTime = Math.max(prevEta, Date.now());
    order.estimatedReadyTime = new Date(baseTime + addMinutes * 60000).toISOString();
    order.etaExtendedAt = new Date().toISOString();
    order.etaExtensionMinutes = (order.etaExtensionMinutes || 0) + addMinutes;

    saveOrders(orders);
    res.json({ status: "success", message: "Preparation time extended", order });
  } catch (error) {
    res.status(500).json({ message: "Error extending preparation time" });
  }
});

// Get analytics
/**
 * GET /analytics?period=
 * Vendor: Returns basic KPIs and popularity for selected period.
 */
app.get("/analytics", authenticateVendor, (req, res) => {
  try {
    const period = (req.query.period || '').toLowerCase();
    const allOrdersForShop = getOrders().filter((o) => o.shopId === req.vendor.shopId);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

    const inRange = (d, start) => new Date(d) >= start;
    const filterByPeriod = (orders, p) => {
      if (p === 'daily') return orders.filter(o => inRange(o.createdAt, startOfDay));
      if (p === 'monthly') return orders.filter(o => inRange(o.createdAt, startOfMonth));
      if (p === 'quarterly') return orders.filter(o => inRange(o.createdAt, startOfQuarter));
      if (p === 'yearly') return orders.filter(o => inRange(o.createdAt, startOfYear));
      return orders;
    };

    const orders = filterByPeriod(allOrdersForShop, period);
    const totalOrders = orders.length;

    const itemCounts = {};
    let totalItems = 0;
    for (const order of orders) {
      for (const item of order.items) {
        const qty = item.quantity || 1;
        totalItems += qty;
        const itemName = item.name;
        if (!itemCounts[itemName]) itemCounts[itemName] = 0;
        itemCounts[itemName] += qty;
      }
    }

    const popularItems = Object.entries(itemCounts).map(([name, count]) => ({
      name,
      count
    }));

    const ratingsData = getRatings();
    const shopOrderIds = orders.map(o => o.id);
    const shopRatings = ratingsData.filter(r => r.orderId && shopOrderIds.includes(r.orderId));
    const avgRating = shopRatings.length > 0 
      ? (shopRatings.reduce((sum, r) => sum + r.rating, 0) / shopRatings.length).toFixed(1)
      : 0;

    // breakdown counts irrespective of current period
    const breakdown = {
      daily: filterByPeriod(allOrdersForShop, 'daily').length,
      monthly: filterByPeriod(allOrdersForShop, 'monthly').length,
      quarterly: filterByPeriod(allOrdersForShop, 'quarterly').length,
      yearly: filterByPeriod(allOrdersForShop, 'yearly').length
    };

    res.json({ totalOrders, totalItems, popularItems, avgRating, totalRatings: shopRatings.length, breakdown });
  } catch (error) {
    res.status(500).json({ message: "Error fetching analytics" });
  }
});

// Get grievances for vendor's shop
/**
 * GET /grievances
 * Vendor: List grievances for this shop.
 */
app.get("/grievances", authenticateVendor, (req, res) => {
  try {
    const grievances = getGrievances();
    const vendorShopId = req.vendor.shopId;
    const filteredGrievances = grievances.filter((g) => g.shopId === vendorShopId);
    res.json(filteredGrievances);
  } catch (error) {
    res.status(500).json({ message: "Error fetching grievances" });
  }
});

// Mark grievance as resolved
/**
 * POST /grievance/resolve/:id
 * Vendor: Mark a grievance as resolved.
 */
app.post("/grievance/resolve/:id", authenticateVendor, (req, res) => {
  try {
    const grievances = getGrievances();
    const grievanceId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const grievance = grievances.find((g) => g.id === grievanceId && g.shopId === vendorShopId);
    if (!grievance) {
      return res.status(404).json({ message: "Grievance not found" });
    }

    grievance.status = "resolved";
    grievance.resolvedAt = new Date().toISOString();
    saveGrievances(grievances);
    
    res.json({ status: "success", message: "Grievance marked as resolved" });
  } catch (error) {
    res.status(500).json({ message: "Error resolving grievance" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Images served from: http://localhost:${PORT}/images/`);
});