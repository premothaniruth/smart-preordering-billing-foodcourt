const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "MySuperSecretKeyForJWT";

app.use(cors());
app.use(bodyParser.json());

// File paths
const menuFile = __dirname + "/data/menu.json";
const ordersFile = __dirname + "/data/orders.json";
const vendorsFile = __dirname + "/data/vendors.json";

// Helper functions to read/write JSON files
const getMenu = () => JSON.parse(fs.readFileSync(menuFile, "utf8"));
const saveMenu = (menu) => fs.writeFileSync(menuFile, JSON.stringify(menu, null, 2));
const getOrders = () => JSON.parse(fs.readFileSync(ordersFile, "utf8"));
const saveOrders = (orders) => fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
const getVendors = () => JSON.parse(fs.readFileSync(vendorsFile, "utf8"));

// Middleware: Authenticate vendor JWT token
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

// Get menu (accessible to all users)
app.get("/menu", (req, res) => {
  try {
    const menu = getMenu();
    res.json(menu);
  } catch (error) {
    res.status(500).json({ message: "Error fetching menu" });
  }
});

// Place order (accessible to all users)
app.post("/order", (req, res) => {
  try {
    const { items, user, scheduledTime, shopId } = req.body;
    const orders = getOrders();

    const newOrder = {
      id: orders.length + 1,
      items,
      shopId,
      user: user || "Anonymous",
      scheduledTime: scheduledTime || null,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    orders.push(newOrder);
    saveOrders(orders);
    res.json({ status: "success", orderId: newOrder.id, message: "Order placed!" });
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

// Update menu (vendor only - updates their shop's menu)
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

// Get orders for vendor's shop only
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

// Mark order as ready (vendor only)
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

// Get analytics for vendor's shop
app.get("/analytics", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders().filter((o) => o.shopId === req.vendor.shopId);
    const totalOrders = orders.length;

    // Count item popularity
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

// ========== START SERVER ==========

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});