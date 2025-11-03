const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { analyticsQueryService } = require("./analyticsQueryService");
const analyticsConfig = require("./analyticsConfig");

const ARCHIVE_ROOT = path.join(__dirname, "..", "data", "archive");
const METADATA_PATH = path.join(__dirname, "..", "data", "archiveCatalog.json");

const ensureDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const loadMetadata = () => {
  try {
    if (!fs.existsSync(METADATA_PATH)) {
      return {};
    }
    const raw = fs.readFileSync(METADATA_PATH, "utf8");
    return JSON.parse(raw || "{}");
  } catch (error) {
    console.error("[ArchiveScheduler] Failed to load metadata", error);
    return {};
  }
};

const saveMetadata = (metadata) => {
  try {
    ensureDirectory(path.dirname(METADATA_PATH));
    fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error("[ArchiveScheduler] Failed to save metadata", error);
  }
};

const computeChecksum = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
};

const monthKey = (date) => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const listVendors = () => {
  const vendorsPath = path.join(__dirname, "..", "data", "vendors.json");
  try {
    const raw = fs.readFileSync(vendorsPath, "utf8");
    const vendors = JSON.parse(raw || "[]");
    return Array.isArray(vendors) ? vendors : [];
  } catch (error) {
    console.error("[ArchiveScheduler] Failed to read vendors", error);
    return [];
  }
};

const materializeSnapshot = async ({ vendorId, shopId, period }) => {
  const key = `${vendorId}/${period}`;
  console.log(`[ArchiveScheduler] Materializing ${key}`);
  const start = new Date(`${period}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const duckConnection = await analyticsQueryService._getDuckConnection();
  const archiveDir = path.join(ARCHIVE_ROOT, String(vendorId));
  ensureDirectory(archiveDir);
  const outputPath = path.join(archiveDir, `${period}.parquet`);

  const query = `
    COPY (
      SELECT *
      FROM order_events
      WHERE shop_id = ?
        AND ts >= ?
        AND ts < ?
      UNION ALL
      SELECT *
      FROM inventory_events
      WHERE shop_id = ?
        AND ts >= ?
        AND ts < ?
    ) TO '${outputPath}' (FORMAT 'parquet');
  `;

  await new Promise((resolve, reject) => {
    duckConnection.run(
      query,
      [String(shopId), start.toISOString(), end.toISOString(), String(shopId), start.toISOString(), end.toISOString()],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });

  const checksum = await computeChecksum(outputPath);
  return { outputPath, checksum };
};

const materializeVendorSnapshots = async ({ vendor, periods, metadata }) => {
  const vendorId = vendor.vendorId;
  const shopId = vendor.shopId;
  const results = [];

  for (const period of periods) {
    try {
      const { outputPath, checksum } = await materializeSnapshot({ vendorId, shopId, period });
      results.push({ period, outputPath, checksum, status: "success" });
      metadata[vendorId] = metadata[vendorId] || {};
      metadata[vendorId][period] = {
        status: "success",
        generatedAt: new Date().toISOString(),
        checksum,
        path: outputPath,
      };
    } catch (error) {
      console.error(`[ArchiveScheduler] Failed snapshot ${vendorId}/${period}`, error);
      metadata[vendorId] = metadata[vendorId] || {};
      metadata[vendorId][period] = {
        status: "error",
        generatedAt: new Date().toISOString(),
        error: error.message,
      };
      results.push({ period, status: "error", error: error.message });
    }
  }

  return results;
};

const collectPendingPeriods = (metadata, vendorId) => {
  const now = new Date();
  const periods = [];
  for (let i = 0; i < 12; i += 1) {
    const date = new Date(now);
    date.setUTCMonth(date.getUTCMonth() - i);
    const period = monthKey(date);
    const existing = metadata[vendorId]?.[period];
    if (!existing || existing.status !== "success") {
      periods.push(period);
    }
  }
  return periods;
};

const runArchiveJob = async ({ specificVendorId } = {}) => {
  ensureDirectory(ARCHIVE_ROOT);
  const vendors = listVendors().filter((vendor) => !specificVendorId || Number(vendor.vendorId) === Number(specificVendorId));
  if (vendors.length === 0) {
    console.warn("[ArchiveScheduler] No vendors found to process");
    return { status: "empty" };
  }

  const metadata = loadMetadata();
  const report = [];

  for (const vendor of vendors) {
    const vendorId = vendor.vendorId;
    const periods = collectPendingPeriods(metadata, vendorId);
    if (periods.length === 0) {
      continue;
    }
    const results = await materializeVendorSnapshots({ vendor, periods, metadata });
    report.push({ vendorId, shopId: vendor.shopId, results });
    saveMetadata(metadata);
  }

  return { status: "ok", processed: report };
};

module.exports = {
  runArchiveJob,
  loadMetadata,
  saveMetadata,
  monthKey,
};
