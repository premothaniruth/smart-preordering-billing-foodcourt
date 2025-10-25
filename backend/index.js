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
const getMenu = () => JSON.parse(fs.readFileSync(menuFile, "utf8"));
const saveMenu = (menu) => fs.writeFileSync(menuFile, JSON.stringify(menu, null, 2));
const getOrders = () => JSON.parse(fs.readFileSync(ordersFile, "utf8"));
const saveOrders = (orders) => fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
const getVendors = () => JSON.parse(fs.readFileSync(vendorsFile, "utf8"));
const getFavorites = () => {
  try {
    return JSON.parse(fs.readFileSync(favoritesFile, "utf8"));
  } catch {
    return [];
  }
};
const saveFavorites = (favorites) => fs.writeFileSync(favoritesFile, JSON.stringify(favorites, null, 2));
const getRatings = () => {
  try {
    return JSON.parse(fs.readFileSync(ratingsFile, "utf8"));
  } catch {
    return [];
  }
};
const saveRatings = (ratings) => fs.writeFileSync(ratingsFile, JSON.stringify(ratings, null, 2));
const getGrievances = () => {
  try {
    return JSON.parse(fs.readFileSync(grievancesFile, "utf8"));
  } catch {
    return [];
  }
};
const saveGrievances = (grievances) => fs.writeFileSync(grievancesFile, JSON.stringify(grievances, null, 2));

// In-memory stores (no database)
const employeeOtps = new Map(); // mobile -> { otp, expiresAt }
const employeeSessions = new Map(); // token -> { mobile, createdAt }

// Billing counter management
const getBillingCounter = () => {
  try {
    return JSON.parse(fs.readFileSync(billingCounterFile, "utf8"));
  } catch {
    return { date: new Date().toDateString(), counter: 0 };
  }
};

const saveBillingCounter = (data) => {
  fs.writeFileSync(billingCounterFile, JSON.stringify(data, null, 2));
};

// Generate 5-digit billing ID (resets daily)
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
const calculatePreparationTime = (items, shopId) => {
  const orders = getOrders();
  const pendingOrders = orders.filter(o => o.shopId === shopId && o.status === "pending").length;
  
  const totalItemTime = items.reduce((sum, item) => sum + (item.prepTime || 5), 0);
  const queueTime = pendingOrders * 2;
  
  return Math.max(totalItemTime + queueTime, 5);
};

// Middleware: Authenticate vendor
const authenticateVendor = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ message: "No token provided" });

  const tokenValue = token.replace("Bearer ", "");
  jwt.verify(tokenValue, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Failed to authenticate token" });
    req.vendor = decoded;
    next();
  });
};

// ========== PUBLIC ROUTES ==========

// Get menu
app.get("/menu", (req, res) => {
  try {
    const menu = getMenu();
    res.json(menu);
  } catch (error) {
    res.status(500).json({ message: "Error fetching menu" });
  }
});

// Request OTP for employee (mock: OTP logged to console)
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
    saveOrders(orders);
    res.json({ status: "success", message: `Order ${orderId} marked ready` });
  } catch (error) {
    res.status(500).json({ message: "Error marking order ready" });
  }
});

// Get analytics
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