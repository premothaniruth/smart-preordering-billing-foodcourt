require("dotenv").config();

// Imports
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const fsPromises = require("fs/promises");
const http = require("http");
const { WebSocketServer } = require("ws");
const { URL } = require("url");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const { evaluateOffers } = require("./lib/offersEngine");
const {
  emitOrderCreatedEvent,
  emitOrderStatusEvent,
  emitOrderPrepExtendedEvent,
  emitInventoryAdjustedEvent,
} = require("./lib/analyticsEvents");
const analyticsConfig = require("./lib/analyticsConfig");
const { analyticsIngestor } = require("./lib/analyticsIngestor");
const { analyticsQueryService } = require("./lib/analyticsQueryService");
const { realtimeAnalyticsService } = require("./lib/realtimeAnalyticsService");
const { analyticsImportService } = require("./lib/analyticsImportService");
const { forecastingService } = require("./lib/forecastingService");
const { addHeadcountEntry, getVendorHeadcountEntries, removeVendorHeadcount } = require("./lib/headcountStore");
const { appendAuditEntry } = require("./lib/auditLogger");
const { metricsRegistry } = require("./lib/metricsRegistry");
const { runArchiveJob, loadMetadata } = require("./lib/archiveScheduler");
const { generateForecast } = require("./lib/forecastingModel");
const { startNightlyJobs, stopNightlyJobs } = require("./lib/nightlyScheduler");
const { getLatestAccuracyForVendor } = require("./lib/forecastingEvaluationService");
const {
  generateProcurementTask,
  listTasks: listProcurementTasks,
  getTaskById,
  updateTaskStatus,
} = require("./lib/procurementAutomationService");
const {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  generateTemplateId,
  listOrders,
  saveOrder,
  removeTemplatesForVendor,
  removeOrdersForVendor,
} = require("./lib/procurementStore");
const {
  listArchives: listVendorArchives,
  appendArchive: appendVendorArchive,
  removeArchiveById,
  findArchiveByVendorId,
} = require("./lib/vendorArchiveStore");
const {
  processOrderPoints,
  getEmployeePointsSummary,
  getPointsAdminReport,
  ensurePointsDataFiles,
} = require("./lib/pointsService");
const multer = require("multer");

// App setup
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/analytics" });

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "MySuperSecretKeyForJWT";

const analyticsBootstrapStateFile = path.join(__dirname, "data", "analytics_bootstrap_state.json");

const loadAnalyticsBootstrapState = () => {
  try {
    const raw = fs.readFileSync(analyticsBootstrapStateFile, "utf8");
    return JSON.parse(raw || "{}") || {};
  } catch {
    return {};
  }
};

const saveAnalyticsBootstrapState = (state) => {
  try {
    fs.writeFileSync(analyticsBootstrapStateFile, JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn("Failed to persist analytics bootstrap state", error);
  }
};

const bootstrapAnalyticsFromOrders = async () => {
  const state = loadAnalyticsBootstrapState();
  const previousByCourt = state && typeof state === 'object' ? state.byFoodCourt || {} : {};
  const nextByCourt = { ...previousByCourt };
  let globalMaxOrderId = Number(state?.lastOrderId || 0);

  for (const foodCourt of FOOD_COURTS) {
    const lastOrderId = Number(previousByCourt?.[foodCourt] ?? state?.lastOrderId ?? 0);
    const orders = getOrders(foodCourt);
    const pending = orders.filter((order) => Number(order.id) > lastOrderId);
    if (pending.length === 0) {
      continue;
    }

    const vendors = getVendors(foodCourt);
    const vendorByShop = new Map();
    vendors.forEach((vendor) => {
      if (vendor?.shopId != null) {
        vendorByShop.set(String(vendor.shopId), vendor);
      }
    });

    for (const order of pending) {
      const vendor = vendorByShop.get(String(order.shopId)) || null;
      try {
        await emitOrderCreatedEvent(order, {
          user: order.user || null,
          payment: order.payment || null,
          vendor,
          meta: { source: "bootstrap", foodCourt },
        });

        if (order.status) {
          await emitOrderStatusEvent(order, {
            vendor,
            previousStatus: null,
            actor: vendor
              ? {
                  type: "vendor",
                  vendorId: vendor.vendorId,
                  shopId: vendor.shopId,
                  username: vendor.username,
                }
              : { type: "system", source: "bootstrap" },
          });
        }
      } catch (error) {
        console.warn("Failed to bootstrap analytics event for order", order.id, error);
      }
    }

    const maxOrderId = pending.reduce((max, order) => Math.max(max, Number(order.id) || 0), lastOrderId);
    nextByCourt[foodCourt] = maxOrderId;
    globalMaxOrderId = Math.max(globalMaxOrderId, maxOrderId);
  }

  saveAnalyticsBootstrapState({ byFoodCourt: nextByCourt, lastOrderId: globalMaxOrderId });
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.ANALYTICS_IMPORT_MAX_SIZE || 15 * 1024 * 1024) },
});

const ARCHIVE_ROOT = path.join(__dirname, "data", "archive");
fsPromises.mkdir(ARCHIVE_ROOT, { recursive: true }).catch(() => {});

const decodeVendorToken = (token) => {
  if (!token) return null;
  const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
  try {
    const decoded = jwt.verify(raw, JWT_SECRET);
    if (!decoded || decoded.shopId == null) return null;
    return decoded;
  } catch (error) {
    return null;
  }
};

const enrichVendorContext = (decoded) => {
  const vendorCtx = { ...decoded };
  vendorCtx.vendorId = vendorCtx.vendorId ?? vendorCtx.id ?? vendorCtx.vendorID ?? null;
  vendorCtx.shopId = vendorCtx.shopId ?? vendorCtx.shopID ?? vendorCtx.shop ?? null;
  vendorCtx.role = "vendor-admin";
  vendorCtx.foodCourt = FOOD_COURTS.includes(String(vendorCtx.foodCourt)) ? String(vendorCtx.foodCourt) : FC_DEFAULT;
  const permissions = new Set(["analytics:read", "analytics:write", "procurement:manage"]);
  vendorCtx.permissions = Array.from(permissions);
  return vendorCtx;
};

const authenticateVendor = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ message: "No token provided" });

  const tokenValue = token.replace("Bearer ", "");
  jwt.verify(tokenValue, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Failed to authenticate token" });
    req.vendor = enrichVendorContext(decoded);
    next();
  });
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const assertAnalyticsAccess = (req) => {
  if (!req.vendor) {
    throw new Error("Analytics access requires vendor authentication");
  }
  if (!req.vendor.permissions?.includes("analytics:read")) {
    const error = new Error("Analytics permission denied");
    error.status = 403;
    throw error;
  }
  return req.vendor;
};

const requirePermission = (perm) => (req, res, next) => {
  if (!req.vendor?.permissions?.includes(perm)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
};

const recordAuditEvent = ({ actorType, actorId, shopId, vendorId, action, metadata }) => {
  appendAuditEntry({
    timestamp: new Date().toISOString(),
    actorType,
    actorId,
    shopId,
    vendorId,
    action,
    metadata,
  });
};

app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "uploads")));

ensurePointsDataFiles();

app.get("/healthz", (req, res) => {
  const summary = metricsRegistry.getHealthSummary();
  res.status(summary.healthy ? 200 : 503).json(summary);
});

app.get("/metrics", (req, res) => {
  const snapshot = metricsRegistry.getSnapshot();
  if (req.headers.accept && req.headers.accept.includes("text/plain")) {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metricsRegistry.toPrometheus());
  } else {
    res.json(snapshot);
  }
});

app.delete("/admin/vendor/:id", authenticateAdmin, (req, res) => {
  try {
    const vendorId = Number(req.params.id);
    if (!Number.isFinite(vendorId)) {
      return res.status(400).json({ message: "Invalid vendor ID" });
    }

    const foodCourt = getAdminFoodCourt(req);
    const vendors = getVendors(foodCourt);
    const index = vendors.findIndex((v) => Number(v.vendorId) === vendorId);
    if (index === -1) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const removedVendor = vendors[index];
    const shopIdValue = Number(removedVendor.shopId);

    const archivePayload = {
      archiveId: `vendor-${removedVendor.vendorId}-${Date.now()}`,
      vendorId: removedVendor.vendorId,
      shopId: removedVendor.shopId,
      username: removedVendor.username,
      email: removedVendor.email || null,
      shopName: removedVendor.shopName || null,
      passwordHash: removedVendor.passwordHash,
      deletedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      foodCourt,
      data: {
        vendorRecord: removedVendor,
        menuSnapshot: getMenu(foodCourt),
        combos: getCombos(foodCourt),
        offers: getOffers(foodCourt),
        procurementTemplates: listTemplates(removedVendor.vendorId),
        procurementOrders: listOrders(removedVendor.vendorId),
        procurementTasks: listProcurementTasks(removedVendor.vendorId),
        grievances: getVendorGrievances(),
        orders: getOrders(foodCourt),
        headcount: getVendorHeadcountEntries(removedVendor.vendorId),
      },
    };

    appendVendorArchive(archivePayload);

    vendors.splice(index, 1);
    saveVendors(vendors, foodCourt);

    const rawMenu = getMenu(foodCourt);
    const purgeShopFromMenu = (data) => {
      if (Array.isArray(data)) {
        return data.filter((shop) => Number(shop?.shopId) !== Number(removedVendor.shopId));
      }
      if (data && typeof data === "object") {
        const next = { ...data };
        if (Array.isArray(next.shops)) {
          next.shops = next.shops.filter((shop) => Number(shop?.shopId) !== Number(removedVendor.shopId));
        }
        return next;
      }
      return data;
    };

    const updatedMenu = purgeShopFromMenu(rawMenu);
    if (updatedMenu !== rawMenu) {
      saveMenu(updatedMenu, foodCourt);
    }

    const filterByShop = (collection) => collection.filter((entry) => Number(entry.shopId) !== shopIdValue);

    const combos = getCombos(foodCourt);
    const nextCombos = filterByShop(combos);
    if (nextCombos.length !== combos.length) {
      saveCombos(nextCombos, foodCourt);
    }

    const offers = getOffers(foodCourt);
    const nextOffers = filterByShop(offers);
    if (nextOffers.length !== offers.length) {
      saveOffers(nextOffers, foodCourt);
    }

    try {
      removeTemplatesForVendor(removedVendor.vendorId);
    } catch (error) {
      console.warn("Failed to clean procurement templates for vendor", removedVendor.vendorId, error);
    }

    try {
      removeOrdersForVendor(removedVendor.vendorId);
    } catch (error) {
      console.warn("Failed to clean procurement orders for vendor", removedVendor.vendorId, error);
    }

    try {
      removeTasksForVendor(removedVendor.vendorId);
    } catch (error) {
      console.warn("Failed to clean procurement tasks for vendor", removedVendor.vendorId, error);
    }

    const grievances = getVendorGrievances();
    const nextGrievances = grievances.filter((g) => Number(g.vendorId) !== Number(removedVendor.vendorId));
    if (nextGrievances.length !== grievances.length) {
      saveVendorGrievances(nextGrievances);
    }

    const historicalOrders = getOrders(foodCourt);
    const ordersAfterPurge = historicalOrders.filter((order) => Number(order.shopId) !== shopIdValue);
    if (ordersAfterPurge.length !== historicalOrders.length) {
      saveOrders(ordersAfterPurge, foodCourt);
    }

    try {
      removeVendorHeadcount(removedVendor.vendorId);
    } catch (error) {
      console.warn("Failed to remove headcount history for vendor", removedVendor.vendorId, error);
    }

    try {
      analyticsIngestor?.deleteShopHistory?.(shopIdValue);
    } catch (error) {
      console.warn("Failed to purge realtime analytics history", error);
    }

    try {
      analyticsQueryService?.deleteVendorSnapshots?.(shopIdValue);
    } catch (error) {
      console.warn("Failed to purge analytics snapshots", error);
    }

    invalidateVendorDirectoryCache(foodCourt);

    res.json({ status: "success", message: "Vendor removed", vendorId, archiveId: archivePayload.archiveId });
  } catch (error) {
    console.error("Error deleting vendor", error);
    res.status(500).json({ message: "Error deleting vendor" });
  }
});

app.get("/admin/vendor-archives", authenticateAdmin, (req, res) => {
  try {
    const now = Date.now();
    const foodCourt = getAdminFoodCourt(req);
    const archives = listVendorArchives()
      .filter((entry) => new Date(entry.expiresAt).getTime() > now)
      .filter((entry) => {
        if (!entry || !entry.foodCourt) {
          return foodCourt === FC_DEFAULT;
        }
        return entry.foodCourt === foodCourt;
      });
    res.json({ status: "ok", archives });
  } catch (error) {
    console.error("Error listing vendor archives", error);
    res.status(500).json({ message: "Failed to load vendor archives" });
  }
});

app.post("/admin/vendor-archives/:archiveId/restore", authenticateAdmin, async (req, res) => {
  try {
    const { archiveId } = req.params;
    const archive = listVendorArchives().find((entry) => entry.archiveId === archiveId);
    if (!archive) {
      return res.status(404).json({ message: "Archive not found" });
    }

    const expiresAt = new Date(archive.expiresAt).getTime();
    if (Date.now() > expiresAt) {
      removeArchiveById(archiveId);
      return res.status(410).json({ message: "Archive expired" });
    }

    const foodCourt = getAdminFoodCourt(req);
    const vendors = getVendors(foodCourt);
    if (vendors.some((vendor) => Number(vendor.vendorId) === Number(archive.vendorId))) {
      return res.status(409).json({ message: "Vendor already exists" });
    }

    const archiveFoodCourt = archive.foodCourt || FC_DEFAULT;
    if (archiveFoodCourt !== foodCourt) {
      return res.status(409).json({
        message: `Archive belongs to ${archiveFoodCourt.toUpperCase()}. Switch to that food court to restore.`,
      });
    }

    vendors.push({
      vendorId: archive.vendorId,
      shopId: archive.shopId,
      username: archive.username,
      passwordHash: archive.passwordHash,
      email: archive.email || undefined,
      shopName: archive.shopName || undefined,
    });
    saveVendors(vendors, foodCourt);

    const menu = archive.data.menuSnapshot;
    if (menu) {
      saveMenu(menu, foodCourt);
    }

    const combos = archive.data.combos || [];
    saveCombos(combos, foodCourt);

    const offers = archive.data.offers || [];
    saveOffers(offers, foodCourt);

    const procurementTemplates = archive.data.procurementTemplates || [];
    procurementTemplates.forEach((tpl) => saveTemplate(tpl));

    const procurementOrders = archive.data.procurementOrders || [];
    procurementOrders.forEach((order) => saveOrder(order));

    const procurementTasks = archive.data.procurementTasks || [];
    addTasksForVendor(procurementTasks);

    const grievances = archive.data.grievances || [];
    if (Array.isArray(grievances)) {
      const existingGrievances = getVendorGrievances();
      const merged = [...existingGrievances.filter((g) => Number(g.vendorId) !== Number(archive.vendorId)), ...grievances];
      saveVendorGrievances(merged);
    }

    const orders = archive.data.orders || [];
    if (Array.isArray(orders)) {
      saveOrders(orders, foodCourt);
    }

    const headcountRecord = archive.data.headcountRecord || null;
    if (headcountRecord) {
      restoreVendorRecord(headcountRecord);
    } else if (Array.isArray(archive.data.headcount) && archive.data.headcount.length) {
      restoreVendorRecord({ vendorId: archive.vendorId, shopId: archive.shopId, entries: archive.data.headcount });
    }

    try {
      analyticsIngestor?.restoreShopHistory?.(archive.shopId, archive.data.analyticsSnapshot || null);
    } catch (error) {
      console.warn("Failed to restore realtime analytics history", error);
    }

    try {
      analyticsQueryService?.restoreVendorSnapshots?.(archive.shopId, archive.data.analyticsSnapshot || null);
    } catch (error) {
      console.warn("Failed to restore analytics snapshots", error);
    }

    removeArchiveById(archiveId);

    invalidateVendorDirectoryCache(foodCourt);

    res.json({ status: "success", message: "Vendor restored", vendorId: archive.vendorId });
  } catch (error) {
    console.error("Error restoring vendor", error);
    res.status(500).json({ message: "Error restoring vendor" });
  }
});

app.get("/analytics/status", authenticateVendor, requirePermission("analytics:read"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const health = metricsRegistry.getHealthSummary();
  const accuracy = getLatestAccuracyForVendor(req.vendor.vendorId);
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "analytics.status.read",
    metadata: { accuracyCount: accuracy.length },
  });
  res.json({
    generatedAt: new Date().toISOString(),
    health,
    forecastAccuracy: accuracy,
  });
}));

// File paths
const FC_DEFAULT = "fc-1";
const FC_SECONDARY = "fc-2";
const FOOD_COURTS = [FC_DEFAULT, FC_SECONDARY];

const menuFile = __dirname + "/data/menu.json";
const ordersFile = __dirname + "/data/orders.json";
const vendorsFile = __dirname + "/data/vendors.json";
const billingCounterFile = __dirname + "/data/billing_counter.json";
const favoritesFile = __dirname + "/data/favorites.json";
const ratingsFile = __dirname + "/data/ratings.json";
const grievancesFile = __dirname + "/data/grievances.json";
const vendorGrievancesFile = __dirname + "/data/vendor_grievances.json";
const employeeConcernsFile = __dirname + "/data/employee_concerns.json";
const sosStateFile = __dirname + "/data/sos_state.json";
const employeesFile = __dirname + "/data/employees.json";
const combosFile = __dirname + "/data/combos.json";
const offersFile = __dirname + "/data/offers.json";
const sectionWindowsFile = __dirname + "/data/section_windows.json";
const itemInterestFile = path.join(__dirname, 'data', 'item_interest.json');
const vendorInterestThresholdsFile = path.join(__dirname, 'data', 'vendor_interest_thresholds.json');
const bulkOrdersFile = path.join(__dirname, 'data', 'bulk_orders.json');

const resolveCourtFile = (baseFile, foodCourt) => {
  const targetCourt = FOOD_COURTS.includes(String(foodCourt)) ? String(foodCourt) : FC_DEFAULT;
  if (targetCourt === FC_DEFAULT) return baseFile;
  const parsed = path.parse(baseFile);
  return path.join(parsed.dir, `${parsed.name}_${targetCourt}${parsed.ext}`);
};

const readJsonFrom = (filePath, fallback) => {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
};

const writeJsonTo = (filePath, payload) => {
  const data = payload == null ? null : payload;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

function ensureCourtDataFiles() {
  const bases = [menuFile, ordersFile, vendorsFile, combosFile, offersFile, favoritesFile, itemInterestFile];
  for (const base of bases) {
    const secondaryPath = resolveCourtFile(base, FC_SECONDARY);
    if (!fs.existsSync(secondaryPath)) {
      try {
        const primaryContent = fs.readFileSync(base, "utf8");
        fs.writeFileSync(secondaryPath, primaryContent);
      } catch (error) {
        const defaultContent = Array.isArray(readJsonFrom(base, [])) ? [] : {};
        fs.writeFileSync(secondaryPath, JSON.stringify(defaultContent, null, 2));
      }
    }
  }
}

const DEFAULT_INTEREST_THRESHOLD = 15;
const INTEREST_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_INTEREST_RECORDS = 5000;

const getVendorThresholdValue = (vendorId, thresholdsMap, { foodCourt } = {}) => {
  if (!vendorId) return DEFAULT_INTEREST_THRESHOLD;
  const lookup = thresholdsMap && typeof thresholdsMap === "object" ? thresholdsMap : {};
  const vendorKey = String(vendorId);
  const direct = lookup[vendorKey];
  if (Number.isFinite(direct)) return direct;

  if (foodCourt && lookup[foodCourt] && typeof lookup[foodCourt] === "object") {
    const courtValue = lookup[foodCourt][vendorKey];
    if (Number.isFinite(courtValue)) return courtValue;
  }

  return DEFAULT_INTEREST_THRESHOLD;
};

const getVendorFoodCourt = (req) => {
  const candidate = req?.vendor?.foodCourt;
  return FOOD_COURTS.includes(String(candidate)) ? String(candidate) : FC_DEFAULT;
};

const getAdminFoodCourt = (req) => {
  const candidate = req?.query?.foodCourt || req?.body?.foodCourt || req?.params?.foodCourt;
  return FOOD_COURTS.includes(String(candidate)) ? String(candidate) : FC_DEFAULT;
};

const loadVendorMenu = (req) => getMenu(getVendorFoodCourt(req));
const loadVendorOrders = (req) => getOrders(getVendorFoodCourt(req));
const saveVendorOrders = (req, orders) => saveOrders(orders, getVendorFoodCourt(req));
const loadVendorCombos = (req) => getCombos(getVendorFoodCourt(req));
const saveVendorCombos = (req, combos) => saveCombos(combos, getVendorFoodCourt(req));
const loadVendorOffers = (req) => getOffers(getVendorFoodCourt(req));
const saveVendorOffers = (req, offers) => saveOffers(offers, getVendorFoodCourt(req));

const getUserFoodCourt = (req) => {
  const candidate = req?.query?.foodCourt || req?.body?.foodCourt || req?.headers?.["x-food-court"] || req?.params?.foodCourt;
  return FOOD_COURTS.includes(String(candidate)) ? String(candidate) : FC_DEFAULT;
};

const loadUserMenu = (req) => getMenu(getUserFoodCourt(req));
const loadUserCombos = (req) => getCombos(getUserFoodCourt(req));
const loadUserOffers = (req) => getOffers(getUserFoodCourt(req));
const loadUserOrders = (req) => getOrders(getUserFoodCourt(req));
const saveUserOrders = (req, orders) => saveOrders(orders, getUserFoodCourt(req));

ensureCourtDataFiles();

// Simple admin credentials (can be overridden via env)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "infybhojans";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "infybhojans";

// Helper functions (defined after paths)
const getEmployees = () => {
  try {
    const list = JSON.parse(fs.readFileSync(employeesFile, "utf8"));
    let changed = false;
    if (Array.isArray(list)) {
      for (const emp of list) {
        if (typeof emp.walletBalance !== 'number' || Number.isNaN(emp.walletBalance)) {
          emp.walletBalance = 0;
          changed = true;
        }
        if (!Array.isArray(emp.walletTransactions)) {
          emp.walletTransactions = [];
          changed = true;
        }
        if (ensureEmployeeRoleFields(emp)) {
          changed = true;
        }
      }
      if (changed) {
        saveEmployees(list);
      }
    }
    return list;
  } catch {
    return [];
  }
};

const saveEmployees = (list) => {
  fs.writeFileSync(employeesFile, JSON.stringify(list, null, 2));
};

const formatCurrency = (amount) => Math.round(Number(amount || 0) * 100) / 100;

const MIN_WALLET_TOPUP = 100;
const MAX_WALLET_TOPUP = 5000;

const ensureWalletFields = (employee) => {
  if (!employee) return false;
  let changed = false;
  if (typeof employee.walletBalance !== 'number' || Number.isNaN(employee.walletBalance)) {
    employee.walletBalance = 0;
    changed = true;
  }
  if (!Array.isArray(employee.walletTransactions)) {
    employee.walletTransactions = [];
    changed = true;
  }
  return changed;
};

const appendWalletTransaction = (employee, tx = {}) => {
  ensureWalletFields(employee);
  const transaction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...tx,
  };
  transaction.amount = formatCurrency(transaction.amount || 0);
  if (!transaction.status) transaction.status = 'success';
  employee.walletTransactions.unshift(transaction);
  if (employee.walletTransactions.length > 1000) {
    employee.walletTransactions.length = 1000;
  }
  return transaction;
};

const recordWalletTransaction = (employees, employee, tx = {}) => {
  const entry = appendWalletTransaction(employee, tx);
  saveEmployees(employees);
  return entry;
};

const validatePin = (pin) => /^\d{4}$/.test(String(pin || ''));

const DEFAULT_EMPLOYEE_ROLE_LABEL = 'Employee';
const DEFAULT_EMPLOYEE_ROLE_SLUG = 'employee';
const BULK_ORDER_ROLE_SLUGS = new Set([
  'hr',
  'human-resources',
  'people-ops',
  'people-operations',
  'onboarding',
  'onboarding-team',
  'event',
  'events',
  'event-team',
  'event-coordinator',
  'client-meeting',
  'client-meetings',
  'client-success',
  'vendor-relations',
]);

const slugifyRoleLabel = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return DEFAULT_EMPLOYEE_ROLE_SLUG;
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || DEFAULT_EMPLOYEE_ROLE_SLUG;
};

const normalizeEmployeeRoleInput = (value) => {
  const label = String(value || '').trim();
  if (!label) {
    return { label: DEFAULT_EMPLOYEE_ROLE_LABEL, slug: DEFAULT_EMPLOYEE_ROLE_SLUG };
  }
  const safeLabel = label.slice(0, 80);
  return { label: safeLabel, slug: slugifyRoleLabel(safeLabel) };
};

const normalizeDepartmentInput = (value) => {
  const label = String(value || '').trim();
  if (!label) return '';
  return label.slice(0, 80);
};

const buildEmployeeRoleSnapshot = (employee) => {
  if (!employee) {
    return normalizeEmployeeRoleInput(null);
  }
  const base = normalizeEmployeeRoleInput(employee.role || employee.roleLabel);
  let label = base.label;
  let slug = base.slug;
  if (employee.role && !employee.role.trim()) {
    label = DEFAULT_EMPLOYEE_ROLE_LABEL;
  } else if (employee.role) {
    label = String(employee.role).trim().slice(0, 80);
  }
  if (employee.roleSlug) {
    const candidate = slugifyRoleLabel(employee.roleSlug);
    if (candidate) slug = candidate;
  }
  if (!label) label = DEFAULT_EMPLOYEE_ROLE_LABEL;
  if (!slug) slug = DEFAULT_EMPLOYEE_ROLE_SLUG;
  return { label, slug };
};

const hasBulkOrderPrivileges = (roleSlug) => BULK_ORDER_ROLE_SLUGS.has(roleSlug);

const ensureEmployeeRoleFields = (employee) => {
  if (!employee) return false;
  let changed = false;
  const snapshot = buildEmployeeRoleSnapshot(employee);
  const department = normalizeDepartmentInput(employee.department);
  if (employee.role !== snapshot.label) {
    employee.role = snapshot.label;
    changed = true;
  }
  if (employee.roleSlug !== snapshot.slug) {
    employee.roleSlug = snapshot.slug;
    changed = true;
  }
  if (employee.department !== department) {
    employee.department = department;
    changed = true;
  }
  const bulkEligible = hasBulkOrderPrivileges(snapshot.slug);
  if (employee.bulkOrderEligible !== bulkEligible) {
    employee.bulkOrderEligible = bulkEligible;
    changed = true;
  }
  return changed;
};
const validatePassword = (pwd) => {
  const s = String(pwd || '');
  if (s.length < 8 || s.length > 20) return false;
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  const hasDigit = /\d/.test(s);
  const hasSymbol = /[\.,&%#@!]/.test(s);
  return hasLower && hasUpper && hasDigit && hasSymbol;
};

// In-memory stores (no database)
const employeeOtps = new Map(); // mobile -> { otp, expiresAt }
const employeeSessions = new Map(); // token -> { mobile, createdAt, employeeId?, contact? }
const employeeProfileOtps = new Map(); // key `${action}:${employeeId}` -> { otp, expiresAt }

// Startup: hash any pinPlain, and set initial pins for demo users 1 and 2 if missing
const ensureEmployeePins = async () => {
  try {
    const list = getEmployees();
    let changed = false;
    for (const e of list) {
      if (e.pinPlain && validatePin(e.pinPlain)) {
        e.pinHash = await bcrypt.hash(String(e.pinPlain), 10);
        delete e.pinPlain;
        changed = true;
      }
    }
    const u1 = list.find(x => Number(x.id) === 1);
    const u2 = list.find(x => Number(x.id) === 2);
    if (u1) { u1.pinHash = await bcrypt.hash('1234', 10); changed = true; }
    if (u2) { u2.pinHash = await bcrypt.hash('4321', 10); changed = true; }
    if (changed) saveEmployees(list);
  } catch {}
};

const validateEmailAddress = (email) => {
const str = String(email || '').trim();
if (!str) return false;
return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str);
};

const normalizeMobileInput = (value) => {
if (value == null) return null;
const digits = String(value).replace(/[^0-9]/g, '');
if (!digits) return '';
if (digits.length !== 10) return null;
return `+91${digits}`;
};

const sanitizeEmployeeProfile = (employee, options = {}) => {
  const { pointsSummary } = options;
  const profile = {
    id: employee.id,
    username: employee.username || "",
    email: employee.email || "",
    mobile: employee.mobile || "",
    name: employee.name || "",
    avatar: employee.avatar || "",
    birthday: employee.birthday || "",
    department: employee.department || "",
    designation: employee.designation || "",
    employeeId: employee.employeeId || "",
    location: employee.location || "",
    favoriteVendors: Array.isArray(employee.favoriteVendors) ? employee.favoriteVendors : [],
    favorites: Array.isArray(employee.favorites) ? employee.favorites : [],
    preferences: employee.preferences || {},
    walletBalance: Number(employee.walletBalance || 0),
    walletTransactions: Array.isArray(employee.walletTransactions)
      ? employee.walletTransactions.slice(0, 10)
      : [],
    friends: Array.isArray(employee.friends) ? employee.friends : [],
    hasPassword: Boolean(employee.passwordHash),
    hasPin: Boolean(employee.pinHash),
    role: employee.role || DEFAULT_EMPLOYEE_ROLE_LABEL,
    roleSlug: employee.roleSlug || DEFAULT_EMPLOYEE_ROLE_SLUG,
    bulkOrderEligible: Boolean(employee.bulkOrderEligible),
  };

  if (pointsSummary !== undefined) {
    profile.points = pointsSummary;
  }

  return profile;
};

const resolveEmployeeFromToken = (token) => {
  if (!token) return null;
  const tokenStr = String(token).trim();
  if (!tokenStr) return null;

  let decoded;
  try {
    decoded = jwt.verify(tokenStr, JWT_SECRET);
  } catch {
    return null;
  }

  if (!decoded || decoded.role !== "employee") return null;

  const identifiers = new Set();
  const pushIdent = (val) => {
    if (val === undefined || val === null) return;
    const str = String(val).trim();
    if (!str) return;
    identifiers.add(str.toLowerCase());
  };

  pushIdent(decoded.employeeId);
  pushIdent(decoded.mobile);
  pushIdent(decoded.contact);
  pushIdent(decoded.username);
  pushIdent(decoded.email);

  const sessionInfo = employeeSessions.get(tokenStr);
  if (sessionInfo) {
    pushIdent(sessionInfo.employeeId);
    pushIdent(sessionInfo.mobile);
    pushIdent(sessionInfo.contact);
  }

  const employees = getEmployees();
  let index = -1;
  for (const ident of identifiers) {
    index = employees.findIndex((emp) => {
      const username = String(emp.username || "").toLowerCase();
      const email = String(emp.email || "").toLowerCase();
      const mobile = String(emp.mobile || "").toLowerCase();
      const idStr = String(emp.id || "").toLowerCase();
      return (
        username === ident ||
        email === ident ||
        mobile === ident ||
        idStr === ident
      );
    });
    if (index >= 0) break;
  }

  if (index === -1) return null;

  const employee = employees[index];
  if (ensureEmployeeRoleFields(employee)) {
    saveEmployees(employees);
  }

  return { employee, index, employees, token: tokenStr };
};

const resolveEmployeeFromRequest = (req) => {
  const token = req?.body?.token || req?.query?.token || req?.headers?.['x-employee-token'] || req?.headers?.['authorization'];
  return resolveEmployeeFromToken(token);
};

const authenticateEmployee = (req, res, next) => {
  const resolved = resolveEmployeeFromRequest(req);
  if (!resolved) {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }
  req.employeeSession = resolved;
  req.employee = resolved.employee;
  next();
};

const resolveVendorFromRequest = (req) => {
  const tokenCandidates = [
    req?.headers?.authorization,
    req?.headers?.['x-vendor-token'],
    req?.body?.vendorToken,
    req?.body?.token,
    req?.query?.vendorToken,
    req?.query?.token,
  ];
  const token = tokenCandidates.find((value) => typeof value === "string" && value.trim().length > 0);
  if (!token) return null;
  const decoded = decodeVendorToken(token.trim());
  if (!decoded) return null;
  const vendor = enrichVendorContext(decoded);
  return { vendor };
};

const ensureHotRecFlags = () => {
  try {
    const raw = getMenu();
    if (!raw || !Array.isArray(raw.shops)) return; // only handle new shape
    let changed = false;
    for (const shop of raw.shops) {
      const categories = Array.isArray(shop.categories) ? shop.categories : [];
      for (const cat of categories) {
        const items = Array.isArray(cat.items) ? cat.items : [];
        if (items.length === 0) continue;
        let anyHot = items.some(it => it.isHotSeller === true);
        let anyRec = items.some(it => it.isRecommended === true);
        // Ensure flags exist
        for (const it of items) {
          if (it.isHotSeller == null) { it.isHotSeller = false; changed = true; }
          if (it.isRecommended == null) { it.isRecommended = false; changed = true; }
        }
        // If none set yet, pick 5 random for each
        const pickRandom = (n) => {
          const idxs = items.map((_, i) => i);
          for (let i = idxs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
          }
          return idxs.slice(0, Math.min(n, idxs.length));
        };
        if (!anyHot) {
          pickRandom(5).forEach(i => { if (!items[i].isHotSeller) { items[i].isHotSeller = true; changed = true; } });
        }
        if (!anyRec) {
          pickRandom(5).forEach(i => { if (!items[i].isRecommended) { items[i].isRecommended = true; changed = true; } });
        }
      }
    }
    if (changed) {
      fs.writeFileSync(menuFile, JSON.stringify(raw, null, 2));
    }
  } catch {}
};

// Run migrations at startup (after modules and paths are defined)
ensureHotRecFlags();
ensureEmployeePins();

// Routes

// Request OTP for employee login (registered users only)
app.post("/employee/request-otp", (req, res) => {
  try {
    const { mobile } = req.body || {};
    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ message: "Mobile must be 10 digits" });
    }
    const fullMobile = `+91${mobile}`;
    const employees = getEmployees();
    const user = employees.find(e => String(e.mobile || '').toLowerCase() === fullMobile.toLowerCase());
    if (!user) return res.status(404).json({ message: 'Mobile not registered' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    employeeOtps.set(fullMobile, { otp, expiresAt: Date.now() + 2 * 60 * 1000 });
    console.log(`[OTP] Mobile: ${fullMobile} -> ${otp}`);
    res.json({ status: 'ok' });
  } catch {
    res.status(500).json({ message: 'Error requesting OTP' });
  }
});

// Employee profile fetch
app.post('/employee/profile', (req, res) => {
  try {
    const { token } = req.body || {};
    const resolved = resolveEmployeeFromToken(token);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    const employee = resolved.employee;
    ensureWalletFields(employee);
    let roleChanged = false;
    if (ensureEmployeeRoleFields(employee)) {
      roleChanged = true;
    }
    if (roleChanged) {
      saveEmployees(resolved.employees || getEmployees());
    }
    const points = getEmployeePointsSummary(employee.id);
    const profile = sanitizeEmployeeProfile(employee, { pointsSummary: points.summary });
    const wallet = {
      balance: Number(employee.walletBalance || 0),
      transactions: Array.isArray(employee.walletTransactions) ? employee.walletTransactions.slice(0, 20) : []
    };
    return res.json({
      status: 'ok',
      profile,
      wallet,
      points,
    });
  } catch (error) {
    console.error('Failed to load profile', error);
    res.status(500).json({ message: 'Failed to load profile' });
  }
});

app.post('/employee/points/summary', (req, res) => {
  try {
    const { token } = req.body || {};
    const resolved = resolveEmployeeFromToken(token);
    if (!resolved?.employee) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }
    const points = getEmployeePointsSummary(resolved.employee.id);
    return res.json({ status: 'ok', points });
  } catch (error) {
    console.error('Failed to load employee points summary', error);
    res.status(500).json({ message: 'Failed to load points summary' });
  }
});

app.get('/vendor/points/summary', authenticateVendor, requirePermission('analytics:read'), (req, res) => {
  try {
    const report = getPointsAdminReport({ date: req.query?.date });
    res.json({ status: 'ok', report });
  } catch (error) {
    console.error('Failed to load vendor points summary', error);
    res.status(500).json({ message: 'Failed to load vendor points summary' });
  }
});

// Employee profile OTP request
app.post('/employee/profile/request-otp', (req, res) => {
  try {
    const { token, action } = req.body || {};
    const resolved = resolveEmployeeFromToken(token);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    const validActions = new Set(['verify-email', 'verify-mobile', 'change-password', 'change-pin']);
    if (!validActions.has(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const key = `${action}:${resolved.employee.id}`;
    employeeProfileOtps.set(key, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
    console.log(`[Profile OTP] employee ${resolved.employee.id} action ${action} -> ${otp}`);
    return res.json({ status: 'ok' });
  } catch {
    res.status(500).json({ message: 'Failed to request OTP' });
  }
});

// Employee profile update
app.post('/employee/profile/update', async (req, res) => {
  try {
    const { token, updates, otp, action } = req.body || {};
    if (!token || !updates || typeof updates !== 'object') {
      return res.status(400).json({ message: 'Token and updates are required' });
    }
    const resolved = resolveEmployeeFromToken(token);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    const { employee, index, employees, token: tokenStr } = resolved;
    const updated = { ...employee };
    let changed = false;

    const sensitiveChanges = [];

    if (Object.prototype.hasOwnProperty.call(updates, 'username')) {
      const candidate = String(updates.username || '').trim();
      if (!candidate) return res.status(400).json({ message: 'Username is required' });
      const currentUsername = String(employee.username || '').trim();
      if (currentUsername) {
        if (candidate.toLowerCase() !== currentUsername.toLowerCase()) {
          return res.status(403).json({ message: 'Username cannot be changed after registration' });
        }
      } else if (candidate.toLowerCase() !== currentUsername.toLowerCase()) {
        const exists = employees.some((e, idx) => idx !== index && String(e.username || '').toLowerCase() === candidate.toLowerCase());
        if (exists) return res.status(409).json({ message: 'Username not available' });
        updated.username = candidate;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
      const candidate = String(updates.email || '').trim();
      if (!validateEmailAddress(candidate)) {
        return res.status(400).json({ message: 'Invalid email' });
      }
      if (candidate.toLowerCase() !== String(employee.email || '').toLowerCase()) {
        const exists = employees.some((e, idx) => idx !== index && String(e.email || '').toLowerCase() === candidate.toLowerCase());
        if (exists) return res.status(409).json({ message: 'Email already registered' });
        updated.email = candidate;
        changed = true;
        sensitiveChanges.push('email');
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'mobile')) {
      const normalized = normalizeMobileInput(updates.mobile);
      if (!normalized) return res.status(400).json({ message: 'Mobile must be 10 digits (India)' });
      if (normalized !== String(employee.mobile || '')) {
        const exists = employees.some((e, idx) => idx !== index && String(e.mobile || '').toLowerCase() === normalized.toLowerCase());
        if (exists) return res.status(409).json({ message: 'Mobile already registered' });
        updated.mobile = normalized;
        changed = true;
        sensitiveChanges.push('mobile');
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'password')) {
      const pwd = String(updates.password || '');
      if (!validatePassword(pwd)) {
        return res.status(400).json({ message: 'Password must be 8-20 chars with lower, upper, number, and one of .,&%#@!' });
      }
      updated.passwordHash = await bcrypt.hash(pwd, 10);
      changed = true;
      sensitiveChanges.push('password');
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'pin')) {
      const pinStr = String(updates.pin || '');
      if (!validatePin(pinStr)) {
        return res.status(400).json({ message: 'PIN must be 4 digits' });
      }
      updated.pinHash = await bcrypt.hash(pinStr, 10);
      changed = true;
      sensitiveChanges.push('pin');
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'birthday')) {
      const bday = String(updates.birthday || '').trim();
      if (bday !== String(employee.birthday || '')) {
        updated.birthday = bday;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'friends')) {
      let friendsList = updates.friends;
      if (typeof friendsList === 'string') {
        friendsList = friendsList
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean);
      }
      if (Array.isArray(friendsList)) {
        const existing = Array.isArray(employee.friends) ? employee.friends : [];
        const changedFriends = friendsList.length !== existing.length || friendsList.some((f, idx) => existing[idx] !== f);
        if (changedFriends) {
          updated.friends = friendsList;
          changed = true;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'department')) {
      const department = normalizeDepartmentInput(updates.department);
      if (department !== String(employee.department || '')) {
        updated.department = department;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'role')) {
      const { label, slug } = normalizeEmployeeRoleInput(updates.role);
      if (label && slug) {
        if (label !== String(employee.role || '') || slug !== String(employee.roleSlug || '')) {
          updated.role = label;
          updated.roleSlug = slug;
          updated.bulkOrderEligible = hasBulkOrderPrivileges(slug);
          changed = true;
        }
      }
    }

    if (sensitiveChanges.length > 1) {
      return res.status(400).json({ message: 'Update one sensitive field at a time (email, mobile, password, or pin)' });
    }

    if (sensitiveChanges.length === 1) {
      const requiredActionMap = {
        email: 'verify-email',
        mobile: 'verify-mobile',
        password: 'change-password',
        pin: 'change-pin',
      };
      const field = sensitiveChanges[0];
      const expectedAction = requiredActionMap[field];
      if (!otp || !action || action !== expectedAction) {
        return res.status(400).json({ message: 'Valid OTP is required for this change' });
      }
      const key = `${action}:${employee.id}`;
      const stored = employeeProfileOtps.get(key);
      if (!stored || stored.otp !== String(otp) || Date.now() > stored.expiresAt) {
        return res.status(401).json({ message: 'Invalid or expired OTP' });
      }
      employeeProfileOtps.delete(key);
    }

    if (!changed) {
      return res.json({ status: 'ok', profile: sanitizeEmployeeProfile(employee) });
    }

    employees[index] = updated;
    if (ensureEmployeeRoleFields(updated)) {
      employees[index] = updated;
    }
    saveEmployees(employees);

    const sessionInfo = employeeSessions.get(tokenStr);
    if (sessionInfo) {
      employeeSessions.set(tokenStr, {
        ...sessionInfo,
        employeeId: updated.id,
        mobile: updated.mobile || sessionInfo.mobile,
        contact: updated.mobile || sessionInfo.contact,
      });
    }

    return res.json({ status: 'ok', profile: sanitizeEmployeeProfile(updated) });
  } catch (error) {
    console.error('Error updating employee profile', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Verify OTP and issue session
app.post("/employee/verify-otp", (req, res) => {
  try {
    const { mobile, otp } = req.body || {};
    if (!mobile || !otp) return res.status(400).json({ message: 'Mobile and OTP required' });
    if (!/^\d{10}$/.test(String(mobile))) return res.status(400).json({ message: 'Invalid mobile' });
    const fullMobile = `+91${mobile}`;
    const record = employeeOtps.get(fullMobile);
    if (!record || record.otp !== String(otp) || Date.now() > record.expiresAt) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }
    employeeOtps.delete(fullMobile);
    const employees = getEmployees();
    const user = employees.find(e => String(e.mobile || '').toLowerCase() === fullMobile.toLowerCase());
    if (!user) return res.status(404).json({ message: 'User not found' });
    ensureEmployeeRoleFields(user);
    saveEmployees(employees);
    const payload = {
      role: 'employee',
      mobile: fullMobile,
      employeeId: user.id,
      username: user.username,
      email: user.email,
      roleLabel: user.role,
      roleSlug: user.roleSlug,
      department: user.department,
      bulkOrderEligible: Boolean(user.bulkOrderEligible)
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, {
      mobile: fullMobile,
      contact: fullMobile,
      createdAt: Date.now(),
      employeeId: user.id,
      roleLabel: user.role,
      roleSlug: user.roleSlug,
      department: user.department,
      bulkOrderEligible: Boolean(user.bulkOrderEligible)
    });
    res.json({
      status: 'ok',
      token,
      mobile: fullMobile,
      username: user.username,
      email: user.email,
      role: user.role,
      roleSlug: user.roleSlug,
      department: user.department,
      bulkOrderEligible: Boolean(user.bulkOrderEligible)
    });
  } catch {
    res.status(500).json({ message: 'Error verifying OTP' });
  }
});

// Bulk Orders APIs

app.get('/bulk-orders', (req, res) => {
  try {
    const employeeResolved = resolveEmployeeFromRequest(req);
    const vendorResolved = employeeResolved ? null : resolveVendorFromRequest(req);
    if (!employeeResolved && !vendorResolved) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    let foodCourt = getUserFoodCourt(req);
    if (vendorResolved?.vendor?.foodCourt) {
      foodCourt = vendorResolved.vendor.foodCourt;
    }
    const allOrders = getBulkOrders(foodCourt);
    const statusFilter = req.query.status ? String(req.query.status).toLowerCase() : null;
    const vendorFilterParam = req.query.vendorShopId ? String(req.query.vendorShopId) : null;

    let visible = [];

    if (employeeResolved) {
      const { employee } = employeeResolved;
      const canViewAll = hasBulkOrderPrivileges(employee.roleSlug);

      visible = allOrders.filter((order) => {
        if (!order) return false;
        const isOrganizer = order.organizer && Number(order.organizer.employeeId) === Number(employee.id);
        const isAssignedVendor = Array.isArray(order.assignedVendors) && order.assignedVendors.includes(String(employee.vendorShopId || employee.shopId || ''));
        if (!canViewAll && !isOrganizer && !isAssignedVendor) {
          return false;
        }
        if (statusFilter && normalizeBulkStatus(order.status) !== normalizeBulkStatus(statusFilter)) {
          return false;
        }
        if (vendorFilterParam && String(order.vendorShopId || '') !== vendorFilterParam) {
          return false;
        }
        return true;
      });
    } else if (vendorResolved) {
      const { vendor } = vendorResolved;
      const vendorShopId = vendor.shopId != null ? String(vendor.shopId) : '';
      visible = allOrders.filter((order) => {
        if (!order) return false;
        if (!vendorCanAccessBulkOrder(vendor, order)) {
          return false;
        }
        if (vendorFilterParam && vendorFilterParam !== vendorShopId) {
          return false;
        }
        if (statusFilter && normalizeBulkStatus(order.status) !== normalizeBulkStatus(statusFilter)) {
          return false;
        }
        return true;
      });
    }

    const response = visible.map((order) => sanitizeBulkOrder(order, foodCourt));
    res.json({ status: 'ok', orders: response });
  } catch (error) {
    console.error('Error listing bulk orders', error);
    res.status(500).json({ message: 'Failed to fetch bulk orders' });
  }
});

app.post('/bulk-orders', (req, res) => {
  try {
    const resolved = resolveEmployeeFromRequest(req);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    const { employee } = resolved;

    const payload = req.body || {};
    const foodCourt = getUserFoodCourt(req);
    const orders = getBulkOrders(foodCourt);
    const record = normalizeBulkOrderForCreate(payload, employee, orders, foodCourt);
    ensureBulkOrderReviewFields(record);
    orders.push(record);
    saveBulkOrders(orders, foodCourt);

    res.status(201).json({ status: 'ok', order: sanitizeBulkOrder(record, foodCourt) });
  } catch (error) {
    console.error('Error creating bulk order', error);
    res.status(400).json({ message: error?.message || 'Failed to create bulk order' });
  }
});

app.put('/bulk-orders/:id', (req, res) => {
  try {
    const resolved = resolveEmployeeFromRequest(req);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    const { employee, employees } = resolved;
    const foodCourt = getUserFoodCourt(req);
    const orders = getBulkOrders(foodCourt);
    const id = Number(req.params.id);
    const index = orders.findIndex((order) => Number(order.id) === id);
    if (index === -1) return res.status(404).json({ message: 'Bulk order not found' });

    const currentOrder = orders[index];
    if (!employeeCanManageBulkOrder(employee, currentOrder)) {
      return res.status(403).json({ message: 'You do not have permission to modify this bulk order' });
    }

    const updates = req.body?.updates || req.body;
    const snapshotSource = {
      eventName: currentOrder.eventName,
      eventType: currentOrder.eventType,
      eventTheme: currentOrder.eventTheme,
      eventDate: currentOrder.eventDate,
      eventStartTime: currentOrder.eventStartTime,
      eventEndTime: currentOrder.eventEndTime,
      location: currentOrder.location,
      building: currentOrder.building,
      floor: currentOrder.floor,
      campus: currentOrder.campus,
      notes: currentOrder.notes,
      specialInstructions: currentOrder.specialInstructions,
      expectedHeadcount: currentOrder.expectedHeadcount,
      organizerName: currentOrder.organizerName,
      organizerEmail: currentOrder.organizerEmail,
      organizerMobile: currentOrder.organizerMobile,
      organizerContact: currentOrder.organizerContact,
      organizer: currentOrder.organizer,
      requestedVendors: currentOrder.requestedVendors,
      pricing: currentOrder.pricing,
      deliverySlots: currentOrder.deliverySlots,
      itemGroups: currentOrder.itemGroups,
      attendeeGroups: currentOrder.attendeeGroups,
      metadata: currentOrder.metadata,
      attachments: currentOrder.attachments,
    };
    const previousSnapshot = JSON.parse(JSON.stringify(snapshotSource));

    const updated = applyBulkOrderUpdates(currentOrder, updates, employee);
    ensureBulkOrderReviewFields(updated);

    if (String(currentOrder.status) === 'needs_revision') {
      updated.adminReview = updated.adminReview || {};
      updated.adminReview.previousState = previousSnapshot;
      updated.adminReview.previousUpdatedAt = currentOrder.updatedAt || currentOrder.lastStatusChangeAt || currentOrder.createdAt;
    }

    updated.foodCourt = foodCourt;
    orders[index] = updated;
    saveBulkOrders(orders, foodCourt);

    // Keep resolve cache up to date if organizer fields changed
    if (employees) {
      saveEmployees(employees);
    }

    res.json({ status: 'ok', order: sanitizeBulkOrder(updated, foodCourt) });
  } catch (error) {
    console.error('Error updating bulk order', error);
    res.status(400).json({ message: error?.message || 'Failed to update bulk order' });
  }
});

app.post('/bulk-orders/:id/vendor-message', (req, res) => {
  try {
    const employeeResolved = resolveEmployeeFromRequest(req);
    const vendorResolved = employeeResolved ? null : resolveVendorFromRequest(req);
    if (!employeeResolved && !vendorResolved) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    let foodCourt = getUserFoodCourt(req);
    if (vendorResolved?.vendor?.foodCourt) {
      foodCourt = vendorResolved.vendor.foodCourt;
    }
    const orders = getBulkOrders(foodCourt);
    const id = Number(req.params.id);
    const index = orders.findIndex((order) => Number(order.id) === id);
    if (index === -1) return res.status(404).json({ message: 'Bulk order not found' });

    const currentOrder = orders[index];
    let actor = null;
    if (employeeResolved) {
      const { employee } = employeeResolved;
      if (!employeeCanManageBulkOrder(employee, currentOrder)) {
        return res.status(403).json({ message: 'You do not have permission to post messages on this bulk order' });
      }
      actor = buildBulkActorFromEmployee(employee);
    } else if (vendorResolved) {
      const { vendor } = vendorResolved;
      if (!vendorCanAccessBulkOrder(vendor, currentOrder)) {
        return res.status(403).json({ message: 'You do not have permission to post messages on this bulk order' });
      }
      actor = buildBulkActorFromVendor(vendor);
    }

    const messageText = clampString(req.body?.message || '', 500);
    if (!messageText) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const now = new Date().toISOString();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: now,
      actor,
      message: messageText,
    };

    const next = { ...currentOrder };
    next.vendorMessages = Array.isArray(next.vendorMessages) ? [entry, ...next.vendorMessages].slice(0, 200) : [entry];
    next.history = Array.isArray(next.history) ? [buildBulkHistoryEntry('vendor_message', actor, { message: messageText }), ...next.history] : [buildBulkHistoryEntry('vendor_message', actor, { message: messageText })];
    next.updatedAt = now;
    next.foodCourt = foodCourt;
    orders[index] = sanitizeBulkOrder(next, foodCourt);
    saveBulkOrders(orders, foodCourt);

    res.json({ status: 'ok', order: sanitizeBulkOrder(orders[index], foodCourt) });
  } catch (error) {
    console.error('Error posting bulk order message', error);
    res.status(400).json({ message: error?.message || 'Failed to post message' });
  }
});

app.post('/bulk-orders/:id/vendor-confirm', (req, res) => {
  try {
    const employeeResolved = resolveEmployeeFromRequest(req);
    const vendorResolved = employeeResolved ? null : resolveVendorFromRequest(req);
    if (!employeeResolved && !vendorResolved) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    let foodCourt = getUserFoodCourt(req);
    if (vendorResolved?.vendor?.foodCourt) {
      foodCourt = vendorResolved.vendor.foodCourt;
    }
    const orders = getBulkOrders(foodCourt);
    const id = Number(req.params.id);
    const index = orders.findIndex((order) => Number(order.id) === id);
    if (index === -1) return res.status(404).json({ message: 'Bulk order not found' });

    const order = orders[index];
    let actor = null;
    if (employeeResolved) {
      const { employee } = employeeResolved;
      if (!employeeCanManageBulkOrder(employee, order)) {
        return res.status(403).json({ message: 'You do not have permission to confirm this bulk order' });
      }
      actor = buildBulkActorFromEmployee(employee);
    } else if (vendorResolved) {
      const { vendor } = vendorResolved;
      if (!vendorCanAccessBulkOrder(vendor, order)) {
        return res.status(403).json({ message: 'You do not have permission to confirm this bulk order' });
      }
      actor = buildBulkActorFromVendor(vendor);
    }

    const slotId = req.body?.slotId || null;
    const capacity = req.body?.capacity != null ? Number(req.body.capacity) : null;
    const messageText = clampString(req.body?.message || '', 500);
    const agree = req.body?.status ? String(req.body.status).toLowerCase() : null;
    const status = agree === 'confirmed' || agree === 'accept' ? 'confirmed'
      : agree === 'rejected' || agree === 'decline' ? 'rejected'
      : 'pending';

    const now = new Date().toISOString();
    const confirmation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      actor,
      slotId,
      status,
      capacity: capacity != null && Number.isFinite(capacity) ? capacity : null,
      message: messageText,
      timestamp: now,
    };

    const updated = { ...order };
    const slots = Array.isArray(updated.deliverySlots) ? updated.deliverySlots.map((slot) => ({ ...slot })) : [];
    if (slotId) {
      const slotIndex = slots.findIndex((slot) => String(slot.id) === String(slotId));
      if (slotIndex >= 0) {
        slots[slotIndex].vendorConfirmation = status;
      }
    }
    updated.deliverySlots = slots;
    updated.vendorResponses = Array.isArray(updated.vendorResponses) ? [confirmation, ...updated.vendorResponses].slice(0, 200) : [confirmation];
    const vendorHistoryEntry = buildBulkHistoryEntry('vendor_confirmation', actor, { slotId, status, capacity, message: messageText });
    const existingHistory = Array.isArray(updated.history) ? updated.history : [];
    updated.history = [vendorHistoryEntry, ...existingHistory];

    if (status === 'confirmed') {
      const currentStatus = normalizeBulkStatus(updated.status, updated.status);
      if (currentStatus === 'pending_vendor') {
        setBulkOrderStatus(updated, 'confirmed', actor, { slotId });
      }
    }

    updated.updatedAt = now;

    updated.foodCourt = foodCourt;
    orders[index] = sanitizeBulkOrder(updated, foodCourt);
    saveBulkOrders(orders, foodCourt);

    res.json({ status: 'ok', order: orders[index] });
  } catch (error) {
    console.error('Error updating bulk order confirmation', error);
    res.status(400).json({ message: error?.message || 'Failed to update confirmation' });
  }
});

app.get('/admin/bulk-orders', authenticateAdmin, (req, res) => {
  try {
    const statusFilter = req.query.status ? String(req.query.status).toLowerCase() : null;
    const foodCourt = getAdminFoodCourt(req);
    const orders = getBulkOrders(foodCourt);
    const filtered = orders.filter((order) => {
      if (!statusFilter) return true;
      return normalizeBulkStatus(order.status) === normalizeBulkStatus(statusFilter);
    }).map((order) => sanitizeBulkOrder(ensureBulkOrderReviewFields(order), foodCourt));
    res.json({ status: 'ok', orders: filtered });
  } catch (error) {
    console.error('Error listing admin bulk orders', error);
    res.status(500).json({ message: 'Failed to fetch bulk orders' });
  }
});

app.get('/admin/vendors', authenticateAdmin, (req, res) => {
  try {
    const foodCourt = getAdminFoodCourt(req);
    const vendors = buildVendorDirectory(foodCourt);
    res.json({ status: 'ok', vendors });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load vendors' });
  }
});

app.post('/admin/vendor', authenticateAdmin, async (req, res) => {
  try {
    const { shopName, username, password, email, shopId } = req.body || {};
    const trimmedShopName = String(shopName || '').trim();
    const trimmedUsername = String(username || '').trim();
    const passwordStr = String(password || '');
    const trimmedEmail = email != null ? String(email).trim() : '';

    if (!trimmedShopName || !trimmedUsername || !passwordStr) {
      return res.status(400).json({ message: 'shopName, username, and password are required' });
    }

    const foodCourt = getAdminFoodCourt(req);
    const vendors = getVendors(foodCourt);
    const usernameTaken = vendors.some((v) => String(v.username || '').toLowerCase() === trimmedUsername.toLowerCase());
    if (usernameTaken) {
      return res.status(409).json({ message: 'Username already exists' });
    }

    const vendorId = vendors.reduce((max, vendor) => Math.max(max, Number(vendor.vendorId) || 0), 0) + 1;

    const rawMenu = getMenu(foodCourt);
    const collectShopIds = (menuData) => {
      const ids = new Set();
      if (Array.isArray(menuData)) {
        menuData.forEach((shop) => {
          if (shop && shop.shopId != null) ids.add(Number(shop.shopId));
        });
      } else if (menuData && Array.isArray(menuData.shops)) {
        menuData.shops.forEach((shop) => {
          if (shop && shop.shopId != null) ids.add(Number(shop.shopId));
        });
      }
      return ids;
    };

    const existingShopIds = collectShopIds(rawMenu);
    let resolvedShopId;
    if (shopId != null && shopId !== '') {
      resolvedShopId = Number(shopId);
      if (!Number.isFinite(resolvedShopId) || resolvedShopId <= 0) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      if (existingShopIds.has(resolvedShopId)) {
        return res.status(409).json({ message: 'Shop ID already exists' });
      }
    } else {
      let candidate = existingShopIds.size ? Math.max(...existingShopIds) + 1 : 1;
      while (existingShopIds.has(candidate)) {
        candidate += 1;
      }
      resolvedShopId = candidate;
    }

    const passwordHash = await bcrypt.hash(passwordStr, 10);
    const newVendor = {
      vendorId,
      shopId: resolvedShopId,
      username: trimmedUsername,
      passwordHash,
    };
    if (trimmedEmail) newVendor.email = trimmedEmail;
    newVendor.shopName = trimmedShopName;

    vendors.push(newVendor);
    saveVendors(vendors, foodCourt);

    const newShopEntry = {
      shopId: resolvedShopId,
      shopName: trimmedShopName,
      categories: [],
    };
    if (trimmedEmail) newShopEntry.contactEmail = trimmedEmail;

    let updatedMenu = rawMenu;
    if (Array.isArray(updatedMenu)) {
      updatedMenu = [...updatedMenu, newShopEntry];
      saveMenu(updatedMenu, foodCourt);
    } else {
      const menuObj = updatedMenu && typeof updatedMenu === 'object' ? { ...updatedMenu } : { shops: [] };
      menuObj.shops = Array.isArray(menuObj.shops) ? [...menuObj.shops, newShopEntry] : [newShopEntry];
      saveMenu(menuObj, foodCourt);
    }

    invalidateVendorDirectoryCache(foodCourt);

    res.json({
      status: 'success',
      vendor: {
        vendorId,
        id: vendorId,
        shopId: resolvedShopId,
        username: trimmedUsername,
        email: trimmedEmail || null,
        shopName: trimmedShopName,
      },
    });
  } catch (error) {
    console.error('Error creating vendor', error);
    res.status(500).json({ message: 'Error creating vendor' });
  }
});

app.post('/admin/bulk-orders/:id/decision', authenticateAdmin, (req, res) => {
  try {
    const foodCourt = getAdminFoodCourt(req);
    const orders = getBulkOrders(foodCourt);
    const id = Number(req.params.id);
    const index = orders.findIndex((order) => Number(order.id) === id);
    if (index === -1) return res.status(404).json({ message: 'Bulk order not found' });

    const order = ensureBulkOrderReviewFields(orders[index]);
    const action = String(req.body?.action || '').toLowerCase();
    const comment = clampString(req.body?.comment || '', 600);
    const adminActor = buildBulkActorFromAdmin(req.admin);

    let statusTarget = null;
    let notificationSubject = '';
    let notificationBody = comment;

    switch (action) {
      case 'approve':
      case 'approved':
        statusTarget = 'approved_admin';
        notificationSubject = `Bulk order #${order.id} approved`;
        if (!notificationBody) {
          notificationBody = 'Your bulk order has been approved by admin.';
        }
        break;
      case 'request_changes':
      case 'needs_revision':
        statusTarget = 'needs_revision';
        notificationSubject = `Updates requested for bulk order #${order.id}`;
        if (!notificationBody) {
          notificationBody = 'Admin requested changes to your bulk order request.';
        }
        break;
      case 'reject':
      case 'rejected':
        statusTarget = 'admin_rejected';
        notificationSubject = `Bulk order #${order.id} rejected`;
        if (!notificationBody) {
          notificationBody = 'Your bulk order request was rejected by admin.';
        }
        break;
      default:
        return res.status(400).json({ message: 'Unknown admin action' });
    }

    setBulkOrderStatus(order, statusTarget, adminActor, { comment });
    appendAdminDecision(order, { action, comment, actor: adminActor });
    order.updatedAt = new Date().toISOString();
    orders[index] = order;
    saveBulkOrders(orders, foodCourt);

    notifyBulkOrderOrganizer(order, notificationSubject, notificationBody);

    res.json({ status: 'ok', order: sanitizeBulkOrder(order, foodCourt) });
  } catch (error) {
    console.error('Error recording admin decision', error);
    res.status(400).json({ message: error?.message || 'Failed to record admin decision' });
  }
});

app.post('/admin/bulk-orders/:id/send-to-vendor', authenticateAdmin, (req, res) => {
  try {
    const foodCourt = getAdminFoodCourt(req);
    const orders = getBulkOrders(foodCourt);
    const id = Number(req.params.id);
    const index = orders.findIndex((order) => Number(order.id) === id);
    if (index === -1) return res.status(404).json({ message: 'Bulk order not found' });

    const order = ensureBulkOrderReviewFields(orders[index]);
    if (!['approved_admin', 'sent_to_vendor', 'pending_vendor'].includes(normalizeBulkStatus(order.status))) {
      return res.status(400).json({ message: 'Bulk order must be approved before sending to vendor' });
    }

    const adminActor = buildBulkActorFromAdmin(req.admin);
    const vendorShopId = req.body?.vendorShopId != null ? String(req.body.vendorShopId) : order.vendorShopId;
    if (vendorShopId) {
      order.vendorShopId = vendorShopId;
    }

    setBulkOrderStatus(order, 'pending_vendor', adminActor, { vendorShopId });
    order.history = Array.isArray(order.history)
      ? [buildBulkHistoryEntry('admin_sent_to_vendor', adminActor, { vendorShopId }), ...order.history]
      : [buildBulkHistoryEntry('admin_sent_to_vendor', adminActor, { vendorShopId })];
    order.updatedAt = new Date().toISOString();
    orders[index] = order;
    saveBulkOrders(orders, foodCourt);

    notifyBulkOrderOrganizer(order, `Bulk order #${order.id} sent to vendors`, 'Your request has been shared with the vendor for confirmation.');

    res.json({ status: 'ok', order: sanitizeBulkOrder(order, foodCourt) });
  } catch (error) {
    console.error('Error sending bulk order to vendor', error);
    res.status(400).json({ message: error?.message || 'Failed to send to vendor' });
  }
});

// Username availability
app.get('/employee/check-username', (req, res) => {
  try {
    const { username } = req.query || {};
    if (!username) return res.status(400).json({ available: false, message: 'username required' });
    const employees = getEmployees();
    const exists = employees.some(e => String(e.username).toLowerCase() === String(username).toLowerCase());
    res.json({ available: !exists });
  } catch {
    res.status(500).json({ available: false });
  }
});

// Registration
app.post('/employee/register', async (req, res) => {
  try {
    let { username, password, pin, mobile, email } = req.body || {};
    username = String(username || '').trim();
    if (!username) return res.status(400).json({ message: 'Username is required' });
    if (!validatePin(pin)) return res.status(400).json({ message: 'PIN must be 4 digits' });
    if (!validatePassword(password)) return res.status(400).json({ message: 'Password must be 8-20 chars with lower, upper, number, and one of .,&%#@!' });
    // Normalize mobile to +91XXXXXXXXXX
    const digits = String(mobile || '').replace(/[^0-9]/g,'');
    if (digits.length !== 10) return res.status(400).json({ message: 'Mobile must be 10 digits (India)' });
    const mobileNorm = `+91${digits}`;
    const emailStr = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailStr)) return res.status(400).json({ message: 'Invalid email' });
    const employees = getEmployees();
    const exists = employees.some(e => String(e.username).toLowerCase() === username.toLowerCase());
    if (exists) return res.status(409).json({ message: 'Username not available' });
    const mobileExists = employees.some(e => String(e.mobile || '').toLowerCase() === mobileNorm.toLowerCase());
    if (mobileExists) return res.status(409).json({ message: 'Mobile already registered' });
    const emailExists = employees.some(e => String(e.email || '').toLowerCase() === emailStr.toLowerCase());
    if (emailExists) return res.status(409).json({ message: 'Email already registered' });
    const id = (employees.reduce((m, e) => Math.max(m, Number(e.id)||0), 0) + 1) || 1;
    const passwordHash = await bcrypt.hash(String(password), 10);
    const pinHash = await bcrypt.hash(String(pin), 10);
    const roleLabel = DEFAULT_EMPLOYEE_ROLE_LABEL;
    const roleSlug = DEFAULT_EMPLOYEE_ROLE_SLUG;
    const departmentLabel = '';
    const newEmp = {
      id,
      username,
      email: emailStr,
      mobile: mobileNorm,
      passwordHash,
      pinHash,
      role: roleLabel,
      roleSlug,
      department: departmentLabel,
      bulkOrderEligible: false
    };
    employees.push(newEmp);
    saveEmployees(employees);
    res.json({ status: 'ok', id, username });
  } catch (e) {
    res.status(500).json({ message: 'Error registering user' });
  }
});

// Employee username/password login
app.post('/employee/login-password', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Username and password are required' });
    const identifier = String(username).trim();
    const identifierLower = identifier.toLowerCase();
    const candidateMobile = normalizeMobileInput(identifier);
    const employees = getEmployees();
    const u = employees.find((e) => {
      const usernameLower = String(e.username || '').toLowerCase();
      const emailLower = String(e.email || '').toLowerCase();
      const mobileLower = String(e.mobile || '').toLowerCase();
      if (usernameLower === identifierLower) return true;
      if (emailLower === identifierLower) return true;
      if (candidateMobile && mobileLower === candidateMobile.toLowerCase()) return true;
      return false;
    });
    if (!u || !u.passwordHash) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(String(password), String(u.passwordHash));
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    ensureWalletFields(u);
    const contact = u.mobile || u.email || u.username || String(u.id);
    ensureEmployeeRoleFields(u);
    saveEmployees(employees);
    const payload = {
      role: 'employee',
      mobile: u.mobile || contact,
      employeeId: u.id,
      username: u.username,
      email: u.email,
      contact,
      roleLabel: u.role,
      roleSlug: u.roleSlug,
      department: u.department,
      bulkOrderEligible: Boolean(u.bulkOrderEligible)
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, {
      mobile: u.mobile || contact,
      contact,
      createdAt: Date.now(),
      employeeId: u.id,
      roleLabel: u.role,
      roleSlug: u.roleSlug,
      department: u.department,
      bulkOrderEligible: Boolean(u.bulkOrderEligible)
    });
    res.json({
      status: 'ok',
      token,
      mobile: u.mobile || contact,
      username: u.username,
      email: u.email,
      role: u.role,
      roleSlug: u.roleSlug,
      department: u.department,
      bulkOrderEligible: Boolean(u.bulkOrderEligible)
    });
  } catch (e) {
    res.status(500).json({ message: 'Error during password login' });
  }
});

// Employee 4-digit PIN login
app.post('/employee/login-pin', async (req, res) => {
  try {
    const { username, pin, mobileOrEmail } = req.body || {};
    if (!username || !pin) return res.status(400).json({ message: 'Username and PIN are required' });
    const identifier = String(username).trim();
    const identifierLower = identifier.toLowerCase();
    const candidateMobile = normalizeMobileInput(identifier);
    if (!validatePin(pin)) return res.status(400).json({ message: 'PIN must be 4 digits' });
    const employees = getEmployees();
    const u = employees.find((e) => {
      const usernameLower = String(e.username || '').toLowerCase();
      const emailLower = String(e.email || '').toLowerCase();
      const mobileLower = String(e.mobile || '').toLowerCase();
      if (usernameLower === identifierLower) return true;
      if (emailLower === identifierLower) return true;
      if (candidateMobile && mobileLower === candidateMobile.toLowerCase()) return true;
      return false;
    });
    if (!u) return res.status(401).json({ message: 'Invalid credentials' });
    if (!u.pinHash) return res.status(403).json({ message: 'PIN not configured. Contact administrator.' });
    const ok = await bcrypt.compare(String(pin), String(u.pinHash));
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    ensureWalletFields(u);
    const contact = u.mobile || u.email || u.username || String(u.id);
    ensureEmployeeRoleFields(u);
    saveEmployees(employees);
    const payload = {
      role: 'employee',
      mobile: u.mobile || contact,
      employeeId: u.id,
      username: u.username,
      email: u.email || null,
      contact,
      roleLabel: u.role,
      roleSlug: u.roleSlug,
      department: u.department,
      bulkOrderEligible: Boolean(u.bulkOrderEligible)
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, {
      mobile: u.mobile || contact,
      contact,
      createdAt: Date.now(),
      employeeId: u.id,
      roleLabel: u.role,
      roleSlug: u.roleSlug,
      department: u.department,
      bulkOrderEligible: Boolean(u.bulkOrderEligible)
    });
    res.json({
      status: 'ok',
      token,
      mobile: u.mobile || contact,
      username: u.username,
      email: u.email || null,
      role: u.role,
      roleSlug: u.roleSlug,
      department: u.department,
      bulkOrderEligible: Boolean(u.bulkOrderEligible)
    });
  } catch (e) {
    res.status(500).json({ message: 'Error during PIN login' });
  }
});

// Reset PIN (requires username, contact verification, and new 4-digit PIN)
app.post('/employee/reset-pin', async (req, res) => {
  try {
    const { username, mobileOrEmail, newPin } = req.body || {};
    if (!username || !mobileOrEmail || !newPin) return res.status(400).json({ message: 'Username, contact, and new PIN are required' });
    if (!validatePin(newPin)) return res.status(400).json({ message: 'PIN must be 4 digits' });
    const employees = getEmployees();
    const u = employees.find(e => String(e.username).toLowerCase() === String(username).toLowerCase() || String(e.email || '').toLowerCase() === String(username).toLowerCase());
    if (!u) return res.status(404).json({ message: 'User not found' });
    const contact = String(mobileOrEmail || '').toLowerCase();
    const okContact = contact && (String(u.email || '').toLowerCase() === contact || String(u.mobile || '').toLowerCase() === contact);
    if (!okContact) return res.status(401).json({ message: 'Contact does not match' });
    u.pinHash = await bcrypt.hash(String(newPin), 10);
    saveEmployees(employees);
    res.json({ status: 'ok', message: 'PIN updated' });
  } catch (e) {
    res.status(500).json({ message: 'Error resetting PIN' });
  }
});

// Reset password (requires username, contact verification, and strong password)
app.post('/employee/reset-password', async (req, res) => {
  try {
    const { username, mobileOrEmail, newPassword } = req.body || {};
    if (!username || !mobileOrEmail || !newPassword) return res.status(400).json({ message: 'Username, contact, and new password are required' });
    if (!validatePassword(newPassword)) return res.status(400).json({ message: 'Password must be 8-20 chars with lower, upper, number, and one of .,&%#@!' });
    const employees = getEmployees();
    const u = employees.find(e => String(e.username).toLowerCase() === String(username).toLowerCase() || String(e.email || '').toLowerCase() === String(username).toLowerCase());
    if (!u) return res.status(404).json({ message: 'User not found' });
    const contact = String(mobileOrEmail || '').toLowerCase();
    const okContact = contact && (String(u.email || '').toLowerCase() === contact || String(u.mobile || '').toLowerCase() === contact);
    if (!okContact) return res.status(401).json({ message: 'Contact does not match' });
    u.passwordHash = await bcrypt.hash(String(newPassword), 10);
    saveEmployees(employees);
    res.json({ status: 'ok', message: 'Password updated' });
  } catch (e) {
    res.status(500).json({ message: 'Error resetting password' });
  }
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

    const emailFromToken = payload.email || payload.sub;
    const mobile = emailFromToken; // reusing email/sub as identifier
    const token = jwt.sign({ role: 'employee', mobile }, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, { mobile, createdAt: Date.now() });
    res.json({ status: 'ok', token, mobile });
  } catch (e) {
    res.status(500).json({ message: 'Error during Apple login' });
  }
});

// Get menu
/**
 * Read menu JSON from disk for a specific food court.
 * @param {string=} foodCourt
 * @returns {Array|Object}
 */
const getMenu = (foodCourt = FC_DEFAULT) => readJsonFrom(resolveCourtFile(menuFile, foodCourt), []);

/**
 * Normalize menu shops to ensure consistent structure.
 * @param {any} raw
 * @returns {Array}
 */
const normalizeMenuShops = (raw) => {
  if (!raw || !Array.isArray(raw.shops)) return [];
  return raw.shops.map((shop) => {
    const items = Array.isArray(shop.categories)
      ? shop.categories.flatMap((cat) => Array.isArray(cat.items) ? cat.items.map((it) => normalizeItem({ ...it, section: cat.categoryName || 'All Items' })) : [])
      : Array.isArray(shop.items) ? shop.items.map(normalizeItem) : [];
    return { ...shop, items };
  });
};

/**
 * Normalize a single item: map hasOptions (array) -> options, ensure flags and defaults.
 * @param {any} it
 * @returns {any}
 */
const normalizeCaloriesValue = (value) => {
  if (value == null) return null;
  const str = String(value).trim();
  return str ? str : null;
};

const normalizeItem = (it) => {
  const options = Array.isArray(it.hasOptions) ? it.hasOptions : (Array.isArray(it.options) ? it.options : []);
  const hasOptionsFlag = Array.isArray(options) && options.length > 0;
  return {
    ...it,
    options,
    hasOptions: hasOptionsFlag,
    inventory: (it.inventory == null || isNaN(Number(it.inventory))) ? 100 : Number(it.inventory),
    calories: normalizeCaloriesValue(it?.calories)
  };
};

/**
 * Persist menu to disk.
 * @param {any} menu - Full menu array
 * @returns {void}
 */
const saveMenu = (menu, foodCourt = FC_DEFAULT) => writeJsonTo(resolveCourtFile(menuFile, foodCourt), menu);

/**
 * Read orders JSON from disk.
 * @returns {Array}
 */
const getOrders = (foodCourt = FC_DEFAULT) => readJsonFrom(resolveCourtFile(ordersFile, foodCourt), []);

/**
 * Persist orders to disk.
 * @param {Array} orders
 * @returns {void}
 */
const saveOrders = (orders, foodCourt = FC_DEFAULT) => writeJsonTo(resolveCourtFile(ordersFile, foodCourt), Array.isArray(orders) ? orders : []);

/**
 * Read vendor credentials/data.
 * @returns {Array}
 */
const getVendors = (foodCourt = FC_DEFAULT) => {
  const list = readJsonFrom(resolveCourtFile(vendorsFile, foodCourt), []);
  if (!Array.isArray(list)) return [];
  return list.map((vendor) => {
    if (!vendor || typeof vendor !== "object") return vendor;
    return vendor.foodCourt && vendor.foodCourt !== foodCourt ? vendor : { ...vendor, foodCourt };
  });
};

const saveVendors = (vendors, foodCourt = FC_DEFAULT) => {
  const payload = Array.isArray(vendors) ? vendors.map((vendor) => {
    if (!vendor || typeof vendor !== "object") return vendor;
    const { foodCourt: _ignoredFoodCourt, ...rest } = vendor;
    return rest;
  }) : [];
  writeJsonTo(resolveCourtFile(vendorsFile, foodCourt), payload);
};

const getItemInterestRecords = (foodCourt = FC_DEFAULT) => {
  try {
    const raw = fs.readFileSync(resolveCourtFile(itemInterestFile, foodCourt), 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveItemInterestRecords = (records, foodCourt = FC_DEFAULT) => {
  const payload = Array.isArray(records) ? records : [];
  fs.writeFileSync(resolveCourtFile(itemInterestFile, foodCourt), JSON.stringify(payload, null, 2));
};

const getVendorInterestThresholds = () => {
  try {
    const raw = fs.readFileSync(vendorInterestThresholdsFile, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
};

const saveVendorInterestThresholds = (map) => {
  const payload = (map && typeof map === 'object') ? map : {};
  fs.writeFileSync(vendorInterestThresholdsFile, JSON.stringify(payload, null, 2));
};

const getVendorIdForShop = (shopId, foodCourt = FC_DEFAULT) => {
  if (shopId == null) return null;
  try {
    const directory = getVendorDirectoryMap(foodCourt);
    const entry = directory.get(String(shopId));
    return entry?.vendorId != null ? String(entry.vendorId) : null;
  } catch (error) {
    console.warn('Failed to resolve vendorId for shop', shopId, error);
    return null;
  }
};

const buildInterestKey = ({ shopId, itemId }) => `${shopId || 'unknown'}:${itemId || 'unknown'}`;

const aggregateInterest = (records) => {
  const byItem = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.itemId == null || record.shopId == null) continue;
    const key = buildInterestKey(record);
    if (!byItem.has(key)) {
      byItem.set(key, {
        shopId: String(record.shopId),
        itemId: String(record.itemId),
        uniqueEmployees: new Set(),
        totalClicks: 0,
        history: [],
        vendorId: record.vendorId != null ? String(record.vendorId) : null,
      });
    }
    const entry = byItem.get(key);
    if (record.vendorId != null && !entry.vendorId) {
      entry.vendorId = String(record.vendorId);
    }
    entry.totalClicks += 1;
    if (record.employeeId != null) {
      entry.uniqueEmployees.add(String(record.employeeId));
    } else if (record.employeeMobile) {
      entry.uniqueEmployees.add(String(record.employeeMobile));
    }
    entry.history.push({
      employeeId: record.employeeId ?? null,
      employeeMobile: record.employeeMobile ?? null,
      timestamp: record.timestamp,
    });
  }

  return Array.from(byItem.values()).map((entry) => {
    const sortedHistory = entry.history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const firstExpressedAt = sortedHistory.length ? sortedHistory[0].timestamp : null;
    const lastExpressedAt = sortedHistory.length ? sortedHistory[sortedHistory.length - 1].timestamp : null;
    return {
      shopId: entry.shopId,
      itemId: entry.itemId,
      vendorId: entry.vendorId,
      uniqueEmployees: entry.uniqueEmployees.size,
      totalClicks: entry.totalClicks,
      history: sortedHistory,
      firstExpressedAt,
      lastExpressedAt,
    };
  });
};

const findMenuItemMetadata = (shopId, itemId, foodCourt = FC_DEFAULT) => {
  if (shopId == null || itemId == null) return null;
  const rawMenu = getMenu(foodCourt);
  const normalized = normalizeMenuShops(rawMenu);
  const shop = normalized.find((s) => String(s.shopId) === String(shopId));
  if (!shop) return null;
  const item = Array.isArray(shop.items) ? shop.items.find((it) => String(it.id) === String(itemId)) : null;
  if (!item) return null;
  const inventory = Number(item.inventory ?? 0);
  const lowStockThreshold = item.lowStockThreshold ?? item.lowStockLimit ?? item.lowStock ?? null;
  return {
    shopId: shop.shopId,
    shopName: shop.shopName || shop.name || null,
    itemId: item.id,
    itemName: item.name || null,
    inventory: Number.isFinite(inventory) ? inventory : 0,
    section: item.section || null,
    image: item.image || null,
    price: item.price ?? null,
    lowStockThreshold: Number.isFinite(Number(lowStockThreshold)) ? Number(lowStockThreshold) : null,
  };
};

const getInterestEntry = (aggregated, shopId, itemId) => {
  if (!Array.isArray(aggregated)) return null;
  return aggregated.find((entry) => String(entry.shopId) === String(shopId) && String(entry.itemId) === String(itemId)) || null;
};

const isSoldOut = (metadata) => {
  if (!metadata) return false;
  const inventory = Number(metadata.inventory ?? 0);
  return Number.isFinite(inventory) ? inventory <= 0 : false;
};

const isLowStock = (metadata) => {
  if (!metadata) return false;
  const inventory = Number(metadata.inventory ?? 0);
  if (!Number.isFinite(inventory)) return false;
  const threshold = Number(metadata.lowStockThreshold ?? 5);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return inventory > 0 && inventory <= 5;
  }
  return inventory > 0 && inventory <= threshold;
};

const normalizeIdentityValue = (value) => {
  if (value == null) return null;
  const str = String(value).trim().toLowerCase();
  return str || null;
};

const buildIdentitySetFromValues = (values = []) => {
  const set = new Set();
  for (const value of values) {
    const normalized = normalizeIdentityValue(value);
    if (normalized) {
      set.add(normalized);
    }
  }
  return set;
};

const getEmployeeIdentitySet = (employee = {}, session = null) => {
  const values = [
    employee.id,
    employee.employeeId,
    employee.mobile,
    employee.contact,
    employee.email,
    employee.username,
    session?.mobile,
    session?.contact,
    session?.employeeId,
  ];
  return buildIdentitySetFromValues(values);
};

const getRecordIdentitySet = (record = {}) => {
  const values = [
    record.employeeId,
    record.employeeMobile,
    record.employeeContact,
    record.employeeEmail,
    record.employeeUsername,
  ];
  return buildIdentitySetFromValues(values);
};

const hasIdentityOverlap = (record, identitySet) => {
  if (!(identitySet instanceof Set) || identitySet.size === 0) return false;
  const recordSet = getRecordIdentitySet(record);
  if (recordSet.size === 0) return false;
  for (const value of identitySet.values()) {
    if (recordSet.has(value)) {
      return true;
    }
  }
  return false;
};

const ensureInterestCapacity = (records) => {
  if (!Array.isArray(records)) return;
  if (records.length <= MAX_INTEREST_RECORDS) return;
  const excess = records.length - MAX_INTEREST_RECORDS;
  records.splice(0, excess);
};

const resolveVendorContactForOrder = (order, foodCourt = FC_DEFAULT) => {
  if (!order) return order?.vendorContact || null;
  const existing = order.vendorContact && typeof order.vendorContact === 'object'
    ? { ...order.vendorContact }
    : null;
  const vendorShopId = order.vendorShopId != null ? String(order.vendorShopId) : null;
  if (!vendorShopId) return existing;

  try {
    const directoryMap = getVendorDirectoryMap(foodCourt);
    const entry = directoryMap.get(vendorShopId);
    if (!entry) return existing;

    return {
      vendorId: entry.vendorId ?? existing?.vendorId ?? null,
      shopId: entry.shopId,
      shopName: entry.shopName || existing?.shopName || null,
      email: entry.contactEmail || existing?.email || existing?.contactEmail || null,
      contactEmail: entry.contactEmail || existing?.contactEmail || null,
      phone: entry.contactPhone || existing?.phone || existing?.contactPhone || null,
      contactPhone: entry.contactPhone || existing?.contactPhone || null,
    };
  } catch (error) {
    console.error('Error resolving vendor contact for bulk order', error);
    return existing;
  }
};

const buildInterestSummary = ({ entry, metadata, threshold, foodCourt }) => {
  const shopId = String(entry?.shopId ?? metadata?.shopId ?? '');
  const itemId = String(entry?.itemId ?? metadata?.itemId ?? '');
  const vendorId = entry?.vendorId ?? getVendorIdForShop(shopId, foodCourt) ?? null;
  const uniqueEmployees = Number(entry?.uniqueEmployees || 0);
  const totalClicks = Number(entry?.totalClicks || 0);
  const history = Array.isArray(entry?.history) ? entry.history.slice(-50) : [];
  const soldOut = isSoldOut(metadata);
  const lowStock = isLowStock(metadata);
  const restockSuggested = Boolean(
    Number.isFinite(threshold) && threshold > 0 && uniqueEmployees >= threshold && (soldOut || lowStock)
  );

  return {
    shopId,
    itemId,
    vendorId,
    threshold,
    uniqueEmployees,
    totalClicks,
    firstExpressedAt: entry?.firstExpressedAt || null,
    lastExpressedAt: entry?.lastExpressedAt || null,
    soldOut,
    lowStock,
    restockSuggested,
    metadata: metadata
      ? {
          shopName: metadata.shopName || null,
          itemName: metadata.itemName || null,
          inventory: Number.isFinite(metadata.inventory) ? metadata.inventory : null,
          section: metadata.section || null,
          lowStockThreshold: metadata.lowStockThreshold ?? null,
          image: metadata.image || null,
          price: metadata.price ?? null,
        }
      : null,
    history,
  };
};

/**
 * Read favorites from disk.
 * @returns {Array<{userId:string,itemId:number}>}
 */
const getFavorites = (foodCourt = FC_DEFAULT) => {
  try {
    return JSON.parse(fs.readFileSync(resolveCourtFile(favoritesFile, foodCourt), "utf8"));
  } catch {
    return [];
  }
};

/**
 * Persist favorites to disk.
 * @param {Array} favorites
 */
const saveFavorites = (favorites, foodCourt = FC_DEFAULT) =>
  fs.writeFileSync(resolveCourtFile(favoritesFile, foodCourt), JSON.stringify(favorites, null, 2));

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
 * Persist section windows to disk.
 * @param {Array} data
 */
const saveSectionWindows = (data) => fs.writeFileSync(sectionWindowsFile, JSON.stringify(data, null, 2));

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

/**
 * Read vendor grievances from disk.
 * @returns {Array}
 */
const getVendorGrievances = () => {
  try {
    return JSON.parse(fs.readFileSync(vendorGrievancesFile, "utf8"));
  } catch {
    return [];
  }
};

/**
 * Persist vendor grievances to disk.
 * @param {Array} grievances
 */
const saveVendorGrievances = (grievances) => fs.writeFileSync(vendorGrievancesFile, JSON.stringify(grievances, null, 2));

const getEmployeeConcerns = () => {
  try {
    return JSON.parse(fs.readFileSync(employeeConcernsFile, "utf8"));
  } catch {
    return [];
  }
};

const saveEmployeeConcerns = (concerns) => fs.writeFileSync(employeeConcernsFile, JSON.stringify(concerns, null, 2));

const sanitizeEmployeeRecord = (employee) => {
  if (!employee || typeof employee !== 'object') return null;
  const {
    passwordHash,
    pinHash,
    pin,
    password,
    walletTransactions,
    otp,
    otpExpiresAt,
    otpAction,
    otpAttempts,
    ...rest
  } = employee;

  const wallet = {
    balance: Number(employee.walletBalance || rest.walletBalance || 0),
  };

  if (Array.isArray(employee.walletTransactions)) {
    wallet.transactions = employee.walletTransactions.slice(0, 10).map((tx) => ({
      id: tx.id,
      timestamp: tx.timestamp,
      type: tx.type,
      amount: tx.amount,
      reason: tx.reason,
      status: tx.status,
    }));
  }

  const output = {
    id: employee.id,
    username: employee.username || null,
    email: employee.email || null,
    mobile: employee.mobile || null,
    role: employee.role || null,
    roleSlug: employee.roleSlug || null,
    department: employee.department || null,
    bulkOrderEligible: Boolean(employee.bulkOrderEligible),
    createdAt: employee.createdAt || null,
    updatedAt: employee.updatedAt || null,
    lastLoginAt: employee.lastLoginAt || null,
    wallet,
  };

  if (employee.metadata && typeof employee.metadata === 'object') {
    output.metadata = employee.metadata;
  }

  return output;
};

const deleteEmployeeById = (employeeId) => {
  const employees = getEmployees();
  const nextEmployees = employees.filter((emp) => Number(emp.id) !== Number(employeeId));
  if (nextEmployees.length === employees.length) {
    return { removed: false };
  }
  saveEmployees(nextEmployees);

  for (const [token, session] of employeeSessions.entries()) {
    if (Number(session?.employeeId) === Number(employeeId)) {
      employeeSessions.delete(token);
      continue;
    }
    if (session?.mobile && employees.some((emp) => emp.mobile === session.mobile)) {
      continue;
    }
    if (session?.employeeId == null && session?.mobile) {
      const matched = nextEmployees.some((emp) => emp.mobile === session.mobile || emp.email === session.mobile);
      if (!matched) {
        employeeSessions.delete(token);
      }
    }
  }

  const concerns = getEmployeeConcerns();
  const updatedConcerns = concerns.map((concern) => {
    if (Number(concern.employeeId) !== Number(employeeId)) {
      return concern;
    }
    return {
      ...concern,
      username: null,
      department: concern.department || null,
    };
  });
  saveEmployeeConcerns(updatedConcerns);

  return { removed: true };
};

/**
 * Read bulk orders from disk.
 * @returns {Array}
 */
const getBulkOrders = (foodCourt = FC_DEFAULT) => {
  try {
    const targetFile = resolveCourtFile(bulkOrdersFile, foodCourt);
    if (!fs.existsSync(targetFile)) {
      fs.writeFileSync(targetFile, '[]');
    }
    const raw = fs.readFileSync(targetFile, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const saveBulkOrders = (orders, foodCourt = FC_DEFAULT) => {
  const targetFile = resolveCourtFile(bulkOrdersFile, foodCourt);
  fs.writeFileSync(targetFile, JSON.stringify(Array.isArray(orders) ? orders : [], null, 2));
};

const generateBulkOrderId = (existing = []) => {
  const max = existing.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
  return max + 1;
};

const clampString = (value, max = 120) => {
  if (value == null) return '';
  const str = String(value).trim();
  if (max <= 0) return str;
  return str.slice(0, max);
};

const BULK_DEFAULT_PRICE_MODE = 'vendor_rate';

const BULK_ORDER_STATUSES = new Set([
  'draft',
  'submitted_admin',
  'needs_revision',
  'approved_admin',
  'sent_to_vendor',
  'pending_vendor',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'admin_rejected'
]);

const normalizeBulkStatus = (value, fallback = 'draft') => {
  const slug = clampString(value || '', 60).toLowerCase();
  if (!slug) return fallback;
  return BULK_ORDER_STATUSES.has(slug) ? slug : fallback;
};

const deriveAdminReviewState = (status) => {
  const normalized = normalizeBulkStatus(status, 'draft');
  switch (normalized) {
    case 'draft':
      return 'draft';
    case 'submitted_admin':
      return 'under_review';
    case 'needs_revision':
      return 'needs_revision';
    case 'approved_admin':
    case 'sent_to_vendor':
    case 'pending_vendor':
    case 'confirmed':
    case 'in_progress':
    case 'completed':
      return 'approved';
    case 'admin_rejected':
    case 'cancelled':
      return 'closed';
    default:
      return 'draft';
  }
};

const buildBulkActorFromEmployee = (employee) => {
  if (!employee) return {};
  return {
    employeeId: employee.id,
    name: employee.username || '',
    mobile: employee.mobile || '',
    email: employee.email || '',
    role: employee.role || '',
    roleSlug: employee.roleSlug || '',
    department: employee.department || '',
  };
};

const buildBulkActorFromVendor = (vendor) => {
  if (!vendor) return {};
  const vendorName = vendor.shopName || vendor.vendorName || vendor.username || `Vendor ${vendor.vendorId}`;
  return {
    vendorId: vendor.vendorId,
    shopId: vendor.shopId,
    name: vendorName,
    username: vendor.username || '',
    email: vendor.email || vendor.contactEmail || '',
    role: 'vendor',
  };
};

const buildBulkActorFromAdmin = (admin) => ({
  adminUsername: admin?.username || 'admin',
  role: 'admin',
});

const buildBulkHistoryEntry = (type, actor = {}, details = {}) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
  type,
  actor,
  details,
});

const ensureBulkOrderReviewFields = (order) => {
  if (!order) return order;
  if (!order.adminReview || typeof order.adminReview !== 'object') {
    order.adminReview = {
      status: deriveAdminReviewState(order.status),
      decisions: [],
    };
  } else {
    if (!Array.isArray(order.adminReview.decisions)) {
      order.adminReview.decisions = [];
    }
    order.adminReview.status = order.adminReview.status || deriveAdminReviewState(order.status);
  }
  return order;
};

const appendAdminDecision = (order, entry) => {
  ensureBulkOrderReviewFields(order);
  const review = order.adminReview;
  const decision = {
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    action: String(entry.action || 'note'),
    comment: clampString(entry.comment || '', 600),
    actor: entry.actor || {},
  };
  review.decisions = [decision, ...(Array.isArray(review.decisions) ? review.decisions : [])].slice(0, 200);
  review.status = deriveAdminReviewState(order.status);
  return decision;
};

const setBulkOrderStatus = (order, nextStatus, actor = {}, details = {}) => {
  if (!order) return { changed: false, status: null };
  const target = normalizeBulkStatus(nextStatus, order.status);
  if (target === order.status) {
    return { changed: false, status: target };
  }
  const previous = order.status;
  order.status = target;
  const now = new Date().toISOString();
  order.lastStatusChangeAt = now;
  order.updatedAt = now;
  const entryDetails = { from: previous, to: target, ...details };
  const historyEntry = buildBulkHistoryEntry('status_change', actor, entryDetails);
  order.history = Array.isArray(order.history) ? [historyEntry, ...order.history] : [historyEntry];
  ensureBulkOrderReviewFields(order);
  order.adminReview.status = deriveAdminReviewState(order.status);
  return { changed: true, status: target };
};

const logEmailNotification = (to, subject, body) => {
  if (!to) return;
  console.log(`[Email] to ${to} | ${subject}\n${body}`);
};

const notifyBulkOrderOrganizer = (order, subject, body) => {
  if (!order) return;
  const contact = order.organizerContact || {};
  const targetEmail = contact.email || order.organizer?.email || null;
  logEmailNotification(targetEmail, subject, body);
};

const employeeCanManageBulkOrder = (employee, order) => {
  if (!employee || !order) return false;
  if (order.organizer && Number(order.organizer.employeeId) === Number(employee.id)) {
    return true;
  }
  return hasBulkOrderPrivileges(employee?.roleSlug);
};

const vendorCanAccessBulkOrder = (vendor, order) => {
  if (!vendor || !order) return false;
  const vendorShopId = vendor.shopId != null ? String(vendor.shopId) : '';
  if (!vendorShopId) return false;
  const directMatch = String(order.vendorShopId || '') === vendorShopId;
  const assignedList = Array.isArray(order.assignedVendors)
    ? order.assignedVendors.map((value) => String(value))
    : [];
  const assignedMatch = assignedList.includes(vendorShopId);
  return directMatch || assignedMatch;
};

const normalizeBulkPricing = (payload = {}) => {
  const pricingType = String(payload.pricing_type || payload.pricingType || '').trim().toLowerCase();
  const supported = new Set(['bulk_discount', 'vendor_rate', 'custom_quote']);
  const type = supported.has(pricingType) ? pricingType : BULK_DEFAULT_PRICE_MODE;
  const discountPct = Math.max(0, Math.min(100, Number(payload.bulk_discount_percent || payload.bulkDiscountPercent || 0)));
  const flatRate = Math.max(0, Number(payload.bulk_flat_rate || payload.bulkFlatRate || 0));
  return {
    pricingType: type,
    bulkDiscountPercent: discountPct,
    bulkFlatRate: flatRate,
  };
};

const computeBulkOrderTotals = ({ itemGroups = [], pricing }) => {
  let baseSubtotal = 0;
  for (const group of itemGroups) {
    const qty = Math.max(0, Number(group.quantity || 0));
    const unitPrice = Math.max(0, Number(group.unitPrice || group.price || 0));
    baseSubtotal += unitPrice * qty;
  }
  const normalizedPricing = normalizeBulkPricing(pricing);
  let total = baseSubtotal;
  let discountAmount = 0;
  if (normalizedPricing.pricingType === 'bulk_discount' && normalizedPricing.bulkDiscountPercent > 0) {
    discountAmount = (baseSubtotal * normalizedPricing.bulkDiscountPercent) / 100;
    total = Math.max(0, baseSubtotal - discountAmount);
  } else if (normalizedPricing.pricingType === 'custom_quote' && normalizedPricing.bulkFlatRate > 0) {
    total = normalizedPricing.bulkFlatRate;
    discountAmount = Math.max(0, baseSubtotal - total);
  }
  return {
    subtotal: Math.round(baseSubtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    totalAmount: Math.round(total * 100) / 100,
    pricing: normalizedPricing,
  };
};

const VENDOR_DIRECTORY_CACHE_TTL_MS = 60000;
const vendorDirectoryCache = new Map();

const invalidateVendorDirectoryCache = (foodCourt = null) => {
  if (!foodCourt) {
    vendorDirectoryCache.clear();
  } else {
    vendorDirectoryCache.delete(foodCourt);
  }
};

const getVendorDirectoryMap = (foodCourt = FC_DEFAULT) => {
  const now = Date.now();
  const cached = vendorDirectoryCache.get(foodCourt);
  if (cached && now - cached.timestamp < VENDOR_DIRECTORY_CACHE_TTL_MS) {
    return cached.map;
  }

  const directory = buildVendorDirectory(foodCourt);
  const map = new Map();
  directory.forEach((entry) => {
    if (!entry || entry.shopId == null) return;
    map.set(String(entry.shopId), entry);
  });

  vendorDirectoryCache.set(foodCourt, { map, timestamp: now });
  return map;
};

const sanitizeBulkOrder = (order, foodCourt = FC_DEFAULT) => {
  if (!order) return null;
  const { subtotal, discountAmount, totalAmount, pricing } = computeBulkOrderTotals(order);
  const vendorContact = resolveVendorContactForOrder(order, foodCourt);
  return {
    ...order,
    subtotal,
    discountAmount,
    totalAmount,
    pricing,
    vendorContact: vendorContact || null,
  };
};

const buildVendorDirectory = (foodCourt = FC_DEFAULT) => {
  const vendors = getVendors(foodCourt);
  const menu = getMenu(foodCourt);
  const shops = Array.isArray(menu)
    ? menu
    : (menu && Array.isArray(menu.shops) ? menu.shops : []);
  const shopLookup = new Map();
  shops.forEach((shop) => {
    const key = shop?.shopId ?? shop?.id;
    if (key == null) return;
    shopLookup.set(String(key), {
      shopId: shop.shopId ?? shop.id,
      shopName: shop.shopName || shop.name || `Shop ${key}`,
      contactEmail: shop.contactEmail || shop.email || null,
      contactPhone: shop.contactPhone || shop.phone || null,
    });
  });

  return vendors.map((vendor) => {
    const key = vendor?.shopId != null ? String(vendor.shopId) : null;
    const meta = key ? shopLookup.get(key) : null;
    return {
      vendorId: vendor.vendorId ?? vendor.id ?? null,
      shopId: vendor.shopId ?? null,
      username: vendor.username || '',
      shopName: meta?.shopName || (key ? `Shop ${key}` : 'Unknown shop'),
      contactEmail: meta?.contactEmail || null,
      contactPhone: meta?.contactPhone || null,
    };
  });
};

const validateIsoString = (value) => {
  if (!value) return null;
  const str = String(value);
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeBulkItemGroups = (groups) => {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((group, idx) => {
      const quantity = Math.max(0, Number(group.quantity || 0));
      const unitPrice = Math.max(0, Number(group.unitPrice || group.price || 0));
      if (!quantity) return null;
      return {
        id: group.id || `${Date.now()}-${idx}`,
        name: String(group.name || group.itemName || `Item Group ${idx + 1}`).trim().slice(0, 120),
        itemId: group.itemId || null,
        quantity,
        unitPrice,
        options: Array.isArray(group.options) ? group.options : [],
        notes: String(group.notes || '').trim().slice(0, 200),
        slotId: group.slotId || null,
      };
    })
    .filter(Boolean);
};

const normalizeBulkDeliverySlots = (slots) => {
  if (!Array.isArray(slots)) return [];
  return slots
    .map((slot, idx) => {
      const start = validateIsoString(slot.startTime || slot.start);
      const end = validateIsoString(slot.endTime || slot.end);
      const label = clampString(slot.label || slot.name || `Slot ${idx + 1}`, 80);
      if (!start || !end) return null;
      return {
        id: slot.id || `${Date.now()}-${idx}`,
        label,
        startTime: start,
        endTime: end,
        confirmed: Boolean(slot.confirmed),
        notes: clampString(slot.notes || '', 280),
        vendorConfirmation: slot.vendorConfirmation || null,
      };
    })
    .filter(Boolean);
};

const normalizeAttendeeGroups = (groups) => {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((group, idx) => {
      const count = Math.max(0, Number(group.count || group.size || 0));
      const label = clampString(group.label || group.name || `Group ${idx + 1}`, 120);
      const notes = clampString(group.notes || '', 240);
      if (!count && !notes) return null;
      return {
        id: group.id || `${Date.now()}-grp-${idx}`,
        label,
        count,
        notes,
      };
    })
    .filter(Boolean);
};

const normalizeBulkSubOrders = (subOrders) => {
  if (!Array.isArray(subOrders)) return [];
  return subOrders
    .map((sub, idx) => {
      const label = clampString(sub.label || sub.name || `Sub-order ${idx + 1}`, 120);
      const quantity = Math.max(0, Number(sub.quantity || 0));
      const slotId = sub.slotId || null;
      const notes = clampString(sub.notes || '', 240);
      const items = Array.isArray(sub.items) ? sub.items : [];
      if (!quantity && items.length === 0) return null;
      return {
        id: sub.id || `${Date.now()}-sub-${idx}`,
        label,
        quantity,
        slotId,
        notes,
        items,
      };
    })
    .filter(Boolean);
};

const sortSlotsByStartTime = (slots) => {
  if (!Array.isArray(slots)) return [];
  return slots.slice().sort((a, b) => {
    const aTs = a && a.startTime ? new Date(a.startTime).getTime() : Infinity;
    const bTs = b && b.startTime ? new Date(b.startTime).getTime() : Infinity;
    return aTs - bTs;
  });
};

const normalizeRequestedVendors = (vendors) => {
  if (!Array.isArray(vendors)) return [];
  return vendors.map((v) => clampString(v, 80)).filter(Boolean);
};

const normalizeAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => typeof a === 'string' && a.trim().length > 0)
    .map((a) => clampString(a, 300))
    .slice(0, 10);
};

const mergeMetadata = (current = {}, incoming = {}) => {
  const base = (current && typeof current === 'object' && !Array.isArray(current)) ? { ...current } : {};
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    for (const [key, value] of Object.entries(incoming)) {
      base[key] = value;
    }
  }
  return base;
};

const validateBulkOrderStructure = (order) => {
  if (!order) throw new Error('Invalid bulk order payload');
  if (!Array.isArray(order.itemGroups) || order.itemGroups.length === 0) {
    throw new Error('At least one item group is required for a bulk order');
  }
  const hasSchedule = (Array.isArray(order.deliverySlots) && order.deliverySlots.length > 0)
    || Boolean(order.eventStartTime)
    || Boolean(order.eventDate);
  if (!hasSchedule) {
    throw new Error('Provide an event date or at least one delivery slot for the bulk order');
  }
  return true;
};

const computeBulkOrderHeadcount = (attendeeGroups = [], itemGroups = [], fallbackValue = 0) => {
  const attendeeSum = attendeeGroups.reduce((sum, group) => sum + Math.max(0, Number(group.count || 0)), 0);
  const itemSum = itemGroups.reduce((sum, group) => sum + Math.max(0, Number(group.quantity || 0)), 0);
  const fallback = Math.max(0, Number(fallbackValue || 0));
  return attendeeSum || fallback || itemSum || 0;
};

const normalizeBulkOrderForCreate = (input, employee, existingOrders = [], foodCourt = FC_DEFAULT) => {
  if (!input || typeof input !== 'object') {
    throw new Error('Bulk order payload missing');
  }
  const itemGroups = normalizeBulkItemGroups(input.itemGroups);
  const deliverySlots = sortSlotsByStartTime(normalizeBulkDeliverySlots(input.deliverySlots));
  const attendeeGroups = normalizeAttendeeGroups(input.attendeeGroups);
  const subOrders = normalizeBulkSubOrders(input.subOrders);
  const attachments = normalizeAttachments(input.attachments);
  const requestedVendors = normalizeRequestedVendors(input.requestedVendors);
  const metadata = mergeMetadata({}, input.metadata);

  const expectedHeadcount = computeBulkOrderHeadcount(attendeeGroups, itemGroups, input.expectedHeadcount);
  const now = new Date().toISOString();
  const id = generateBulkOrderId(existingOrders);
  const initialStatus = normalizeBulkStatus(input.status || 'submitted_admin');

  const baseRecord = {
    id,
    status: initialStatus,
    organizer: buildBulkActorFromEmployee(employee),
    organizerContact: {
      name: clampString(input.organizerName || input.organizer?.name || employee?.username || '', 120),
      email: clampString(input.organizerEmail || input.organizer?.email || employee?.email || '', 150),
      mobile: clampString(input.organizerMobile || input.organizer?.mobile || employee?.mobile || '', 20),
    },
    eventName: clampString(input.eventName || input.event || '', 160),
    eventType: clampString(input.eventType || '', 80),
    eventTheme: clampString(input.eventTheme || '', 120),
    eventDate: input.eventDate ? validateIsoString(input.eventDate) : null,
    eventStartTime: validateIsoString(input.eventStartTime),
    eventEndTime: validateIsoString(input.eventEndTime),
    location: clampString(input.location || '', 200),
    building: clampString(input.building || '', 80),
    floor: clampString(input.floor || '', 60),
    campus: clampString(input.campus || '', 80),
    notes: clampString(input.notes || '', 600),
    specialInstructions: clampString(input.specialInstructions || '', 600),
    deliverySlots,
    itemGroups,
    attendeeGroups,
    subOrders,
    requestedVendors,
    attachments,
    metadata,
    expectedHeadcount,
    expectedGuests: expectedHeadcount,
    pricing: input.pricing || {},
    vendorShopId: input.vendorShopId != null ? String(input.vendorShopId) : (input.shopId != null ? String(input.shopId) : null),
    assignedVendors: Array.isArray(input.assignedVendors) ? input.assignedVendors.map((entry) => String(entry)) : [],
    vendorResponses: [],
    vendorMessages: [],
    linkedOrders: Array.isArray(input.linkedOrders) ? input.linkedOrders : [],
    createdAt: now,
    updatedAt: now,
    lastStatusChangeAt: now,
    history: [buildBulkHistoryEntry('created', buildBulkActorFromEmployee(employee), { status: initialStatus })],
    metadataVersion: 1,
    foodCourt,
  };

  validateBulkOrderStructure(baseRecord);
  ensureBulkOrderReviewFields(baseRecord);
  const sanitized = sanitizeBulkOrder(baseRecord, foodCourt);
  sanitized.deliverySlots = sortSlotsByStartTime(sanitized.deliverySlots);
  sanitized.expectedHeadcount = computeBulkOrderHeadcount(sanitized.attendeeGroups, sanitized.itemGroups, expectedHeadcount);
  sanitized.expectedGuests = sanitized.expectedHeadcount;
  sanitized.history = Array.isArray(baseRecord.history) ? baseRecord.history : [];
  sanitized.createdAt = now;
  sanitized.updatedAt = now;
  sanitized.lastStatusChangeAt = now;
  return sanitized;
};

const applyBulkOrderUpdates = (existingOrder, updates, employee) => {
  if (!existingOrder) throw new Error('Bulk order not found');
  if (!updates || typeof updates !== 'object') {
    return sanitizeBulkOrder(existingOrder);
  }

  const now = new Date().toISOString();
  const actor = buildBulkActorFromEmployee(employee);
  const next = { ...existingOrder };
  let statusChanged = false;
  const changedFields = new Set();

  if (updates.status) {
    const desiredStatus = normalizeBulkStatus(updates.status, existingOrder.status);
    const isOrganizer = employee && existingOrder.organizer && Number(existingOrder.organizer.employeeId) === Number(employee.id);
    const employeeAllowedStatuses = new Set(['draft', 'submitted_admin', 'cancelled', 'completed', 'confirmed', 'in_progress']);
    const canOverrideStatus = isOrganizer && employeeAllowedStatuses.has(desiredStatus);
    const privilegedOverride = !isOrganizer && hasBulkOrderPrivileges(employee?.roleSlug);
    if (canOverrideStatus || privilegedOverride) {
      const result = setBulkOrderStatus(next, desiredStatus, actor, {});
      if (result.changed) {
        statusChanged = true;
        changedFields.add('status');
      }
    }
  }

  if (updates.eventName != null) {
    next.eventName = clampString(updates.eventName, 160);
    changedFields.add('eventName');
  }
  if (updates.eventType != null) {
    next.eventType = clampString(updates.eventType, 80);
    changedFields.add('eventType');
  }
  if (updates.eventTheme != null) {
    next.eventTheme = clampString(updates.eventTheme, 120);
    changedFields.add('eventTheme');
  }
  if (updates.eventDate !== undefined) {
    next.eventDate = updates.eventDate ? validateIsoString(updates.eventDate) : null;
    changedFields.add('eventDate');
  }
  if (updates.eventStartTime !== undefined) {
    next.eventStartTime = validateIsoString(updates.eventStartTime);
    changedFields.add('eventStartTime');
  }
  if (updates.eventEndTime !== undefined) {
    next.eventEndTime = validateIsoString(updates.eventEndTime);
    changedFields.add('eventEndTime');
  }
  if (updates.location != null) {
    next.location = clampString(updates.location, 200);
    changedFields.add('location');
  }
  if (updates.building != null) {
    next.building = clampString(updates.building, 80);
    changedFields.add('building');
  }
  if (updates.floor != null) {
    next.floor = clampString(updates.floor, 60);
    changedFields.add('floor');
  }
  if (updates.campus != null) {
    next.campus = clampString(updates.campus, 80);
    changedFields.add('campus');
  }
  if (updates.notes != null) {
    next.notes = clampString(updates.notes, 600);
    changedFields.add('notes');
  }
  if (updates.specialInstructions != null) {
    next.specialInstructions = clampString(updates.specialInstructions, 600);
    changedFields.add('specialInstructions');
  }
  if (updates.organizerContact && typeof updates.organizerContact === 'object') {
    next.organizerContact = {
      ...next.organizerContact,
      name: clampString(updates.organizerContact.name || next.organizerContact?.name || '', 120),
      email: clampString(updates.organizerContact.email || next.organizerContact?.email || '', 150),
      mobile: clampString(updates.organizerContact.mobile || next.organizerContact?.mobile || '', 20),
    };
    changedFields.add('organizerContact');
  }

  if (updates.itemGroups) {
    next.itemGroups = normalizeBulkItemGroups(updates.itemGroups);
    changedFields.add('itemGroups');
  }
  if (updates.deliverySlots) {
    next.deliverySlots = sortSlotsByStartTime(normalizeBulkDeliverySlots(updates.deliverySlots));
    changedFields.add('deliverySlots');
  }
  if (updates.attendeeGroups) {
    next.attendeeGroups = normalizeAttendeeGroups(updates.attendeeGroups);
    changedFields.add('attendeeGroups');
  }
  if (updates.subOrders) {
    next.subOrders = normalizeBulkSubOrders(updates.subOrders);
    changedFields.add('subOrders');
  }
  if (updates.attachments) {
    next.attachments = normalizeAttachments(updates.attachments);
    changedFields.add('attachments');
  }
  if (updates.requestedVendors) {
    next.requestedVendors = normalizeRequestedVendors(updates.requestedVendors);
    changedFields.add('requestedVendors');
  }
  if (updates.assignedVendors) {
    next.assignedVendors = Array.isArray(updates.assignedVendors) ? updates.assignedVendors.map((entry) => String(entry)) : [];
    changedFields.add('assignedVendors');
  }
  if (updates.vendorShopId !== undefined) {
    next.vendorShopId = updates.vendorShopId != null ? String(updates.vendorShopId) : null;
    changedFields.add('vendorShopId');
  }
  if (updates.pricing) {
    next.pricing = updates.pricing;
    changedFields.add('pricing');
  }
  if (updates.metadata) {
    next.metadata = mergeMetadata(next.metadata, updates.metadata);
    changedFields.add('metadata');
  }
  if (updates.expectedHeadcount !== undefined) {
    next.expectedHeadcount = Math.max(0, Number(updates.expectedHeadcount || 0));
    next.expectedGuests = next.expectedHeadcount;
    changedFields.add('expectedHeadcount');
  }
  if (updates.vendorMessages && Array.isArray(updates.vendorMessages)) {
    next.vendorMessages = updates.vendorMessages;
    changedFields.add('vendorMessages');
  }
  if (updates.linkedOrders && Array.isArray(updates.linkedOrders)) {
    next.linkedOrders = updates.linkedOrders;
    changedFields.add('linkedOrders');
  }

  validateBulkOrderStructure(next);

  const sanitized = sanitizeBulkOrder(next);
  sanitized.deliverySlots = sortSlotsByStartTime(sanitized.deliverySlots);
  sanitized.expectedHeadcount = computeBulkOrderHeadcount(sanitized.attendeeGroups, sanitized.itemGroups, sanitized.expectedHeadcount);
  sanitized.expectedGuests = sanitized.expectedHeadcount;
  sanitized.updatedAt = now;

  const history = Array.isArray(existingOrder.history) ? existingOrder.history.slice() : [];
  if (statusChanged) {
    history.unshift(buildBulkHistoryEntry('status_changed', actor, { from: existingOrder.status, to: sanitized.status }));
  }
  if (changedFields.size > (statusChanged ? 1 : 0)) {
    history.unshift(buildBulkHistoryEntry('updated', actor, { fields: Array.from(changedFields) }));
  }
  sanitized.history = history;
  if (!sanitized.lastStatusChangeAt) {
    sanitized.lastStatusChangeAt = existingOrder.lastStatusChangeAt || existingOrder.updatedAt || now;
  }
  return sanitized;
};

const getSosState = () => {
  try {
    const raw = fs.readFileSync(sosStateFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    const fallback = {
      active: false,
      lastTriggeredAt: null,
      lastTriggeredBy: null,
      message: null,
      currentEventId: null,
      events: []
    };
    try {
      fs.writeFileSync(sosStateFile, JSON.stringify(fallback, null, 2));
    } catch {}
    return fallback;
  }
};

const saveSosState = (state) => {
  fs.writeFileSync(sosStateFile, JSON.stringify(state, null, 2));
};

const broadcastSosAlert = (state) => {
  // Placeholder for future integrations (e.g., push notifications, SMS gateway, email).
  console.log("\n==== SOS ALERT BROADCAST ====");
  console.log(`Active: ${state.active}`);
  console.log(`Triggered By: ${state.lastTriggeredBy || "Unknown"}`);
  console.log(`Triggered At: ${state.lastTriggeredAt || "Unknown"}`);
  if (state.message) console.log(`Message: ${state.message}`);
  console.log(`Event ID: ${state.currentEventId || "n/a"}`);
  console.log("==============================\n");
};

// Combos
/** @returns {Array} */
const getCombos = (foodCourt = FC_DEFAULT) => readJsonFrom(resolveCourtFile(combosFile, foodCourt), []);
/** @param {Array} combos */
const saveCombos = (combos, foodCourt = FC_DEFAULT) => writeJsonTo(resolveCourtFile(combosFile, foodCourt), Array.isArray(combos) ? combos : []);

// Offers
/** @returns {Array} */
const getOffers = (foodCourt = FC_DEFAULT) => readJsonFrom(resolveCourtFile(offersFile, foodCourt), []);
/** @param {Array} offers */
const saveOffers = (offers, foodCourt = FC_DEFAULT) => writeJsonTo(resolveCourtFile(offersFile, foodCourt), Array.isArray(offers) ? offers : []);

const normalizeOfferInputForStorage = (offer, vendorShopId) => {
  const safeId = offer?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const base = {
    id: safeId,
    shopId: Number(vendorShopId),
    title: offer?.title || "Special Offer",
    bannerText: offer?.bannerText || offer?.title || "Offer",
    description: offer?.description || "",
    active: offer?.active !== false,
    stackable: offer?.stackable !== false,
    priority: offer?.priority != null ? Number(offer.priority) : 0,
    maxDiscountAmount: offer?.maxDiscountAmount != null ? Number(offer.maxDiscountAmount) : null,
    discountPercent: offer?.discountPercent != null && offer.discountPercent !== "" ? Number(offer.discountPercent) : null,
    discountAmount: offer?.discountAmount != null && offer.discountAmount !== "" ? Number(offer.discountAmount) : null,
    applicableSections: Array.isArray(offer?.applicableSections) ? offer.applicableSections.map(String) : [],
    applicableComboIds: Array.isArray(offer?.applicableComboIds) ? offer.applicableComboIds.map((cid) => String(cid)) : [],
    start: offer?.start || null,
    end: offer?.end || null,
    timeStart: offer?.timeStart || null,
    timeEnd: offer?.timeEnd || null,
    daysOfWeek: Array.isArray(offer?.daysOfWeek) ? offer.daysOfWeek.map((d) => Number(d)) : null,
    schedule: offer?.schedule && typeof offer.schedule === "object"
      ? {
          start: offer.schedule.start || null,
          end: offer.schedule.end || null,
          timeStart: offer.schedule.timeStart || null,
          timeEnd: offer.schedule.timeEnd || null,
          daysOfWeek: Array.isArray(offer.schedule.daysOfWeek) ? offer.schedule.daysOfWeek.map((d) => Number(d)) : null,
        }
      : null,
    conditions: Array.isArray(offer?.conditions) ? offer.conditions : [],
    rewards: Array.isArray(offer?.rewards) ? offer.rewards : [],
    metadata: offer?.metadata && typeof offer.metadata === "object" ? offer.metadata : null,
    createdAt: offer?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  return base;
};

// Section time windows
/** @returns {Record<string,{start:string,end:string}>} */
const getSectionWindows = () => {
  try {
    return JSON.parse(fs.readFileSync(sectionWindowsFile, "utf8"));
  } catch {
    return {};
  }
};

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
 * @param {string} foodCourt
 * @returns {number}
 */
const calculatePreparationTime = (items, shopId, foodCourt = FC_DEFAULT) => {
  const orders = getOrders(foodCourt);
  const pendingOrders = orders.filter(o => o.shopId === shopId && o.status === "pending").length;
  
  const totalItemTime = items.reduce((sum, item) => sum + (item.prepTime || 5), 0);
  const queueTime = pendingOrders * 2;
  
  return Math.max(totalItemTime + queueTime, 5);
};

const calculateOrderTotal = (order) => {
  if (!order) return 0;
  if (order.totalAmount != null) {
    const parsed = Number(order.totalAmount);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (!Array.isArray(order.items)) return 0;
  const total = order.items.reduce((sum, it) => {
    const price = Number(it?.price || 0);
    const qty = Number(it?.quantity || 0);
    return sum + price * qty;
  }, 0);
  return Math.round(total * 100) / 100;
};

const ensureDirectory = async (dirPath) => {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
};

const getEmployeeByUserId = (user) => {
  if (!user) return null;
  const employees = getEmployees();
  const key = String(user).trim().toLowerCase();
  return employees.find((emp) =>
    String(emp.mobile || '').trim().toLowerCase() === key ||
    String(emp.username || '').trim().toLowerCase() === key ||
    String(emp.email || '').trim().toLowerCase() === key
  ) || null;
};

const evaluateScheduledCancellation = (order) => {
  if (!order) return { allowed: false, reason: "Order not found" };
  if (!order.scheduledTime) {
    return { allowed: false, reason: "Only scheduled orders can be cancelled." };
  }
  if ((order.status || "").toLowerCase() !== "pending") {
    return { allowed: false, reason: "Only pending scheduled orders can be cancelled." };
  }
  const scheduledDate = new Date(order.scheduledTime);
  if (Number.isNaN(scheduledDate.getTime())) {
    return { allowed: false, reason: "Scheduled time is invalid for this order." };
  }
  const now = new Date();
  const diffMinutes = (scheduledDate.getTime() - now.getTime()) / 60000;
  if (diffMinutes <= 0) {
    return { allowed: false, reason: "The scheduled window has already started." };
  }
  let refundPercent = null;
  let policy = null;
  if (diffMinutes >= 60) {
    refundPercent = 1;
    policy = "Full refund (cancel ≥ 60 minutes before scheduled time)";
  } else if (diffMinutes >= 30) {
    refundPercent = 0.75;
    policy = "75% refund (cancel 30-59 minutes before scheduled time)";
  } else {
    return {
      allowed: false,
      reason: "Cancellations are allowed until 30 minutes before the scheduled time.",
      diffMinutes
    };
  }
  const total = calculateOrderTotal(order);
  const refundAmount = Math.round(total * refundPercent * 100) / 100;
  const feeAmount = Math.round((total - refundAmount) * 100) / 100;
  return {
    allowed: true,
    refundAmount,
    feeAmount,
    refundPercent,
    diffMinutes,
    policy
  };
};

const restockInventory = (rawMenu, targetShopId, itemId, qty) => {
  const quantity = Number(qty || 0);
  if (!quantity) return;
  const shopIdStr = String(targetShopId);
  if (Array.isArray(rawMenu)) {
    const shopEntry = rawMenu.find((x) => String(x.shopId) === shopIdStr);
    if (!shopEntry || !Array.isArray(shopEntry.items)) return;
    const item = shopEntry.items.find((i) => i.id === itemId);
    if (item) {
      const current = Number(item.inventory ?? 0);
      item.inventory = current + quantity;
    }
    return;
  }
  const shops = Array.isArray(rawMenu?.shops) ? rawMenu.shops : [];
  const shopEntry = shops.find((x) => String(x.shopId) === shopIdStr);
  if (!shopEntry || !Array.isArray(shopEntry.categories)) return;
  for (const category of shopEntry.categories) {
    if (!Array.isArray(category.items)) continue;
    const found = category.items.find((i) => i.id === itemId);
    if (found) {
      const current = Number(found.inventory ?? 0);
      found.inventory = current + quantity;
      return;
    }
  }
};

const getMenuItemSnapshot = (rawMenu, targetShopId, itemId) => {
  const shopIdStr = String(targetShopId);
  const idNum = Number(itemId);
  if (Array.isArray(rawMenu)) {
    const shopEntry = rawMenu.find((x) => String(x.shopId) === shopIdStr);
    if (!shopEntry || !Array.isArray(shopEntry.items)) return null;
    const item = shopEntry.items.find((i) => Number(i.id) === idNum);
    if (!item) return null;
    return {
      inventory: Number(item.inventory ?? 0),
      name: item.name || null,
    };
  }
  const shops = Array.isArray(rawMenu?.shops) ? rawMenu.shops : [];
  const shopEntry = shops.find((x) => String(x.shopId) === shopIdStr);
  if (!shopEntry || !Array.isArray(shopEntry.categories)) return null;
  for (const category of shopEntry.categories) {
    if (!Array.isArray(category.items)) continue;
    const item = category.items.find((i) => Number(i.id) === idNum);
    if (!item) continue;
    return {
      inventory: Number(item.inventory ?? 0),
      name: item.name || null,
    };
  }
  return null;
};

const getMenuItemInventory = (rawMenu, targetShopId, itemId) => {
  const snapshot = getMenuItemSnapshot(rawMenu, targetShopId, itemId);
  return snapshot ? snapshot.inventory : null;
};

// Middleware: Authenticate admin via headers
function authenticateAdmin(req, res, next) {
  const username = String(req.headers["x-admin-username"] || "").trim();
  const password = String(req.headers["x-admin-password"] || "").trim();
  if (!username || !password) {
    return res.status(401).json({ message: "Admin credentials required" });
  }
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(403).json({ message: "Invalid admin credentials" });
  }
  req.admin = { username };
  next();
}

// Get menu
/**
 * GET /menu
 * Public: Returns the entire menu with shops and items.
 */
app.get("/menu", (req, res) => {
  try {
    const raw = loadUserMenu(req);
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
    const orders = getOrders(foodCourt);
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
    const orders = getOrders(req.vendor.foodCourt || FC_DEFAULT);
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

// ===== Interest Tracking =====

app.post('/interest', authenticateEmployee, (req, res) => {
  try {
    const { shopId, itemId } = req.body || {};
    const shopIdStr = shopId != null ? String(shopId).trim() : '';
    const itemIdStr = itemId != null ? String(itemId).trim() : '';

    if (!shopIdStr || !itemIdStr) {
      return res.status(400).json({ message: 'shopId and itemId are required' });
    }

    const foodCourt = getUserFoodCourt(req);
    const metadata = findMenuItemMetadata(shopIdStr, itemIdStr, foodCourt);
    if (!metadata) {
      return res.status(404).json({ message: 'Menu item not found' });
    }

    if (!isSoldOut(metadata) && !isLowStock(metadata)) {
      return res.status(409).json({ message: 'Interest can only be expressed for sold-out or low-stock items' });
    }

    const vendorId = getVendorIdForShop(shopIdStr, foodCourt);
    const identitySet = getEmployeeIdentitySet(req.employee || {}, req.employeeSession || null);
    const records = getItemInterestRecords(foodCourt);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    let deduped = false;
    const relevantRecords = records.filter((record) => String(record.shopId) === shopIdStr && String(record.itemId) === itemIdStr);
    for (const record of relevantRecords) {
      if (!hasIdentityOverlap(record, identitySet)) continue;
      const ts = record.timestamp ? new Date(record.timestamp).getTime() : null;
      if (Number.isFinite(ts) && nowMs - ts < INTEREST_DEDUP_WINDOW_MS) {
        deduped = true;
        break;
      }
    }

    if (!deduped) {
      const employee = req.employee || {};
      const session = req.employeeSession || {};
      const employeeId = employee.id != null ? String(employee.id) : (session.employeeId != null ? String(session.employeeId) : null);
      const employeeMobile = employee.mobile || session.mobile || null;
      const employeeContact = employee.contact || session.contact || null;
      const employeeEmail = employee.email || session.email || null;
      const employeeUsername = employee.username || session.username || null;

      const newRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        shopId: shopIdStr,
        itemId: itemIdStr,
        vendorId,
        timestamp: nowIso,
        employeeId,
        employeeMobile: employeeMobile != null ? String(employeeMobile) : null,
        employeeContact: employeeContact != null ? String(employeeContact) : null,
        employeeEmail: employeeEmail != null ? String(employeeEmail) : null,
        employeeUsername: employeeUsername != null ? String(employeeUsername) : null,
      };

      records.push(newRecord);
      ensureInterestCapacity(records);
      saveItemInterestRecords(records, foodCourt);

      recordAuditEvent({
        actorType: 'employee',
        actorId: employeeId,
        shopId: shopIdStr,
        vendorId: vendorId != null ? Number(vendorId) : null,
        action: 'interest.expressed',
        metadata: {
          itemId: itemIdStr,
          deduped: false,
        },
      });
    }

    const aggregated = aggregateInterest(records);
    const entry = getInterestEntry(aggregated, shopIdStr, itemIdStr) || {
      shopId: shopIdStr,
      itemId: itemIdStr,
      vendorId,
      uniqueEmployees: 0,
      totalClicks: 0,
      history: [],
      firstExpressedAt: null,
      lastExpressedAt: null,
    };
    const threshold = getVendorThresholdValue(entry.vendorId ?? vendorId);
    const summary = buildInterestSummary({ entry, metadata, threshold });

    res.json({
      status: deduped ? 'duplicate' : 'ok',
      summary,
      cooldownMs: INTEREST_DEDUP_WINDOW_MS,
    });
  } catch (error) {
    console.error('Error recording interest', error);
    res.status(500).json({ message: 'Failed to record interest' });
  }
});

app.get('/vendor/interest/summary', authenticateVendor, requirePermission('analytics:read'), (req, res) => {
  try {
    const vendorId = req.vendor.vendorId != null ? String(req.vendor.vendorId) : null;
    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor session missing vendorId' });
    }

    const thresholdsMap = getVendorInterestThresholds();
    const baseThreshold = getVendorThresholdValue(vendorId, thresholdsMap);
    const aggregated = aggregateInterest(getItemInterestRecords());

    const items = aggregated
      .filter((entry) => {
        const entryVendorId = entry.vendorId != null ? String(entry.vendorId) : getVendorIdForShop(entry.shopId, foodCourt);
        return entryVendorId != null && String(entryVendorId) === vendorId;
      })
      .map((entry) => {
        const metadata = findMenuItemMetadata(entry.shopId, entry.itemId, foodCourt);
        const threshold = getVendorThresholdValue(entry.vendorId != null ? entry.vendorId : vendorId, thresholdsMap);
        return buildInterestSummary({ entry, metadata, threshold, foodCourt });
      })
      .sort((a, b) => {
        const aTs = a.lastExpressedAt ? new Date(a.lastExpressedAt).getTime() : 0;
        const bTs = b.lastExpressedAt ? new Date(b.lastExpressedAt).getTime() : 0;
        return bTs - aTs;
      });

    const totals = items.reduce(
      (acc, item) => {
        acc.uniqueEmployees += item.uniqueEmployees;
        acc.totalClicks += item.totalClicks;
        if (item.restockSuggested) acc.restockSuggestions += 1;
        return acc;
      },
      { uniqueEmployees: 0, totalClicks: 0, restockSuggestions: 0 }
    );

    recordAuditEvent({
      actorType: 'vendor',
      actorId: req.vendor.vendorId,
      vendorId: req.vendor.vendorId,
      shopId: req.vendor.shopId,
      action: 'interest.summary.viewed',
      metadata: { itemCount: items.length },
    });

    res.json({
      status: 'ok',
      vendorId: req.vendor.vendorId,
      shopId: req.vendor.shopId ?? null,
      threshold: baseThreshold,
      totals,
      items,
      restockSuggestions: items.filter((item) => item.restockSuggested).map((item) => ({ shopId: item.shopId, itemId: item.itemId })),
    });
  } catch (error) {
    console.error('Error generating interest summary', error);
    res.status(500).json({ message: 'Failed to load interest summary' });
  }
});

app.put('/vendor/interest/threshold', authenticateVendor, requirePermission('analytics:write'), (req, res) => {
  try {
    const vendorId = req.vendor.vendorId != null ? String(req.vendor.vendorId) : null;
    if (!vendorId) {
      return res.status(400).json({ message: 'Vendor session missing vendorId' });
    }

    const body = req.body || {};
    const rawValue = body.threshold != null ? body.threshold : body.value;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return res.status(400).json({ message: 'threshold must be a number' });
    }

    const normalized = Math.max(1, Math.min(1000, Math.round(parsed)));
    const thresholdsMap = getVendorInterestThresholds();
    const previous = thresholdsMap[vendorId] ?? null;
    thresholdsMap[vendorId] = normalized;
    saveVendorInterestThresholds(thresholdsMap);

    recordAuditEvent({
      actorType: 'vendor',
      actorId: req.vendor.vendorId,
      vendorId: req.vendor.vendorId,
      shopId: req.vendor.shopId,
      action: 'interest.threshold.updated',
      metadata: { previous, next: normalized },
    });

    res.json({ status: 'ok', threshold: normalized });
  } catch (error) {
    console.error('Error updating interest threshold', error);
    res.status(500).json({ message: 'Failed to update threshold' });
  }
});

// Note: employee authentication is limited to registered credentials (username/password or PIN)

// Place order with billing ID and customization
/**
 * POST /order
 * Public: Place an order.
 * @body {items:Array,user?:string,scheduledTime?:string,shopId:string,paymentMethod?:string,paymentPayload?:object}
 * @returns { billingId:string, orderSummary:object }
 */
app.post("/order", (req, res) => {
  try {
    const { items, user, scheduledTime, shopId, paymentMethod = 'gateway', paymentPayload = {}, orderNotes = '', employeeToken: explicitEmployeeToken = null } = req.body;
    const foodCourt = getUserFoodCourt(req);
    // Validate inventory and decrement (supports combo expansion)
    const raw = getMenu(foodCourt);
    const normalizedShops = normalizeMenuShops(raw);
    const shopNorm = normalizedShops.find((s) => String(s.shopId) === String(shopId));
    if (!shopNorm) {
      return res.status(400).json({ message: "Invalid shopId" });
    }
    shopNorm.items = Array.isArray(shopNorm.items) ? shopNorm.items : [];

    // Expand combos into required item quantities (with combo time window validation)
    const combos = getCombos(foodCourt);
    const isComboLine = (x) => x && (x.comboId != null);
    const toHM = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const whenHM = scheduledTime ? toHM(new Date(scheduledTime)) : toHM(new Date());
    const inComboWindowHM = (combo, hm) => {
      const start = combo?.availableStart;
      const end = combo?.availableEnd;
      if (!start || !end) return true;
      return hm >= start && hm <= end;
    };
    const orderCombos = (items || []).filter(isComboLine);
    const orderSingles = (items || []).filter((x)=>!isComboLine(x));
    // Validate combo windows first
    const invalidCombos = [];
    const validCombos = [];
    for (const it of orderCombos) {
      const combo = combos.find(c => String(c.id) === String(it.comboId) && String(c.shopId) === String(shopId) && (c.active !== false));
      if (!combo) { invalidCombos.push({ comboId: it.comboId, reason: 'Invalid combo' }); continue; }
      if (!inComboWindowHM(combo, whenHM)) {
        invalidCombos.push({ comboId: it.comboId, name: combo.name, window: (combo.availableStart && combo.availableEnd) ? `${combo.availableStart}-${combo.availableEnd}` : null });
      } else {
        validCombos.push({ line: it, combo });
      }
    }
    if (scheduledTime && invalidCombos.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Some combos are not available at the selected time window.',
        notAvailableCombos: invalidCombos
      });
    }
    const required = new Map(); // itemId -> qty
    const flatItems = [];
    // Expand valid combos first
    for (const ent of validCombos) {
      const { line: it, combo } = ent;
      const qty = Number(it.quantity || 1);
      const comp = Array.isArray(combo.components) ? combo.components : [];
      for (const compIt of comp) {
        const id = compIt.itemId;
        const inc = Number(compIt.quantity || 1) * qty;
        required.set(id, (required.get(id) || 0) + inc);
        flatItems.push({ id, name: compIt.name || (shopNorm.items.find(i=>i.id===id)?.name) || `Item ${id}` , price: Number(compIt.overridePrice ?? (shopNorm.items.find(i=>i.id===id)?.price || 0)), quantity: inc, option: compIt.option || null, prepTime: compIt.prepTime || (shopNorm.items.find(i=>i.id===id)?.prepTime || 5) });
      }
    }
    // For immediate orders, drop invalid combos silently but return info later
    if (!scheduledTime && invalidCombos.length > 0) {
      req._excludedCombos = invalidCombos;
    }
    // Process standalone items
    for (const it of orderSingles) {
      const qty = Number(it.quantity || 1);
      const key = it.id;
      required.set(key, (required.get(key) || 0) + qty);
      flatItems.push({ id: it.id, name: it.name, price: it.price, quantity: qty, option: it.option || null, prepTime: it.prepTime });
    }

    // Section window enforcement
    const windows = getSectionWindows();
    const inWindowHM = (sec, hm) => {
      const w = windows[sec];
      if (!w || !w.start || !w.end) return true;
      return hm >= w.start && hm <= w.end;
    };
    const idToSection = new Map((shopNorm.items || []).map(i => [Number(i.id), i.section || 'All Items']));
    const itemLookup = new Map((shopNorm.items || []).map((i) => [Number(i.id), i]));
    const comboCounts = new Map();
    for (const { line } of validCombos) {
      const comboQty = Number(line.quantity || 1);
      const comboKey = String(line.comboId);
      comboCounts.set(comboKey, (comboCounts.get(comboKey) || 0) + comboQty);
    }

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
      // If any combos invalid, include them too
      if (Array.isArray(invalidCombos) && invalidCombos.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Some items/combos are not available at the selected time window. Please adjust scheduled time.',
          notAvailable,
          notAvailableCombos: invalidCombos
        });
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
      // Also attach excluded combos
      if (Array.isArray(req._excludedCombos) && req._excludedCombos.length > 0) {
        req._excludedItems = (req._excludedItems || []).concat(req._excludedCombos.map(c => ({ name: c.name || `Combo ${c.comboId}`, section: 'Combo', window: c.window || null })));
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
    const inventoryAdjustments = [];
    for (const [itemId, qtyNeeded] of required.entries()) {
      const beforeSnapshot = getMenuItemSnapshot(raw, shopId, itemId);
      persistDecrement(raw, shopId, itemId, qtyNeeded);
      const afterSnapshot = getMenuItemSnapshot(raw, shopId, itemId);
      inventoryAdjustments.push({
        shopId,
        itemId,
        itemName: beforeSnapshot?.name || afterSnapshot?.name || null,
        delta: -qtyNeeded,
        previous: beforeSnapshot?.inventory ?? null,
        current: afterSnapshot?.inventory ?? null,
        reason: "order-placement",
      });
    }
    saveMenu(raw, foodCourt);

    const orders = getOrders(foodCourt);

    const billingId = generateBillingId();

    const now = new Date();
    const evaluationDate = scheduledTime ? new Date(scheduledTime) : now;
    const activeOffers = getOffers(foodCourt).filter((o) => {
      if (String(o.shopId) !== String(shopId)) return false;
      const start = o.start ? new Date(o.start) : null;
      const end = o.end ? new Date(o.end) : null;
      if (start && evaluationDate < start) return false;
      if (end && evaluationDate > end) return false;
      return o.active !== false;
    });

    const evaluation = evaluateOffers({
      offers: activeOffers,
      flatItems,
      sectionLookup: idToSection,
      itemLookup,
      comboCounts,
      evaluationDate,
      now
    });

    const subtotalBeforeDiscount = evaluation.subtotalBeforeDiscount;
    let discountTotal = evaluation.discountTotal;
    const offerExtras = Array.isArray(evaluation.extraItems) ? evaluation.extraItems : [];
    let appliedOffers = Array.isArray(evaluation.appliedOffers)
      ? evaluation.appliedOffers.map((off) => ({
          ...off,
          rewards: Array.isArray(off.rewards) ? off.rewards.map((r) => ({ ...r })) : [],
        }))
      : [];

    const OFFERS_MAX_DISCOUNT = Number(process.env.OFFERS_MAX_DISCOUNT || 0);
    if (OFFERS_MAX_DISCOUNT > 0 && discountTotal > OFFERS_MAX_DISCOUNT) {
      let excess = discountTotal - OFFERS_MAX_DISCOUNT;
      discountTotal = OFFERS_MAX_DISCOUNT;
      for (let i = appliedOffers.length - 1; i >= 0 && excess > 0; i -= 1) {
        const offer = appliedOffers[i];
        const reducible = Math.min(excess, offer.discountAmount || 0);
        if (reducible > 0) {
          offer.discountAmount = Math.max(0, (offer.discountAmount || 0) - reducible);
          excess -= reducible;
        }
      }
    }

    const offerSummary = {
      subtotalBeforeDiscount,
      discountTotal,
      totalPayable: Math.max(0, subtotalBeforeDiscount - discountTotal),
      appliedOffers,
      extraItems: offerExtras
    };

    const freeLines = [];
    for (const extra of offerExtras) {
      const itemId = Number(extra.id);
      if (!Number.isFinite(itemId)) continue;
      const quantity = Math.max(1, Number(extra.quantity || 1));
      const ref = itemLookup.get(itemId) || {};
      const name = extra.name || ref.name || `Item ${itemId}`;
      const price = Number(extra.price || 0);
      freeLines.push({
        id: itemId,
        name,
        price,
        quantity,
        option: null,
        prepTime: ref.prepTime || 5,
        offerSource: extra.fromOfferId || null,
        isOfferFreebie: true
      });
    }
    if (freeLines.length > 0) {
      flatItems.push(...freeLines);
    }

    let totalAmount = offerSummary.totalPayable;

    const prepTime = calculatePreparationTime(items, shopId, foodCourt);
    const estimatedReadyTime = new Date(Date.now() + prepTime * 60000).toISOString();

    const normalizedNotes = clampString(orderNotes || paymentPayload?.notes || '', 400);

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
      feedback: null,
      totalAmount,
      subtotalBeforeDiscount,
      discountTotal,
      offerSummary,
      notes: normalizedNotes || null
    };

    if (req.body?.bulkOrderId != null) {
      newOrder.bulkOrderId = Number(req.body.bulkOrderId);
      newOrder.orderType = 'bulk-linked';
    }

    let paymentSummary = { method: paymentMethod, amount: totalAmount };

    if (paymentMethod === 'wallet') {
      const employees = getEmployees();
      const employeeIndex = employees.findIndex((emp) => String(emp.mobile || '').toLowerCase() === String(user || '').toLowerCase());
      if (employeeIndex === -1) {
        return res.status(400).json({ status: 'error', message: 'Wallet not available for this user' });
      }
      const employee = employees[employeeIndex];
      ensureWalletFields(employee);
      if (Number(employee.walletBalance || 0) < totalAmount) {
        return res.status(400).json({ status: 'error', message: 'Insufficient wallet balance' });
      }
      const newBalance = formatCurrency(employee.walletBalance - totalAmount);
      employee.walletBalance = newBalance;
      const tx = {
        type: 'debit',
        reason: 'order-payment',
        orderBillingId: billingId,
        amount: totalAmount
      };
      recordWalletTransaction(employees, employee, tx);
      saveEmployees(employees);
      paymentSummary = { method: 'wallet', amount: totalAmount, walletBalance: newBalance };
    } else if (paymentMethod === 'cash') {
      paymentSummary = { method: 'cash', amount: totalAmount };
    } else {
      paymentSummary = {
        method: 'gateway',
        amount: totalAmount,
        provider: paymentPayload?.provider || 'razorpay-open',
        reference: paymentPayload?.reference || `PG-${Date.now()}`
      };
    }

    newOrder.payment = paymentSummary;

    orders.push(newOrder);
    saveOrders(orders, foodCourt);

    try {
      (Array.isArray(items) ? items : []).forEach((item) => {
        const numericId = item?.id ?? item?.itemId;
        if (numericId == null) return;
        const quantity = Number(item.quantity || 1);
        const delta = -Math.abs(quantity);
        emitInventoryAdjustedEvent({
          shopId: shopId,
          itemId: numericId,
          itemName: item.name || null,
          delta,
          orderId: newOrder.id,
          billingId,
          reason: "order-created",
          actor: {
            type: "system",
            source: "order.create",
            userId: user || null,
          },
        });
      });
    } catch (inventoryError) {
      console.warn("Failed to emit inventory adjustment events", inventoryError);
    }

    emitOrderCreatedEvent(newOrder, {
      user: user || null,
      payment: paymentSummary,
      excludedItems: Array.isArray(req._excludedItems) ? req._excludedItems : null,
      meta: {
        requestId: req.headers["x-request-id"] || null,
        source: req.headers["x-client-source"] || "frontend",
      },
    });

    for (const adj of inventoryAdjustments) {
      emitInventoryAdjustedEvent({
        ...adj,
        orderId: newOrder.id,
        billingId,
        actor: {
          type: "order-system",
          userId: user || null,
        },
      });
    }

    const orderSummary = {
      billingId,
      user: newOrder.user,
      totalAmount,
      items: flatItems,
      estimatedReadyTime,
      prepTime,
      subtotalBeforeDiscount,
      discountTotal,
      appliedOffers,
      offerExtras: offerExtras
    };

    const resolvedEmployee = (() => {
      const explicit = explicitEmployeeToken ? resolveEmployeeFromToken(explicitEmployeeToken) : null;
      if (explicit?.employee) return explicit;
      if (!user) return null;
      const employees = getEmployees();
      const employeeIndex = employees.findIndex((emp) => String(emp.mobile || '').toLowerCase() === String(user || '').toLowerCase());
      if (employeeIndex === -1) return null;
      const employee = employees[employeeIndex];
      return { employee, employees, index: employeeIndex };
    })();

    if (resolvedEmployee?.employee) {
      try {
        const employeeId = resolvedEmployee.employee.id;
        const orderPoints = processOrderPoints({
          employeeId,
          orderItems: newOrder.items,
          orderId: newOrder.id,
          orderDate: newOrder.createdAt,
          onConvert: ({ points: convertedPoints, rupees, ledgerEntryId }) => {
            const employees = resolvedEmployee.employees || getEmployees();
            const employee = employees[resolvedEmployee.index ?? employees.findIndex((emp) => String(emp.id) === String(employeeId))];
            if (!employee) return null;
            ensureWalletFields(employee);
            const tx = recordWalletTransaction(employees, employee, {
              type: 'credit',
              reason: 'points-conversion',
              amount: rupees,
              metadata: { pointsConverted: convertedPoints, pointsLedgerId: ledgerEntryId },
            });
            saveEmployees(employees);
            return { walletTxId: tx?.id || null };
          },
        });
        appendAuditEntry({
          type: 'points:order-processed',
          actor: { type: 'system', source: 'order.create' },
          employeeId,
          orderId: newOrder.id,
          pointsEarned: orderPoints.earnEntry?.points || 0,
          streakBonuses: orderPoints.streakIssued,
          pointsConverted: orderPoints.conversion?.converted || 0,
        });
      } catch (pointsError) {
        console.warn('Failed to process streak points', pointsError);
      }
    }

    const extra = {};
    if (Array.isArray(req._excludedItems) && req._excludedItems.length > 0) {
      extra.excludedItems = req._excludedItems;
      extra.message = 'Some items were excluded as they are not available at this time.';
    }

    res.json({
      status: 'success',
      billingId,
      orderSummary,
      extra: Object.keys(extra).length ? extra : undefined,
      walletBalance: paymentMethod === 'wallet' ? paymentSummary.walletBalance : undefined
    });
  } catch (error) {
    console.error('Error placing order', error);
    res.status(500).json({ message: 'Error placing order' });
  }
});

app.post('/wallet/topup', (req, res) => {
  try {
    const { token, amount, provider = 'google-pay' } = req.body || {};
    const resolved = resolveEmployeeFromToken(token);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    if (value < MIN_WALLET_TOPUP) {
      return res.status(400).json({ message: `Minimum top-up is ₹${MIN_WALLET_TOPUP}` });
    }
    if (value > MAX_WALLET_TOPUP) {
      return res.status(400).json({ message: `Maximum top-up is ₹${MAX_WALLET_TOPUP}` });
    }
    const employees = resolved.employees || getEmployees();
    const employee = employees[resolved.index];
    ensureWalletFields(employee);
    const newBalance = formatCurrency(Number(employee.walletBalance || 0) + value);
    employee.walletBalance = newBalance;
    const tx = recordWalletTransaction(employees, employee, {
      type: 'credit',
      reason: 'wallet-topup',
      provider,
      amount: value
    });
    res.json({
      status: 'success',
      balance: newBalance,
      transaction: tx
    });
  } catch (error) {
    res.status(500).json({ message: 'Error processing wallet top-up' });
  }
});

app.post("/order/cancel/:id", (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const { userId, reason } = req.body || {};
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }
    let targetFoodCourt = getUserFoodCourt(req);
    let orders = getOrders(targetFoodCourt);
    let index = orders.findIndex((o) => Number(o.id) === orderId);
    if (index === -1) {
      for (const fc of FOOD_COURTS) {
        if (fc === targetFoodCourt) continue;
        const candidateOrders = getOrders(fc);
        const candidateIndex = candidateOrders.findIndex((o) => Number(o.id) === orderId);
        if (candidateIndex !== -1) {
          orders = candidateOrders;
          index = candidateIndex;
          targetFoodCourt = fc;
          break;
        }
      }
    }
    if (index === -1) {
      return res.status(404).json({ message: "Order not found" });
    }
    const order = orders[index];
    if (String(order.user || "").trim() !== String(userId).trim()) {
      return res.status(403).json({ message: "You can only cancel your own orders" });
    }
    if ((order.status || "").toLowerCase() === "cancelled") {
      return res.status(400).json({ status: "error", message: "Order is already cancelled." });
    }
    const outcome = evaluateScheduledCancellation(order);
    if (!outcome.allowed) {
      return res.status(400).json({
        status: "error",
        message: outcome.reason || "Cancellation not allowed",
        policy: outcome.policy || null,
        diffMinutes: outcome.diffMinutes ?? null
      });
    }

    let rawMenu;
    try {
      rawMenu = getMenu(targetFoodCourt);
    } catch {
      rawMenu = null;
    }

    const cancelRestocks = [];
    if (rawMenu && Array.isArray(order.items)) {
      for (const item of order.items) {
        const quantity = Number(item?.quantity || 0);
        const itemId = item?.id;
        if (!itemId || !quantity) continue;
        const before = getMenuItemSnapshot(rawMenu, order.shopId, itemId);
        restockInventory(rawMenu, order.shopId, itemId, quantity);
        const after = getMenuItemSnapshot(rawMenu, order.shopId, itemId);
        cancelRestocks.push({
          shopId: order.shopId,
          itemId,
          itemName: before?.name || after?.name || null,
          delta: quantity,
          previous: before?.inventory ?? null,
          current: after?.inventory ?? null,
        });
      }
      try {
        saveMenu(rawMenu, targetFoodCourt);
      } catch {}
    }

    const previousStatus = order.status;
    order.status = "cancelled";
    order.cancelledAt = new Date().toISOString();
    order.cancelledBy = userId;
    order.cancellationReason = reason || null;
    order.refundAmount = outcome.refundAmount;
    order.cancellationFee = outcome.feeAmount;
    order.cancellationPolicy = outcome.policy;
    order.cancellationRefundPercent = outcome.refundPercent;
    order.cancellationLeadMinutes = outcome.diffMinutes;

    try {
      if (order.payment?.method === 'wallet' && outcome.refundAmount > 0) {
        const employees = getEmployees();
        const employeeIndex = employees.findIndex((emp) => String(emp.mobile || '').toLowerCase() === String(order.user || '').toLowerCase());
        if (employeeIndex >= 0) {
          const employee = employees[employeeIndex];
          ensureWalletFields(employee);
          employee.walletBalance = formatCurrency(Number(employee.walletBalance || 0) + Number(outcome.refundAmount || 0));
          recordWalletTransaction(employees, employee, {
            type: 'credit',
            reason: 'order-refund',
            orderBillingId: order.billingId,
            amount: outcome.refundAmount
          });
          saveEmployees(employees);
          order.payment.walletBalanceAfterRefund = employee.walletBalance;
        }
      }
    } catch {}

    saveOrders(orders, targetFoodCourt);

    for (const adj of cancelRestocks) {
      emitInventoryAdjustedEvent({
        ...adj,
        orderId: order.id,
        billingId: order.billingId,
        reason: "order-cancelled-restock",
        actor: {
          type: "employee",
          userId,
        },
      });
    }

    emitOrderStatusEvent(order, {
      actor: {
        type: "employee",
        userId,
      },
      previousStatus: previousStatus,
      reason: reason || null,
    });

    res.json({
      status: "success",
      message: "Order cancelled successfully",
      refundAmount: outcome.refundAmount,
      feeAmount: outcome.feeAmount,
      policy: outcome.policy,
      order
    });
  } catch (error) {
    res.status(500).json({ message: "Error cancelling order" });
  }
});

// Get user's order history
/**
 * GET /orders/user/:userId
 * Public: List orders for a user.
 */
app.get("/orders/user/:userId", (req, res) => {
  try {
    const foodCourt = getUserFoodCourt(req);
    const orders = getOrders(foodCourt);
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
    const foodCourt = getUserFoodCourt(req);
    let favorites = getFavorites(foodCourt);

    const existingIndex = favorites.findIndex(f => f.userId === userId && f.itemId === itemId);

    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
      saveFavorites(favorites, foodCourt);
      res.json({ status: "removed", message: "Removed from favorites" });
    } else {
      favorites.push({ userId, itemId });
      saveFavorites(favorites, foodCourt);
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
    const foodCourt = getUserFoodCourt(req);
    const favorites = getFavorites(foodCourt);
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
      let targetFoodCourt = getUserFoodCourt(req);
      let orders = getOrders(targetFoodCourt);
      let order = orders.find(o => o.id === orderId);
      if (!order) {
        for (const fc of FOOD_COURTS) {
          if (fc === targetFoodCourt) continue;
          const candidateOrders = getOrders(fc);
          const candidate = candidateOrders.find(o => o.id === orderId);
          if (candidate) {
            orders = candidateOrders;
            order = candidate;
            targetFoodCourt = fc;
            break;
          }
        }
      }
      if (order) {
        order.rating = rating;
        order.feedback = feedback;
        saveOrders(orders, targetFoodCourt);
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

// Submit vendor grievance to admin
/**
 * POST /vendor/grievances
 * Vendor: Submit a grievance to admin.
 */
app.post("/vendor/grievances", authenticateVendor, (req, res) => {
  try {
    const { subject, description, priority = "medium" } = req.body || {};
    if (!subject || !description) {
      return res.status(400).json({ message: "Subject and description are required" });
    }
    const sanitizedPriority = ["low", "medium", "high"].includes(String(priority).toLowerCase())
      ? String(priority).toLowerCase()
      : "medium";

    const grievances = getVendorGrievances();
    const now = new Date().toISOString();
    const nextId = grievances.length > 0 ? Math.max(...grievances.map((g) => Number(g.id) || 0)) + 1 : 1;

    const record = {
      id: nextId,
      vendorId: req.vendor.vendorId,
      shopId: req.vendor.shopId,
      username: req.vendor.username,
      subject: String(subject).trim(),
      description: String(description).trim(),
      priority: sanitizedPriority,
      status: "pending",
      adminNote: "",
      createdAt: now,
      updatedAt: now,
    };

    grievances.unshift(record);
    saveVendorGrievances(grievances);

    res.json({ status: "success", message: "Grievance submitted", grievance: record });
  } catch (error) {
    res.status(500).json({ message: "Error submitting vendor grievance" });
  }
});

// List vendor grievances for vendor
/**
 * GET /vendor/grievances
 * Vendor: list grievances created by current vendor.
 */
app.get("/vendor/grievances", authenticateVendor, (req, res) => {
  try {
    const grievances = getVendorGrievances();
    const vendorId = req.vendor.vendorId;
    const filtered = grievances.filter((g) => Number(g.vendorId) === Number(vendorId));
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ message: "Error loading vendor grievances" });
  }
});

// Admin: list all vendor grievances
/**
 * GET /admin/vendor-grievances
 * Admin: view all vendor grievances.
 */
app.get("/admin/vendor-grievances", authenticateAdmin, (req, res) => {
  try {
    const grievances = getVendorGrievances();
    res.json(grievances);
  } catch (error) {
    res.status(500).json({ message: "Error fetching vendor grievances" });
  }
});

// Admin: update vendor grievance
/**
 * PATCH /admin/vendor-grievances/:id
 * Admin: update status or note.
 */
app.patch("/admin/vendor-grievances/:id", authenticateAdmin, (req, res) => {
  try {
    const grievances = getVendorGrievances();
    const grievanceId = Number(req.params.id);
    const index = grievances.findIndex((g) => Number(g.id) === grievanceId);
    if (index === -1) {
      return res.status(404).json({ message: "Grievance not found" });
    }

    const allowedStatus = new Set(["pending", "in_progress", "resolved"]);
    const updates = {};

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "status")) {
      const status = String(req.body.status || "").toLowerCase();
      if (allowedStatus.has(status)) {
        updates.status = status;
        if (status === "resolved") {
          updates.resolvedAt = new Date().toISOString();
        }
      }
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "adminNote")) {
      updates.adminNote = String(req.body.adminNote || "").trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    grievances[index] = {
      ...grievances[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    saveVendorGrievances(grievances);

    res.json({ status: "success", grievance: grievances[index] });
  } catch (error) {
    res.status(500).json({ message: "Error updating grievance" });
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
    const { username, password, foodCourt } = req.body || {};
    const targetCourt = FOOD_COURTS.includes(String(foodCourt)) ? String(foodCourt) : FC_DEFAULT;
    const vendors = getVendors(targetCourt);

    const vendor = vendors.find((v) => v.username === username);
    if (!vendor) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const match = await bcrypt.compare(password, vendor.passwordHash || "");
    const authenticated = Boolean(match);
    if (!authenticated) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const vendorRole = vendor.role || "vendor";
    const selectedFoodCourt = targetCourt;
    const token = jwt.sign(
      {
        vendorId: vendor.vendorId,
        shopId: vendor.shopId,
        username: vendor.username,
        role: vendorRole,
        foodCourt: selectedFoodCourt,
        permissions: Array.isArray(vendor.permissions) ? vendor.permissions : undefined,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    recordAuditEvent({
      actorType: "vendor",
      actorId: vendor.vendorId,
      shopId: vendor.shopId,
      vendorId: vendor.vendorId,
      action: "vendor.login.success",
      metadata: { username: vendor.username, foodCourt: selectedFoodCourt },
    });

    res.json({ token, role: vendorRole, foodCourt: selectedFoodCourt });
  } catch (error) {
    recordAuditEvent({
      actorType: "system",
      actorId: null,
      shopId: null,
      vendorId: null,
      action: "vendor.login.error",
      metadata: { message: error?.message || "unknown" },
    });
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
    const foodCourt = getVendorFoodCourt(req);
    const raw = getMenu(foodCourt);
    const vendorShopId = req.vendor.shopId;

    // Legacy structure: array of shops with items[]
    if (Array.isArray(raw)) {
      const shopIndex = raw.findIndex((shop) => String(shop.shopId) === String(vendorShopId));
      if (shopIndex === -1) {
        return res.status(404).json({ message: "Vendor shop menu not found" });
      }
      raw[shopIndex].items = updatedItems.map((it) => {
        const record = { ...it };
        if (Object.prototype.hasOwnProperty.call(record, 'calories')) {
          record.calories = normalizeCaloriesValue(record.calories);
        }
        return record;
      });
      saveMenu(raw, foodCourt);
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
      if (Object.prototype.hasOwnProperty.call(record, 'calories')) {
        record.calories = normalizeCaloriesValue(record.calories);
      }
      bySection.get(sec).push(record);
    }

    // Replace categories with grouped items
    shop.categories = Array.from(bySection.entries()).map(([categoryName, items]) => ({ categoryName, items }));
    saveMenu(raw, foodCourt);
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
    const orders = loadVendorOrders(req);
    const vendorShopId = req.vendor.shopId;
    const filteredOrders = orders.filter((order) => order.shopId === vendorShopId);
    res.json(filteredOrders);
  } catch (error) {
    res.status(500).json({ message: "Failed to load orders" });
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
    const foodCourt = getAdminFoodCourt(req);
    let combos = getCombos(foodCourt);
    if (shopId) combos = combos.filter(c => String(c.shopId) === shopId);
    if (activeOnly) combos = combos.filter(c => c.active !== false && c.hidden !== true);
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
    const bodyCourt = req.body?.foodCourt;
    const foodCourt = FOOD_COURTS.includes(String(bodyCourt)) ? String(bodyCourt) : getVendorFoodCourt(req);
    const all = getCombos(foodCourt);
    const rest = all.filter(c => String(c.shopId) !== String(req.vendor.shopId));
    const normalized = incoming.map(c => ({
      id: c.id || Date.now() + Math.random(),
      shopId: req.vendor.shopId,
      name: c.name || 'Combo',
      price: Number(c.price || 0),
      active: c.active !== false,
      hidden: c.hidden === true,
      availableStart: c.availableStart || null,
      availableEnd: c.availableEnd || null,
      components: Array.isArray(c.components) ? c.components : []
    }));
    saveCombos([...rest, ...normalized], foodCourt);
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
    const requestedCourt = req.query.foodCourt ? String(req.query.foodCourt) : null;
    const foodCourt = FOOD_COURTS.includes(requestedCourt) ? requestedCourt : getUserFoodCourt(req);
    const offers = getOffers(foodCourt).filter(o => {
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
    const bodyCourt = req.body?.foodCourt;
    const foodCourt = FOOD_COURTS.includes(String(bodyCourt)) ? String(bodyCourt) : getVendorFoodCourt(req);
    const all = getOffers(foodCourt);
    const rest = all.filter(o => String(o.shopId) !== String(req.vendor.shopId));
    const normalized = incoming.map(o => normalizeOfferInputForStorage(o, req.vendor.shopId));
    saveOffers([...rest, ...normalized], foodCourt);
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ message: 'Failed to save offers' });
  }
});

/**
 * POST /offers/preview
 * Public: Evaluate active offers for a hypothetical cart without placing an order.
 * Body: { shopId, items, scheduledTime }
 */
app.post('/offers/preview', (req, res) => {
  try {
    const { shopId, items, scheduledTime } = req.body || {};
    if (!shopId || !Array.isArray(items)) {
      return res.status(400).json({ status: 'error', message: 'shopId and items are required' });
    }

    const foodCourt = getUserFoodCourt(req);
    const rawMenu = getMenu(foodCourt);
    const normalizedShops = normalizeMenuShops(rawMenu);
    const shopNorm = normalizedShops.find((s) => String(s.shopId) === String(shopId));
    if (!shopNorm) {
      return res.status(404).json({ status: 'error', message: 'Shop not found' });
    }

    shopNorm.items = Array.isArray(shopNorm.items) ? shopNorm.items : [];
    const itemLookup = new Map((shopNorm.items || []).map((i) => [Number(i.id), i]));
    const sectionLookup = new Map((shopNorm.items || []).map((i) => [Number(i.id), i.section || 'All Items']));

    const combos = getCombos(foodCourt);
    const shopCombos = combos.filter((c) => String(c.shopId) === String(shopId) && c.active !== false);

    const flatItems = [];
    const comboCounts = new Map();

    for (const entry of items) {
      if (!entry) continue;
      const quantity = Math.max(0, Number(entry.quantity || 0));
      if (quantity <= 0) continue;

      if (entry.comboId != null) {
        const combo = shopCombos.find((c) => String(c.id) === String(entry.comboId));
        if (!combo) continue;
        comboCounts.set(String(entry.comboId), (comboCounts.get(String(entry.comboId)) || 0) + quantity);
        const components = Array.isArray(combo.components) ? combo.components : [];
        for (const comp of components) {
          if (!comp || comp.itemId == null) continue;
          const compId = Number(comp.itemId);
          const compQty = Math.max(1, Number(comp.quantity || 1)) * quantity;
          const ref = itemLookup.get(compId) || {};
          const price = comp.overridePrice != null ? Number(comp.overridePrice) : Number(ref.price || 0);
          flatItems.push({
            id: compId,
            name: comp.name || ref.name || `Item ${compId}`,
            price,
            quantity: compQty,
            option: comp.option || null,
            prepTime: comp.prepTime || ref.prepTime || 5
          });
        }
        continue;
      }

      const itemId = Number(entry.id);
      if (!Number.isFinite(itemId)) continue;
      const ref = itemLookup.get(itemId) || {};
      const price = entry.price != null ? Number(entry.price) : Number(ref.price || 0);
      flatItems.push({
        id: itemId,
        name: entry.name || ref.name || `Item ${itemId}`,
        price,
        quantity,
        option: entry.option || null,
        prepTime: entry.prepTime || ref.prepTime || 5
      });
    }

    if (flatItems.length === 0) {
      return res.json({ status: 'ok', subtotalBeforeDiscount: 0, discountTotal: 0, totalPayable: 0, appliedOffers: [], extraItems: [] });
    }

    const now = new Date();
    const evaluationDate = scheduledTime ? new Date(scheduledTime) : now;
    const offers = getOffers(foodCourt);
    const activeOffers = offers.filter((o) => {
      if (String(o.shopId) !== String(shopId)) return false;
      const start = o.start ? new Date(o.start) : null;
      const end = o.end ? new Date(o.end) : null;
      if (start && evaluationDate < start) return false;
      if (end && evaluationDate > end) return false;
      return o.active !== false;
    });

    const evaluation = evaluateOffers({
      offers: activeOffers,
      flatItems,
      sectionLookup,
      itemLookup,
      comboCounts,
      evaluationDate,
      now
    });

    const subtotalBeforeDiscount = evaluation.subtotalBeforeDiscount;
    const discountTotal = evaluation.discountTotal;
    const totalPayable = Math.max(0, subtotalBeforeDiscount - discountTotal);

    return res.json({
      status: 'ok',
      subtotalBeforeDiscount,
      discountTotal,
      totalPayable,
      appliedOffers: evaluation.appliedOffers,
      extraItems: evaluation.extraItems,
      evaluationDate: evaluationDate.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Error previewing offers' });
  }
});

/**
 * GET /offers?shopId=
 * Public: List all offers for a shop (management UI read).
 */
app.get('/offers', (req, res) => {
  try {
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    const foodCourt = getAdminFoodCourt(req);
    let offers = getOffers(foodCourt);
    if (shopId) offers = offers.filter(o => String(o.shopId) === shopId);
    res.json(offers);
  } catch (e) {
    res.status(500).json({ message: 'Failed to fetch offers' });
  }
});

/**
 * POST /order/ready/:id
 * Vendor: Mark an order as ready; records readyAt timestamp.
 */
app.post("/order/ready/:id", authenticateVendor, (req, res) => {
  try {
    const orders = loadVendorOrders(req);
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    const previousStatus = order.status;
    order.status = "ready";
    order.readyAt = new Date().toISOString();
    saveVendorOrders(req, orders);
    emitOrderStatusEvent(order, {
      vendor: req.vendor,
      previousStatus,
      actor: {
        type: "vendor",
        vendorId: req.vendor.vendorId,
        shopId: req.vendor.shopId,
        username: req.vendor.username,
      },
    });
    res.json({ status: "success", message: `Order ${orderId} marked ready` });
  } catch (error) {
    res.status(500).json({ message: "Error marking order ready" });
  }
});

// Mark order as picked/completed
/**
 * POST /order/picked/:id
 * Vendor: Mark a ready order as picked; moves it to completed tab.
 */
app.post("/order/picked/:id", authenticateVendor, (req, res) => {
  try {
    const orders = loadVendorOrders(req);
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    if (order.status !== "ready") {
      return res.status(400).json({ message: "Only ready orders can be marked as picked" });
    }

    const now = new Date().toISOString();
    const previousStatus = order.status;
    order.status = "completed";
    order.pickedAt = now;
    order.completedAt = now;
    if (!order.readyAt) {
      order.readyAt = now;
    }

    saveVendorOrders(req, orders);
    emitOrderStatusEvent(order, {
      vendor: req.vendor,
      previousStatus,
      actor: {
        type: "vendor",
        vendorId: req.vendor.vendorId,
        shopId: req.vendor.shopId,
        username: req.vendor.username,
      },
    });
    res.json({ status: "success", message: `Order ${orderId} marked completed` });
  } catch (error) {
    res.status(500).json({ message: "Error marking order picked" });
  }
});

// ========== SOS ALERT ROUTES ==========

/**
 * POST /sos/trigger
 * Vendor/Admin: Trigger a global SOS alert.
 */
app.post("/sos/trigger", (req, res) => {
  try {
    const { role = "unknown", actorName = "Unknown", message = "Emergency alert triggered" } = req.body || {};
    const state = getSosState();
    const now = new Date().toISOString();
    const eventId = `sos-${Date.now()}`;

    const entry = {
      id: eventId,
      triggeredAt: now,
      triggeredBy: actorName,
      role,
      message,
    };

    state.active = true;
    state.lastTriggeredAt = now;
    state.lastTriggeredBy = actorName;
    state.message = message;
    state.currentEventId = eventId;
    state.events = [entry, ...(Array.isArray(state.events) ? state.events : [])].slice(0, 50);

    saveSosState(state);
    broadcastSosAlert(state);

    res.json({ status: "success", message: "SOS alert triggered", state });
  } catch (error) {
    res.status(500).json({ message: "Error triggering SOS alert" });
  }
});

/**
 * POST /sos/resolve
 * Vendor/Admin: Resolve the current SOS alert.
 */
app.post("/sos/resolve", (req, res) => {
  try {
    const state = getSosState();
    if (!state.active) {
      return res.json({ status: "success", message: "No active SOS to resolve", state });
    }

    const { actorName = "Unknown", note = "" } = req.body || {};
    const now = new Date().toISOString();
    const entry = {
      id: state.currentEventId,
      resolvedAt: now,
      resolvedBy: actorName,
      note,
    };

    state.active = false;
    state.lastResolvedAt = now;
    state.lastResolvedBy = actorName;
    state.message = null;
    state.currentEventId = null;
    state.events = [entry, ...(Array.isArray(state.events) ? state.events : [])].slice(0, 50);

    saveSosState(state);
    res.json({ status: "success", message: "SOS alert resolved", state });
  } catch (error) {
    res.status(500).json({ message: "Error resolving SOS alert" });
  }
});

/**
 * GET /sos/status
 * Public: Fetch current SOS status for clients to react.
 */
app.get("/sos/status", (req, res) => {
  try {
    const state = getSosState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ message: "Error fetching SOS status" });
  }
});

// Admin: update vendor credentials
/**
 * PUT /admin/vendor/:id
 * Admin: Update a vendor's username or password.
 * @body {username?:string,password?:string}
 */
app.put("/admin/vendor/:id", authenticateAdmin, (req, res) => {
  try {
    const vendorId = Number(req.params.id);
    if (!Number.isFinite(vendorId)) {
      return res.status(400).json({ message: "Invalid vendor ID" });
    }
    const foodCourt = getAdminFoodCourt(req);
    const vendors = getVendors(foodCourt);
    const index = vendors.findIndex((v) => v.vendorId === vendorId);
    if (index === -1) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const { username, password, shopName, shopId, email } = req.body || {};
    const vendor = vendors[index];
    const originalShopId = vendor.shopId != null ? Number(vendor.shopId) : null;

    const trimmedUsername = username != null ? String(username).trim() : null;
    const trimmedShopName = shopName != null ? String(shopName).trim() : null;
    const trimmedEmail = email != null ? String(email).trim() : null;

    if (trimmedUsername) {
      vendor.username = trimmedUsername;
    }
    if (password != null && password !== "") {
      vendor.passwordHash = bcrypt.hashSync(String(password), 10);
    }

    let newShopIdValue = originalShopId;
    if (shopId != null && shopId !== '') {
      const candidateShopId = Number(shopId);
      if (!Number.isFinite(candidateShopId) || candidateShopId <= 0) {
        return res.status(400).json({ message: 'Invalid shopId' });
      }
      const vendorsWithoutCurrent = vendors.filter((v) => v.vendorId !== vendorId);
      const shopIdConflict = vendorsWithoutCurrent.some((v) => Number(v.shopId) === candidateShopId);
      if (shopIdConflict) {
        return res.status(409).json({ message: 'Shop ID already in use by another vendor' });
      }
      vendor.shopId = candidateShopId;
      newShopIdValue = candidateShopId;
    }

    if (trimmedShopName) {
      vendor.shopName = trimmedShopName;
    }
    if (trimmedEmail !== null) {
      if (trimmedEmail) {
        vendor.email = trimmedEmail;
      } else {
        delete vendor.email;
      }
    }

    saveVendors(vendors, foodCourt);

    const rawMenu = getMenu(foodCourt);
    const updateShopEntry = (menuData) => {
      const applyUpdate = (shop) => {
        if (!shop) return shop;
        if (Number(shop.shopId) !== Number(originalShopId)) {
          return shop;
        }
        const updatedShop = { ...shop };
        if (newShopIdValue != null) updatedShop.shopId = newShopIdValue;
        if (trimmedShopName) updatedShop.shopName = trimmedShopName;
        if (trimmedEmail !== null) {
          if (trimmedEmail) {
            updatedShop.contactEmail = trimmedEmail;
          } else {
            delete updatedShop.contactEmail;
          }
        }
        return updatedShop;
      };

      if (Array.isArray(menuData)) {
        return menuData.map(applyUpdate);
      }
      if (menuData && typeof menuData === 'object') {
        const next = { ...menuData };
        if (Array.isArray(next.shops)) {
          next.shops = next.shops.map(applyUpdate);
        }
        return next;
      }
      return menuData;
    };

    const updatedMenu = updateShopEntry(rawMenu);
    if (updatedMenu !== rawMenu) {
      saveMenu(updatedMenu, foodCourt);
    }

    invalidateVendorDirectoryCache(foodCourt);

    const sanitizedVendor = {
      vendorId: vendor.vendorId,
      id: vendor.vendorId,
      shopId: vendor.shopId,
      username: vendor.username,
      email: vendor.email || null,
      shopName: vendor.shopName || null,
    };

    res.json({ status: "success", message: "Vendor updated successfully", vendor: sanitizedVendor });
  } catch (error) {
    res.status(500).json({ message: "Error updating vendor" });
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
    const orders = loadVendorOrders(req);
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    const hadPrepTime = Object.prototype.hasOwnProperty.call(order, "prepTime");
    const previousPrepMinutesRaw = Number(order.prepTime);
    const previousPrepMinutes = Number.isFinite(previousPrepMinutesRaw) ? previousPrepMinutesRaw : 0;
    const hadEstimatedReadyTime = Object.prototype.hasOwnProperty.call(order, "estimatedReadyTime");
    const previousEta = order.estimatedReadyTime || null;

    if (!Object.prototype.hasOwnProperty.call(order, "_originalPrepTimeDefined")) {
      order._originalPrepTimeDefined = hadPrepTime;
    }
    if (!Object.prototype.hasOwnProperty.call(order, "_originalEstimatedReadyTimeDefined")) {
      order._originalEstimatedReadyTimeDefined = hadEstimatedReadyTime;
    }
    if (!Object.prototype.hasOwnProperty.call(order, "originalPrepTime") && hadPrepTime) {
      order.originalPrepTime = previousPrepMinutes;
    }
    if (!Object.prototype.hasOwnProperty.call(order, "originalEstimatedReadyTime") && hadEstimatedReadyTime) {
      order.originalEstimatedReadyTime = previousEta;
    }

    order.prepTime = previousPrepMinutes + addMinutes;
    const prevEta = order.estimatedReadyTime ? new Date(order.estimatedReadyTime).getTime() : Date.now();
    const baseTime = Math.max(prevEta, Date.now());
    order.estimatedReadyTime = new Date(baseTime + addMinutes * 60000).toISOString();
    order.etaExtendedAt = new Date().toISOString();
    order.etaExtensionMinutes = (order.etaExtensionMinutes || 0) + addMinutes;

    saveVendorOrders(req, orders);
    emitOrderPrepExtendedEvent(order, {
      vendor: req.vendor,
      addMinutes,
      previousPrepMinutes,
      previousEta,
      actor: {
        type: "vendor",
        vendorId: req.vendor.vendorId,
        shopId: req.vendor.shopId,
        username: req.vendor.username,
      },
    });
    res.json({ status: "success", message: "Preparation time extended", order });
  } catch (error) {
    res.status(500).json({ message: "Error extending preparation time" });
  }
});

/**
 * POST /order/extend-reset/:id
 * Vendor: Revoke any previously granted prep-time extensions for an order.
 */
app.post("/order/extend-reset/:id", authenticateVendor, (req, res) => {
  try {
    const orders = loadVendorOrders(req);
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    const extensionMinutes = Number(order.etaExtensionMinutes || 0);
    if (!extensionMinutes) {
      return res.status(400).json({ message: "No prep-time extension to revoke" });
    }

    const currentPrep = Number(order.prepTime || 0);
    const hadPrepOriginally = order._originalPrepTimeDefined === true;
    const hadEtaOriginally = order._originalEstimatedReadyTimeDefined === true;
    const extendedEta = order.estimatedReadyTime || null;

    if (hadPrepOriginally) {
      const restoredPrepValue = Number(order.originalPrepTime);
      order.prepTime = Number.isFinite(restoredPrepValue) ? restoredPrepValue : 0;
    } else {
      delete order.prepTime;
    }

    if (hadEtaOriginally) {
      order.estimatedReadyTime = order.originalEstimatedReadyTime || null;
    } else {
      delete order.estimatedReadyTime;
    }

    if (!hadEtaOriginally && !Object.prototype.hasOwnProperty.call(order, "estimatedReadyTime")) {
      const fallbackEtaMs = Date.parse(extendedEta);
      if (Number.isFinite(fallbackEtaMs)) {
        order.estimatedReadyTime = new Date(fallbackEtaMs - extensionMinutes * 60000).toISOString();
      }
    }

    order.etaExtensionMinutes = 0;
    order.etaExtendedAt = null;
    delete order.originalPrepTime;
    delete order.originalEstimatedReadyTime;
    delete order._originalPrepTimeDefined;
    delete order._originalEstimatedReadyTimeDefined;

    saveVendorOrders(req, orders);
    emitOrderPrepExtendedEvent(order, {
      vendor: req.vendor,
      addMinutes: -extensionMinutes,
      previousPrepMinutes: currentPrep,
      previousEta: extendedEta,
      actor: {
        type: "vendor",
        vendorId: req.vendor.vendorId,
        shopId: req.vendor.shopId,
        username: req.vendor.username,
      },
    });

    res.json({ status: "success", message: "Prep-time extension revoked", order });
  } catch (error) {
    res.status(500).json({ message: "Error revoking preparation time extension" });
  }
});

// Employee concerns endpoints
const EMPLOYEE_CONCERN_CATEGORIES = new Map([
  ["cleanliness", "Cleanliness"],
  ["food_quality", "Food / Taste"],
  ["vendor_service", "Vendor Service"],
  ["billing_issue", "Billing"],
  ["other", "Other"],
]);

const EMPLOYEE_CONCERN_STATUSES = new Set(["pending", "in_progress", "resolved"]);

app.post("/employee/concerns", authenticateEmployee, (req, res) => {
  try {
    const employee = req.employee;
    if (!employee || employee.id == null) {
      return res.status(401).json({ message: "Invalid employee session" });
    }

    const { category = "other", subject = "", description = "", location = "" } = req.body || {};

    const trimmedSubject = String(subject || "").trim();
    const trimmedDescription = String(description || "").trim();
    if (trimmedDescription.length < 10) {
      return res.status(400).json({ message: "Description should be at least 10 characters" });
    }

    const categoryKey = String(category || "other").toLowerCase();
    const resolvedCategory = EMPLOYEE_CONCERN_CATEGORIES.has(categoryKey) ? categoryKey : "other";

    const concerns = getEmployeeConcerns();
    const now = new Date().toISOString();
    const nextId = concerns.length > 0 ? Math.max(...concerns.map((c) => Number(c.id) || 0)) + 1 : 1;

    const record = {
      id: nextId,
      employeeId: Number(employee.id),
      username: employee.username || employee.email || employee.mobile || null,
      department: employee.department || null,
      category: resolvedCategory,
      subject: trimmedSubject || EMPLOYEE_CONCERN_CATEGORIES.get(resolvedCategory) || "Employee Concern",
      description: trimmedDescription,
      location: String(location || "").trim() || null,
      status: "pending",
      adminNote: "",
      createdAt: now,
      updatedAt: now,
    };

    concerns.unshift(record);
    saveEmployeeConcerns(concerns);

    res.json({ status: "success", concern: record });
  } catch (error) {
    console.error("Error submitting employee concern", error);
    res.status(500).json({ message: "Error submitting employee concern" });
  }
});

app.get("/employee/concerns", authenticateEmployee, (req, res) => {
  try {
    const employee = req.employee;
    if (!employee || employee.id == null) {
      return res.status(401).json({ message: "Invalid employee session" });
    }
    const concerns = getEmployeeConcerns().filter((entry) => Number(entry.employeeId) === Number(employee.id));
    res.json(concerns);
  } catch (error) {
    console.error("Error loading employee concerns", error);
    res.status(500).json({ message: "Error loading concerns" });
  }
});

app.get("/admin/employee-concerns", authenticateAdmin, (req, res) => {
  try {
    const concerns = getEmployeeConcerns();
    res.json(concerns);
  } catch (error) {
    console.error("Error fetching employee concerns", error);
    res.status(500).json({ message: "Error fetching employee concerns" });
  }
});

app.patch("/admin/employee-concerns/:id", authenticateAdmin, (req, res) => {
  try {
    const concerns = getEmployeeConcerns();
    const concernId = Number(req.params.id);
    const index = concerns.findIndex((c) => Number(c.id) === concernId);
    if (index === -1) {
      return res.status(404).json({ message: "Concern not found" });
    }

    const updates = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "status")) {
      const status = String(req.body.status || "").toLowerCase();
      if (EMPLOYEE_CONCERN_STATUSES.has(status)) {
        updates.status = status;
        if (status === "resolved") {
          updates.resolvedAt = new Date().toISOString();
        }
      }
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "adminNote")) {
      updates.adminNote = String(req.body.adminNote || "").trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    concerns[index] = {
      ...concerns[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    saveEmployeeConcerns(concerns);

    res.json({ status: "success", concern: concerns[index] });
  } catch (error) {
    console.error("Error updating employee concern", error);
    res.status(500).json({ message: "Error updating employee concern" });
  }
});

app.get("/admin/employees", authenticateAdmin, (req, res) => {
  try {
    const employees = getEmployees();
    const sanitized = employees.map((employee) => sanitizeEmployeeRecord(employee)).filter(Boolean);
    res.json({ status: "ok", employees: sanitized });
  } catch (error) {
    console.error("Error listing employees", error);
    res.status(500).json({ message: "Failed to load employees" });
  }
});

app.delete("/admin/employees/:id", authenticateAdmin, (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (!Number.isFinite(employeeId)) {
      return res.status(400).json({ message: "Invalid employee id" });
    }

    const { removed } = deleteEmployeeById(employeeId);
    if (!removed) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.json({ status: "success", message: "Employee removed" });
  } catch (error) {
    console.error("Error deleting employee", error);
    res.status(500).json({ message: "Failed to delete employee" });
  }
});

// ========== REAL-TIME ANALYTICS ENDPOINTS ==========
app.get("/analytics/summary", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const summary = await realtimeAnalyticsService.getSummary(req.vendor.shopId);
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "analytics.summary.read",
    metadata: {},
  });
  res.json(summary);
}));

app.get("/analytics/timeseries", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const granularity = String(req.query.granularity || "hour").toLowerCase();
  const response = await realtimeAnalyticsService.getTimeSeries(req.vendor.shopId, granularity);
  res.json(response);
}));

app.get("/analytics/forecast", authenticateVendor, requirePermission("analytics:read"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const forecast = await generateForecast({
    shopId: req.vendor.shopId,
    vendorId: req.vendor.vendorId,
  });
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "analytics.forecast.read",
    metadata: { horizonDays: forecast.horizonDays },
  });
  res.json(forecast);
}));

// ========== PROCUREMENT ENDPOINTS ==========
app.get("/procurement/templates", authenticateVendor, requirePermission("analytics:read"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const templates = listTemplates(req.vendor.vendorId);
  res.json({ templates });
}));

app.post("/procurement/templates", authenticateVendor, requirePermission("procurement:manage"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const body = req.body || {};
  const title = String(body.title || "").trim();
  if (!title) {
    return res.status(400).json({ message: "title is required" });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  const template = {
    id: generateTemplateId(),
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    title,
    description: String(body.description || "").trim(),
    items: items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName || null,
      quantity: Number(item.quantity || 0),
      unit: item.unit || null,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveTemplate(template);
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "procurement.template.create",
    metadata: { templateId: template.id },
  });
  res.status(201).json({ template });
}));

app.put("/procurement/templates/:id", authenticateVendor, requirePermission("procurement:manage"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const templateId = req.params.id;
  const existing = listTemplates(req.vendor.vendorId).find((tpl) => tpl.id === templateId);
  if (!existing) {
    return res.status(404).json({ message: "Template not found" });
  }
  const body = req.body || {};
  const updated = {
    ...existing,
    title: String(body.title || existing.title || "").trim() || existing.title,
    description: String(body.description || existing.description || "").trim(),
    items: Array.isArray(body.items)
      ? body.items.map((item) => ({
          itemId: item.itemId,
          itemName: item.itemName || null,
          quantity: Number(item.quantity || 0),
          unit: item.unit || null,
        }))
      : existing.items,
    updatedAt: new Date().toISOString(),
  };
  saveTemplate(updated);
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "procurement.template.update",
    metadata: { templateId },
  });
  res.json({ template: updated });
}));

app.delete("/procurement/templates/:id", authenticateVendor, requirePermission("procurement:manage"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const templateId = req.params.id;
  const templates = listTemplates(req.vendor.vendorId);
  const exists = templates.some((tpl) => tpl.id === templateId);
  if (!exists) {
    return res.status(404).json({ message: "Template not found" });
  }
  deleteTemplate(req.vendor.vendorId, templateId);
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "procurement.template.delete",
    metadata: { templateId },
  });
  res.json({ status: "success" });
}));

app.get("/procurement/orders", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const orders = listOrders(req.vendor.vendorId);
  res.json({ orders });
}));

app.post("/procurement/orders", authenticateVendor, requirePermission("procurement:manage"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const body = req.body || {};
  const supplier = String(body.supplier || "").trim();
  const dueDate = body.dueDate ? new Date(body.dueDate).toISOString() : null;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return res.status(400).json({ message: "At least one item is required" });
  }

  const order = {
    id: `po-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    supplier,
    dueDate,
    notes: String(body.notes || "").trim(),
    items: items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName || null,
      quantity: Number(item.quantity || 0),
      unit: item.unit || null,
      source: item.source || null,
    })),
    recommendationsSource: body.recommendationsSource || null,
    createdAt: new Date().toISOString(),
  };
  saveOrder(order);
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "procurement.order.create",
    metadata: { orderId: order.id, supplier: supplier || null },
  });
  res.status(201).json({ order });
}));

app.post("/procurement/tasks/generate", authenticateVendor, requirePermission("procurement:manage"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const task = await generateProcurementTask({
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
  });
  if (!task) {
    return res.status(204).send();
  }
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "procurement.task.generate",
    metadata: { taskId: task.id, itemCount: task.items.length },
  });
  res.status(201).json({ task });
}));

app.get("/procurement/tasks", authenticateVendor, requirePermission("procurement:manage"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const tasks = listProcurementTasks(req.vendor.vendorId);
  res.json({ tasks });
}));

app.post("/procurement/tasks/:taskId/approve", authenticateVendor, requirePermission("procurement:manage"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const taskId = req.params.taskId;
  const task = getTaskById(taskId);
  if (!task || String(task.vendorId) !== String(req.vendor.vendorId)) {
    return res.status(404).json({ message: "Task not found" });
  }
  const comment = String(req.body.comment || "").trim() || null;
  const updated = updateTaskStatus(taskId, {
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: req.vendor.vendorId,
    approvalComment: comment,
  });
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "procurement.task.approve",
    metadata: { taskId, comment },
  });
  res.json({ task: updated });
}));
app.get("/analytics/inventory", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const inventory = await realtimeAnalyticsService.getInventory(req.vendor.shopId);
  res.json(inventory);
}));

app.get("/analytics/export/current", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const format = String(req.query.format || "json").toLowerCase();
  if (req.vendor.shopId == null) {
    return res.status(404).json({ message: "Vendor shop not found" });
  }
  const { contentType, payload } = await realtimeAnalyticsService.exportCurrent(req.vendor.shopId, format);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename=analytics-${req.vendor.shopId}.${format === "csv" ? "csv" : "json"}`);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "analytics.export.download",
    metadata: { format },
  });
  res.send(payload);
}));

// Historical summary (fallback)
app.get("/analytics", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const summary = await analyticsQueryService.getVendorSummary({
    shopId: req.vendor.shopId,
    period: req.query.period,
    granularity: req.query.granularity,
  });
  res.json(summary);
}));

// ========== HISTORICAL IMPORT/ARCHIVE ==========
app.post("/analytics/import", authenticateVendor, requirePermission("analytics:write"), upload.single("file"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  try {
    const result = await analyticsImportService.importFile({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      actor: req.vendor,
    });
    recordAuditEvent({
      actorType: "vendor",
      actorId: req.vendor.vendorId,
      vendorId: req.vendor.vendorId,
      shopId: req.vendor.shopId,
      action: "analytics.import.upload",
      metadata: { filename: req.file.originalname, size: req.file.size },
    });
    res.json(result);
  } catch (error) {
    console.error("Error importing analytics data", error);
    res.status(400).json({ message: error.message || "Import failed" });
  }
}));

app.get("/data/archive/:vendorId/:period", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const vendorId = String(req.params.vendorId);
  if (String(req.vendor.vendorId) !== vendorId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const period = String(req.params.period);
  const filePath = path.join(ARCHIVE_ROOT, vendorId, `${period}.parquet`);
  const exists = fs.existsSync(filePath);
  if (!exists) {
    return res.status(404).json({ message: "Archive not found" });
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename=${period}.parquet`);
  const metadata = loadMetadata();
  const checksum = metadata?.[vendorId]?.[period]?.checksum || null;
  if (checksum) {
    res.setHeader("X-Archive-Checksum", checksum);
  }
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "analytics.archive.download",
    metadata: { period },
  });
  fs.createReadStream(filePath).pipe(res);
}));

app.post("/data/archive/materialize", authenticateVendor, requirePermission("analytics:write"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const specificVendorId = req.vendor.vendorId;
  const report = await runArchiveJob({ specificVendorId });
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "archive.materialize",
    metadata: report,
  });
  res.json(report);
}));

app.get("/data/archive/catalog", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const metadata = loadMetadata();
  const vendorEntries = metadata[String(req.vendor.vendorId)] || {};
  res.json({ vendorId: req.vendor.vendorId, entries: vendorEntries });
}));

// Vendor headcount management
app.get("/analytics/headcount", authenticateVendor, asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const entries = getVendorHeadcountEntries(req.vendor.vendorId);
  res.json({ entries });
}));

app.post("/analytics/headcount", authenticateVendor, requirePermission("analytics:write"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const headcount = Number(req.body.headcount);
  if (!Number.isFinite(headcount) || headcount <= 0) {
    return res.status(400).json({ message: "headcount must be a positive number" });
  }
  const record = addHeadcountEntry({
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    headcount,
    source: "manual",
  });
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "analytics.headcount.update",
    metadata: { headcount },
  });
  res.json({ status: "success", record });
}));

// Headcount integration hook
app.post("/analytics/headcount/integrations", asyncHandler(async (req, res) => {
  const token = String(req.headers["x-analytics-integration-token"] || "");
  const vendor = decodeVendorToken(token);
  if (!vendor || vendor.vendorId == null) {
    return res.status(401).json({ message: "Invalid integration token" });
  }
  const headcount = Number(req.body.headcount);
  if (!Number.isFinite(headcount) || headcount <= 0) {
    return res.status(400).json({ message: "headcount must be a positive number" });
  }
  addHeadcountEntry({
    vendorId: vendor.vendorId,
    shopId: vendor.shopId,
    headcount,
    source: req.body.source || "integration",
  });
  recordAuditEvent({
    actorType: "integration",
    actorId: vendor.vendorId,
    vendorId: vendor.vendorId,
    shopId: vendor.shopId,
    action: "analytics.headcount.integration",
    metadata: { headcount },
  });
  res.json({ status: "success" });
}));

// Forecasting & recommendations
app.get("/analytics/recommendations", authenticateVendor, requirePermission("analytics:read"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  const response = await forecastingService.getRecommendations({
    shopId: req.vendor.shopId,
    vendorId: req.vendor.vendorId,
  });
  recordAuditEvent({
    actorType: "vendor",
    actorId: req.vendor.vendorId,
    vendorId: req.vendor.vendorId,
    shopId: req.vendor.shopId,
    action: "analytics.recommendations.read",
    metadata: { lookbackDays: response.lookbackDays },
  });
  res.json(response);
}));

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

if (process.env.RUN_SERVER !== 'false') {
  server.listen(PORT, async () => {
    console.log(`Backend running on http://localhost:${PORT}`);
    console.log(`Images served from: http://localhost:${PORT}/images/`);

    try {
      if (analyticsConfig.ANALYTICS_INGESTOR_ENABLED) {
        await analyticsIngestor.start();
        console.log("Analytics ingestor started");
      } else {
        console.log("Analytics ingestor disabled via configuration");
      }
    } catch (error) {
      console.error("Failed to start analytics ingestor", error);
    }

    try {
      await realtimeAnalyticsService.start();
      console.log("Realtime analytics service started");
    } catch (error) {
      console.error("Failed to start realtime analytics", error);
    }

    try {
      await bootstrapAnalyticsFromOrders();
      console.log("Analytics bootstrap completed");
    } catch (error) {
      console.error("Failed to bootstrap historical analytics", error);
    }

    try {
      startNightlyJobs();
      console.log("Nightly jobs scheduled");
    } catch (error) {
      console.error("Failed to start nightly jobs", error);
    }
  });
}

const shutdown = async () => {
  stopNightlyJobs();
  try {
    await realtimeAnalyticsService.stop();
    console.log("Realtime analytics service stopped");
  } catch (error) {
    console.error("Failed to stop realtime analytics service", error);
  }
  try {
    if (analyticsConfig.ANALYTICS_INGESTOR_ENABLED) {
      await analyticsIngestor.stop?.();
      console.log("Analytics ingestor stopped");
    }
  } catch (error) {
    console.error("Failed to stop analytics ingestor", error);
  }

  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.post("/analytics/import", authenticateVendor, upload.single("file"), asyncHandler(async (req, res) => {
  assertAnalyticsAccess(req);
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  try {
    const result = await analyticsImportService.importFile({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      actor: req.vendor,
    });
    res.json(result);
  } catch (error) {
    console.error("Error importing analytics data", error);
    res.status(400).json({ message: error.message || "Import failed" });
  }
}));

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token") || req.headers["sec-websocket-protocol"]; // allow auth via query or protocol
  const vendor = decodeVendorToken(token || "");
  if (!vendor || vendor.shopId == null) {
    ws.close(4401, "Unauthorized");
    return;
  }
  realtimeAnalyticsService.registerWebSocket(vendor.shopId, ws);
  const snapshot = await realtimeAnalyticsService.getSummary(vendor.shopId);
  ws.send(JSON.stringify({ type: "analytics:init", data: snapshot }));
});

module.exports = { app, server };