const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "data", "logs");
const LOG_BASENAME = "analytics_audit.log";
const MAX_LOG_BYTES = Number(process.env.AUDIT_LOG_MAX_BYTES || 5 * 1024 * 1024);

const ensureDirectory = () => {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
};

const rotateIfNeeded = (logPath) => {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size < MAX_LOG_BYTES) {
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotatedPath = path.join(LOG_DIR, `${LOG_BASENAME}.${timestamp}`);
    fs.renameSync(logPath, rotatedPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("[AuditLogger] Failed during rotation", error);
    }
  }
};

const appendAuditEntry = (entry) => {
  try {
    ensureDirectory();
    const logPath = path.join(LOG_DIR, LOG_BASENAME);
    rotateIfNeeded(logPath);
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFile(logPath, line, (err) => {
      if (err) {
        console.error("[AuditLogger] Failed to append audit entry", err);
      }
    });
  } catch (error) {
    console.error("[AuditLogger] Unexpected error", error);
  }
};

module.exports = {
  appendAuditEntry,
};
