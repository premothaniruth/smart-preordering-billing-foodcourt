// Centralized configuration access for analytics pipeline integrations.
const path = require("path");

const toNumberOrFallback = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveDuckDbPath = () => {
  if (process.env.DUCKDB_PATH && process.env.DUCKDB_PATH.trim()) {
    return process.env.DUCKDB_PATH.trim();
  }
  return path.join(__dirname, "..", "data", "analytics.duckdb");
};

module.exports = {
  REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  ANALYTICS_STREAM: process.env.ANALYTICS_STREAM || "analytics.events",
  ANALYTICS_STREAM_MAX_LEN: toNumberOrFallback(process.env.ANALYTICS_STREAM_MAX_LEN, 25000),
  ANALYTICS_CONSUMER_GROUP: process.env.ANALYTICS_CONSUMER_GROUP || "analytics-ingestors",
  ANALYTICS_CONSUMER_NAME: process.env.ANALYTICS_CONSUMER_NAME || `analytics-worker-${process.pid}`,
  ANALYTICS_EVENT_APP: process.env.ANALYTICS_EVENT_APP || "smart-foodcourt-backend",
  INFLUX_URL: process.env.INFLUX_URL || "http://localhost:8086",
  INFLUX_TOKEN: process.env.INFLUX_TOKEN || "influx-dev-token",
  INFLUX_ORG: process.env.INFLUX_ORG || "smart-foodcourt",
  INFLUX_BUCKET: process.env.INFLUX_BUCKET || "vendor_metrics",
  DUCKDB_PATH: resolveDuckDbPath(),
};
