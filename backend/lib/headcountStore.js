const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "data", "vendor_headcount.json");

const ensureStore = () => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
};

const readStore = () => {
  ensureStore();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw || "[]");
  } catch (error) {
    console.error("[HeadcountStore] Failed to read store", error);
    return [];
  }
};

const writeStore = (data) => {
  ensureStore();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const normalizeVendorId = (vendorId) => String(vendorId);

const getVendorRecord = (vendorId) => {
  const store = readStore();
  const key = normalizeVendorId(vendorId);
  return store.find((entry) => normalizeVendorId(entry.vendorId) === key) || null;
};

const upsertVendorRecord = (record) => {
  const store = readStore();
  const key = normalizeVendorId(record.vendorId);
  const idx = store.findIndex((entry) => normalizeVendorId(entry.vendorId) === key);
  if (idx >= 0) {
    store[idx] = record;
  } else {
    store.push(record);
  }
  writeStore(store);
};

const addHeadcountEntry = ({ vendorId, shopId, headcount, source = "manual" }) => {
  const safeHeadcount = Number(headcount);
  if (!Number.isFinite(safeHeadcount) || safeHeadcount <= 0) {
    throw new Error("headcount must be a positive number");
  }
  const record = getVendorRecord(vendorId) || {
    vendorId,
    shopId,
    entries: [],
  };
  record.shopId = shopId;
  record.entries = Array.isArray(record.entries) ? record.entries : [];
  record.entries.unshift({
    headcount: safeHeadcount,
    source,
    timestamp: new Date().toISOString(),
  });
  record.entries = record.entries.slice(0, 100);
  upsertVendorRecord(record);
  return record;
};

const getVendorHeadcountEntries = (vendorId) => {
  const record = getVendorRecord(vendorId);
  return record && Array.isArray(record.entries) ? record.entries : [];
};

const getLatestHeadcount = (vendorId) => {
  const entries = getVendorHeadcountEntries(vendorId);
  return entries.length > 0 ? entries[0] : null;
};

const getAverageHeadcount = (vendorId) => {
  const entries = getVendorHeadcountEntries(vendorId);
  if (!entries.length) return null;
  const total = entries.reduce((sum, entry) => sum + Number(entry.headcount || 0), 0);
  return total / entries.length;
};

module.exports = {
  addHeadcountEntry,
  getVendorHeadcountEntries,
  getLatestHeadcount,
  getAverageHeadcount,
};
