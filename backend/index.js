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

// Helper functions
const getMenu = () => JSON.parse(fs.readFileSync(menuFile, "utf8"));
const saveMenu = (menu) => fs.writeFileSync(menuFile, JSON.stringify(menu, null, 2));
const getOrders = () => JSON.parse(fs.readFileSync(ordersFile, "utf8"));
const saveOrders = (orders) => fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
const getVendors = () => JSON.parse(fs.readFileSync(vendorsFile, "utf8"));

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

  // Reset counter if new day
  if (billingData.date !== today) {
    billingData = { date: today, counter: 0 };
  }

  // Increment counter
  billingData.counter += 1;

  // Wrap around at 99999
  if (billingData.counter > 99999) {
    billingData.counter = 1;
  }

  saveBillingCounter(billingData);

  // Format as 5-digit string
  return billingData.counter.toString().padStart(5, '0');
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

// Place order with 5-digit billing ID
app.post("/order", (req, res) => {
  try {
    const { items, user, scheduledTime, shopId } = req.body;
    const orders = getOrders();

    const billingId = generateBillingId();
    const totalAmount = items.reduce((sum, it) => sum + it.price * (it.quantity || 1), 0);

    const newOrder = {
      id: orders.length + 1,
      items,
      shopId,
      user: user || "Anonymous",
      scheduledTime: scheduledTime || null,
      status: "pending",
      createdAt: new Date().toISOString(),
      billingId,
      estimatedReadyTime: new Date(Date.now() + 60000).toISOString() // 1 minute from now
    };

    orders.push(newOrder);
    saveOrders(orders);

    const orderSummary = {
      billingId,
      user: newOrder.user,
      totalAmount,
      items,
      estimatedReadyTime: newOrder.estimatedReadyTime
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

    const match = await bcrypt.compare(password, vendor.passwordHash);
    if (!match) {
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
    const orders = getOrders().filter((o) => o.shopId === req.vendor.shopId);
    const totalOrders = orders.length;

    const itemCounts = {};
    for (const order of orders) {
      for (const item of order.items) {
        const itemName = item.name;
        if (!itemCounts[itemName]) itemCounts[itemName] = 0;
        itemCounts[itemName] += item.quantity || 1;
      }
    }

    const popularItems = Object.entries(itemCounts).map(([name, count]) => ({
      name,
      count
    }));

    res.json({ totalOrders, popularItems });
  } catch (error) {
    res.status(500).json({ message: "Error fetching analytics" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Images served from: http://localhost:${PORT}/images/`);
});