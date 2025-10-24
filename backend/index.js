const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = "MySuperSecretKeyForJWT"; // For production, use env variable

app.use(cors());
app.use(bodyParser.json());

const menuFile = __dirname + "/data/menu.json";
const ordersFile = __dirname + "/data/orders.json";
const vendorsFile = __dirname + "/data/vendors.json";

const getMenu = () => JSON.parse(fs.readFileSync(menuFile));
const saveMenu = (menu) => fs.writeFileSync(menuFile, JSON.stringify(menu, null, 2));
const getOrders = () => JSON.parse(fs.readFileSync(ordersFile));
const saveOrders = (orders) => fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
const getVendors = () => JSON.parse(fs.readFileSync(vendorsFile));

// Middleware to verify JWT tokens for vendor routes
const authenticateVendor = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ message: "No token provided" });

  jwt.verify(token.replace("Bearer ", ""), JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Failed to authenticate token" });
    req.vendor = decoded;
    next();
  });
};

// Vendor login - returns JWT token if credentials matched
app.post("/vendor/login", (req, res) => {
  const { username, password } = req.body;
  const vendors = getVendors();
  const vendor = vendors.find((v) => v.username === username);
  if (!vendor) return res.status(401).json({ message: "Invalid username or password" });

  bcrypt.compare(password, vendor.passwordHash).then((match) => {
    if (!match) return res.status(401).json({ message: "Invalid username or password" });

    const token = jwt.sign(
      { vendorId: vendor.vendorId, shopId: vendor.shopId, username: vendor.username },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({ token });
  });
});

// Get menu (no auth required)
app.get("/menu", (req, res) => {
  res.json(getMenu());
});

// Update menu (vendor-only, modifies only their shop menu items)
app.put("/menu", authenticateVendor, (req, res) => {
  const updatedItems = req.body.items; // Array of menu items with id, name, price, availability, under the vendor's shopId
  const menu = getMenu();
  const vendorShopId = req.vendor.shopId;

  const shopIndex = menu.findIndex((shop) => shop.shopId === vendorShopId);
  if (shopIndex === -1) return res.status(404).json({ message: "Vendor shop menu not found" });

  // Replace items in that shop with updatedItems
  menu[shopIndex].items = updatedItems;

  saveMenu(menu);
  res.json({ status: "success", message: "Menu updated successfully" });
});

// Place order (no auth required)
app.post("/order", (req, res) => {
  const { items, user, scheduledTime, shopId } = req.body;
  const orders = getOrders();

  const newOrder = {
    id: orders.length + 1,
    items,
    shopId,
    user: user || "Anonymous",
    scheduledTime: scheduledTime || null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  orders.push(newOrder);
  saveOrders(orders);
  res.json({ status: "success", orderId: newOrder.id, message: "Order placed!" });
});

// Get all orders (vendor only, only orders for their shop)
app.get("/orders", authenticateVendor, (req, res) => {
  const orders = getOrders();
  const vendorShopId = req.vendor.shopId;
  const filteredOrders = orders.filter((order) => order.shopId === vendorShopId);
  res.json(filteredOrders);
});

// Mark order ready (vendor only)
app.post("/order/ready/:id", authenticateVendor, (req, res) => {
  const orders = getOrders();
  const orderId = parseInt(req.params.id);
  const vendorShopId = req.vendor.shopId;

  const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
  if (!order) return res.status(404).json({ message: "Order not found for your shop" });

  order.status = "ready";
  saveOrders(orders);
  res.json({ status: "success", message: `Order ${orderId} marked ready` });
});

// Analytics: order count and most popular items (vendor only)
app.get("/analytics", authenticateVendor, (req, res) => {
  const orders = getOrders().filter((o) => o.shopId === req.vendor.shopId);

  // Total orders count
  const totalOrders = orders.length;

  // Count item popularity
  const itemCounts = {};
  for (const order of orders) {
    for (const item of order.items) {
      if (!itemCounts[item.name]) itemCounts[item.name] = 0;
      itemCounts[item.name]++;
    }
  }
  // Format for charts: array of { name, count }
  const popularItems = Object.entries(itemCounts).map(([name, count]) => ({ name, count }));

  res.json({ totalOrders, popularItems });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
