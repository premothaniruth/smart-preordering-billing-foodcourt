const fs = require("fs");
const path = require("path");

const ARCHIVE_PATH = path.join(__dirname, "..", "data", "vendor_archives.json");

const ensureStore = () => {
  if (!fs.existsSync(ARCHIVE_PATH)) {
    fs.writeFileSync(ARCHIVE_PATH, JSON.stringify([], null, 2));
  }
};

const readStore = () => {
  ensureStore();
  try {
    const raw = fs.readFileSync(ARCHIVE_PATH, "utf8");
    return JSON.parse(raw || "[]");
  } catch (error) {
    console.error("[VendorArchiveStore] Failed to read archive store", error);
    return [];
  }
};

const writeStore = (data) => {
  ensureStore();
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(data, null, 2));
};

const listArchives = () => readStore();

const appendArchive = (record) => {
  const archives = readStore();
  archives.push(record);
  writeStore(archives);
  return record;
};

const removeArchiveById = (archiveId) => {
  const archives = readStore();
  const filtered = archives.filter((entry) => entry.archiveId !== archiveId);
  writeStore(filtered);
  return archives.length !== filtered.length;
};

const findArchiveByVendorId = (vendorId) => {
  const archives = readStore();
  return archives.find((entry) => Number(entry.vendorId) === Number(vendorId)) || null;
};

const upsertArchives = (archives) => {
  writeStore(archives);
};

module.exports = {
  listArchives,
  appendArchive,
  removeArchiveById,
  findArchiveByVendorId,
  upsertArchives,
};
