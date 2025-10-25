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
app.use(bodyParser.json());

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

// Helper functions
/**
 * Read menu JSON from disk.
 * @returns {Array<{shopId:string, shopName:string, items:Array}>}
 */
const getMenu = () => JSON.parse(fs.readFileSync(menuFile, "utf8"));
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
    const menu = getMenu();
    res.json(menu);
  } catch (error) {
    res.status(500).json({ message: "Error fetching menu" });
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
    const orders = getOrders();

    const billingId = generateBillingId();
    const totalAmount = items.reduce((sum, it) => sum + it.price * (it.quantity || 1), 0);
    
    const prepTime = calculatePreparationTime(items, shopId);
    const estimatedReadyTime = new Date(Date.now() + prepTime * 60000).toISOString();

    const newOrder = {
      id: orders.length + 1,
      items,
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
      items,
      estimatedReadyTime,
      prepTime
    };

    res.json({ 
      status: "success", 
      billingId, 
      orderSummary, 
      message: "Order placed!" 
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
    const updatedItems = req.body.items;
    const menu = getMenu();
    const vendorShopId = req.vendor.shopId;

    const shopIndex = menu.findIndex((shop) => shop.shopId === vendorShopId);
    if (shopIndex === -1) {
      return res.status(404).json({ message: "Vendor shop menu not found" });
    }

    menu[shopIndex].items = updatedItems;
    saveMenu(menu);
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