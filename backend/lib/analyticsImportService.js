const { parse } = require("csv-parse");
const ExcelJS = require("exceljs");
const path = require("path");
const analyticsConfig = require("./analyticsConfig");
const { getEventBus } = require("./eventBus");
const { metricsRegistry } = require("./metricsRegistry");

const SUPPORTED_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
];

const REQUIRED_FIELDS = ["shopId", "totalAmount", "timestamp"];

const normalizeKey = (key) => String(key || "").trim();

const toCamel = (str) =>
  normalizeKey(str)
    .toLowerCase()
    .replace(/[_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));

const isCsv = (filename = "", mimetype = "") => {
  if (mimetype === "text/csv") return true;
  const ext = path.extname(String(filename).toLowerCase());
  return ext === ".csv";
};

const parseCsvBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    parse(buffer, { columns: true, skip_empty_lines: true, trim: true }, (err, records) => {
      if (err) return reject(err);
      resolve(records);
    });
  });

const parseXlsxBuffer = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const values = sheet.getSheetValues();
  if (!values || values.length <= 1) {
    return [];
  }

  const headerRow = values[1] || [];
  const headers = headerRow.slice(1).map((header) => normalizeKey(header));
  const records = [];

  for (let rowIndex = 2; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    if (!row) continue;
    const entry = {};
    headers.forEach((header, colIdx) => {
      if (!header) return;
      const cellValue = row[colIdx + 1];
      if (cellValue == null) {
        entry[header] = null;
      } else if (cellValue instanceof Date) {
        entry[header] = cellValue.toISOString();
      } else if (typeof cellValue === "object" && cellValue !== null) {
        if (typeof cellValue.text === "string") {
          entry[header] = cellValue.text;
        } else if (Array.isArray(cellValue.richText)) {
          entry[header] = cellValue.richText.map((part) => part.text || "").join("");
        } else if (cellValue.result != null) {
          entry[header] = cellValue.result;
        } else {
          entry[header] = cellValue; // fallback
        }
      } else {
        entry[header] = cellValue;
      }
    });
    if (Object.keys(entry).length > 0) {
      records.push(entry);
    }
  }

  return records;
};

const normalizeRecords = (records) =>
  records.map((raw) => {
    const entry = {};
    Object.entries(raw || {}).forEach(([key, value]) => {
      const camel = toCamel(key);
      entry[camel] = value;
    });
    return entry;
  });

const validateRecord = (record) => {
  const missing = REQUIRED_FIELDS.filter((field) => record[field] == null || record[field] === "");
  if (missing.length > 0) {
    return { valid: false, reason: `Missing fields: ${missing.join(", ")}` };
  }
  return { valid: true };
};

const toNumber = (value) => {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseItems = (rawItems) => {
  if (!rawItems) return [];
  if (Array.isArray(rawItems)) return rawItems;
  if (typeof rawItems === "string") {
    const trimmed = rawItems.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      // fall through
    }
    return trimmed.split(/;|\|/).map((token) => ({
      name: token.trim(),
    }));
  }
  return [];
};

const buildOrderEvent = (record) => {
  const orderId = toNumber(record.orderId);
  const billingId = normalizeKey(record.billingId);
  const shopId = record.shopId;
  const totalAmount = toNumber(record.totalAmount) ?? 0;
  const payload = {
    orderId: orderId || null,
    billingId: billingId || null,
    shopId: shopId != null ? String(shopId) : null,
    totalAmount,
    subtotalBeforeDiscount: toNumber(record.subtotal) ?? totalAmount,
    discountTotal: toNumber(record.discountTotal) ?? 0,
    user: record.user || record.userId || null,
    status: record.status || "imported",
    createdAt: record.timestamp || new Date().toISOString(),
    scheduledTime: record.scheduledTime || null,
    payment: {
      method: record.paymentMethod || "import",
      reference: record.paymentReference || null,
    },
    items: parseItems(record.items),
  };
  return payload;
};

const buildInventoryEvent = (record) => {
  const delta = toNumber(record.inventoryDelta ?? record.delta);
  if (delta == null || delta === 0) return null;
  const itemId = toNumber(record.itemId);
  return {
    shopId: record.shopId != null ? String(record.shopId) : null,
    itemId,
    itemName: record.itemName || record.item || null,
    delta,
    previous: toNumber(record.previousInventory),
    current: toNumber(record.currentInventory),
    orderId: toNumber(record.orderId),
    billingId: normalizeKey(record.billingId) || null,
    reason: record.inventoryReason || "import",
  };
};

class AnalyticsImportService {
  constructor(config = analyticsConfig) {
    this.config = config;
    this.emitRetryAttempts = Number(process.env.IMPORT_EMIT_RETRY_ATTEMPTS || 3);
    this.emitRetryBaseMs = Number(process.env.IMPORT_EMIT_RETRY_BASE_MS || 250);
  }

  async importFile({ buffer, mimetype, originalname, actor }) {
    if (!buffer || buffer.length === 0) {
      throw new Error("Empty file uploaded");
    }
    if (!SUPPORTED_MIME_TYPES.includes(mimetype) && !isCsv(originalname, mimetype)) {
      throw new Error(`Unsupported file type: ${mimetype}`);
    }

    let rawRecords = [];
    if (isCsv(originalname, mimetype)) {
      rawRecords = await parseCsvBuffer(buffer);
    } else {
      rawRecords = await parseXlsxBuffer(buffer);
    }

    const records = normalizeRecords(rawRecords);
    const bus = getEventBus();
    await bus.connect();

    const summary = {
      totalRows: records.length,
      ordersEmitted: 0,
      inventoryEmitted: 0,
      errors: [],
    };

    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      const validation = validateRecord(record);
      if (!validation.valid) {
        summary.errors.push({ index: i, reason: validation.reason });
        continue;
      }

      try {
        const orderEvent = buildOrderEvent(record);
        orderEvent.meta = {
          source: "import",
          importedBy: actor?.username || actor?.userId || "unknown",
          originalRow: i + 1,
        };
        await this.emitWithRetry(bus, "order.created", orderEvent);
        summary.ordersEmitted += 1;
        metricsRegistry.incrementCounter("import.orders.success");
      } catch (error) {
        summary.errors.push({ index: i, reason: `Order emit failed: ${error.message}` });
        metricsRegistry.incrementCounter("import.orders.failed");
      }

      try {
        const inventoryEvent = buildInventoryEvent(record);
        if (inventoryEvent) {
          inventoryEvent.actor = {
            type: "import",
            userId: actor?.userId || null,
            username: actor?.username || null,
          };
          await this.emitWithRetry(bus, "inventory.adjusted", inventoryEvent);
          summary.inventoryEmitted += 1;
          metricsRegistry.incrementCounter("import.inventory.success");
        }
      } catch (error) {
        summary.errors.push({ index: i, reason: `Inventory emit failed: ${error.message}` });
        metricsRegistry.incrementCounter("import.inventory.failed");
      }
    }

    return summary;
  }

  async emitWithRetry(bus, eventType, payload) {
    let attempt = 0;
    let delayMs = this.emitRetryBaseMs;
    while (attempt < this.emitRetryAttempts) {
      try {
        await bus.emit(eventType, payload);
        return;
      } catch (error) {
        attempt += 1;
        if (attempt >= this.emitRetryAttempts) {
          throw error;
        }
        metricsRegistry.incrementCounter("import.emit.retries");
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 2000);
      }
    }
  }
}

const analyticsImportService = new AnalyticsImportService();

module.exports = {
  AnalyticsImportService,
  analyticsImportService,
};
