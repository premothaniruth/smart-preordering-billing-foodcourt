const { createClient } = require("redis");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const duckdb = require("duckdb");
const analyticsConfig = require("./analyticsConfig");

const parsePayload = (entry) => {
  try {
    return entry ? JSON.parse(entry) : null;
  } catch (error) {
    console.error("[AnalyticsIngestor] Failed to parse payload", entry, error);
    return null;
  }
};

const extractEvent = (record) => {
  if (!record) return null;
  const event = {};
  if (record.type) event.type = record.type;
  if (record.app) event.app = record.app;
  if (record.ts) event.ts = record.ts;
  const payload = parsePayload(record.payload);
  event.payload = payload;
  return event;
};

const toIsoTime = (value) => {
  if (!value) return new Date().toISOString();
  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    return new Date().toISOString();
  }
  return asDate.toISOString();
};

class AnalyticsIngestor {
  constructor(config = analyticsConfig) {
    this.config = config;
    this.redis = createClient({ url: config.REDIS_URL });
    this.redis.on("error", (err) => {
      console.error("[AnalyticsIngestor] Redis error", err);
    });
    this.influx = new InfluxDB({
      url: config.INFLUX_URL,
      token: config.INFLUX_TOKEN,
    });
    this.influxWriteApi = this.influx.getWriteApi(config.INFLUX_ORG, config.INFLUX_BUCKET, "ns");
    this.influxWriteApi.useDefaultTags({ app: config.ANALYTICS_EVENT_APP });
    this.duckDb = new duckdb.Database(config.DUCKDB_PATH);
    this.duckDbConnection = null;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    await this.redis.connect();
    this.duckDbConnection = await this._openDuckDbConnection();
    this.running = true;
    this._loop();
  }

  async stop() {
    this.running = false;
    try {
      await this.redis.quit();
    } catch (error) {
      console.error("[AnalyticsIngestor] Failed to quit Redis", error);
    }
    if (this.influxWriteApi) {
      try {
        await this.influxWriteApi.close();
      } catch (error) {
        console.error("[AnalyticsIngestor] Failed to close Influx writer", error);
      }
    }
    if (this.duckDbConnection) {
      try {
        await this.duckDbConnection.close();
      } catch (error) {
        console.error("[AnalyticsIngestor] Failed to close DuckDB connection", error);
      }
    }
  }

  async _openDuckDbConnection() {
    return new Promise((resolve, reject) => {
      this.duckDb.connect((err, connection) => {
        if (err) {
          reject(err);
        } else {
          resolve(connection);
        }
      });
    });
  }

  async _ensureDuckDbSchema() {
    const conn = this.duckDbConnection;
    if (!conn) return;
    await conn.run(`
      CREATE TABLE IF NOT EXISTS order_events (
        ts TIMESTAMP,
        event_type VARCHAR,
        shop_id VARCHAR,
        vendor_id VARCHAR,
        order_id BIGINT,
        billing_id VARCHAR,
        status VARCHAR,
        total_amount DOUBLE,
        actor_type VARCHAR
      );
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS inventory_events (
        ts TIMESTAMP,
        event_type VARCHAR,
        shop_id VARCHAR,
        item_id BIGINT,
        item_name VARCHAR,
        delta DOUBLE,
        previous DOUBLE,
        current DOUBLE,
        order_id BIGINT,
        billing_id VARCHAR,
        reason VARCHAR,
        actor_type VARCHAR
      );
    `);
  }

  async _loop() {
    const {
      ANALYTICS_STREAM,
      ANALYTICS_CONSUMER_GROUP,
      ANALYTICS_CONSUMER_NAME,
      ANALYTICS_INGESTOR_BATCH_SIZE,
      ANALYTICS_INGESTOR_BLOCK_MS,
      ANALYTICS_INGESTOR_RETRY_MS,
    } = this.config;

    try {
      await this.redis.xGroupCreate(ANALYTICS_STREAM, ANALYTICS_CONSUMER_GROUP, "$", { MKSTREAM: true });
    } catch (error) {
      if (!/BUSYGROUP/.test(String(error?.message || ""))) {
        console.error("[AnalyticsIngestor] xGroupCreate failed", error);
      }
    }

    await this._ensureDuckDbSchema();

    while (this.running) {
      try {
        const response = await this.redis.xReadGroup(
          ANALYTICS_CONSUMER_GROUP,
          ANALYTICS_CONSUMER_NAME,
          [{ key: ANALYTICS_STREAM, id: ">" }],
          {
            COUNT: ANALYTICS_INGESTOR_BATCH_SIZE,
            BLOCK: ANALYTICS_INGESTOR_BLOCK_MS,
          }
        );

        if (!response || response.length === 0) {
          continue;
        }

        for (const streamResponse of response) {
          const messages = streamResponse?.messages || [];
          for (const message of messages) {
            const eventRecord = extractEvent(message?.message || {});
            if (!eventRecord) {
              await this.redis.xAck(ANALYTICS_STREAM, ANALYTICS_CONSUMER_GROUP, message.id);
              continue;
            }
            await this._processEvent(eventRecord);
            await this.redis.xAck(ANALYTICS_STREAM, ANALYTICS_CONSUMER_GROUP, message.id);
          }
        }
      } catch (error) {
        console.error("[AnalyticsIngestor] Error in processing loop", error);
        await new Promise((resolve) => setTimeout(resolve, ANALYTICS_INGESTOR_RETRY_MS));
      }
    }
  }

  async _processEvent(eventRecord) {
    const { type, ts, payload } = eventRecord;
    if (!type || !payload) return;
    switch (type) {
      case "order.created":
        await Promise.all([
          this._writeOrderEventToInflux("order_created", ts, payload),
          this._insertOrderEventToDuckDB("order_created", ts, payload),
        ]);
        break;
      case "order.status":
        await Promise.all([
          this._writeOrderEventToInflux("order_status", ts, payload),
          this._insertOrderEventToDuckDB("order_status", ts, payload),
        ]);
        break;
      case "order.prep_extended":
        await Promise.all([
          this._writeOrderEventToInflux("order_prep_extended", ts, payload),
          this._insertOrderEventToDuckDB("order_prep_extended", ts, payload),
        ]);
        break;
      case "inventory.adjusted":
        await Promise.all([
          this._writeInventoryEventToInflux("inventory_adjusted", ts, payload),
          this._insertInventoryEventToDuckDB("inventory_adjusted", ts, payload),
        ]);
        break;
      default:
        break;
    }
  }

  async _writeOrderEventToInflux(eventType, ts, payload) {
    const point = new Point("order_events")
      .tag("event_type", eventType)
      .tag("shop_id", payload?.shopId || "")
      .tag("vendor_id", payload?.vendorId || "")
      .tag("order_id", String(payload?.orderId || ""))
      .tag("billing_id", payload?.billingId || "")
      .tag("status", payload?.status || payload?.newStatus || "")
      .tag("actor_type", payload?.actor?.type || "")
      .floatField("total_amount", Number(payload?.totalAmount || 0))
      .timestamp(new Date(toIsoTime(ts)));

    this.influxWriteApi.writePoint(point);
  }

  async _writeInventoryEventToInflux(eventType, ts, payload) {
    const point = new Point("inventory_events")
      .tag("event_type", eventType)
      .tag("shop_id", payload?.shopId || "")
      .tag("item_id", String(payload?.itemId || ""))
      .tag("reason", payload?.reason || "")
      .tag("actor_type", payload?.actor?.type || "")
      .floatField("delta", Number(payload?.delta || 0))
      .floatField("previous", payload?.previous != null ? Number(payload.previous) : 0)
      .floatField("current", payload?.current != null ? Number(payload.current) : 0)
      .floatField("order_id", Number(payload?.orderId || 0))
      .timestamp(new Date(toIsoTime(ts)));

    this.influxWriteApi.writePoint(point);
  }

  async _insertOrderEventToDuckDB(eventType, ts, payload) {
    if (!this.duckDbConnection) return;
    const stmt = `
      INSERT INTO order_events (ts, event_type, shop_id, vendor_id, order_id, billing_id, status, total_amount, actor_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const params = [
      toIsoTime(ts),
      eventType,
      payload?.shopId || null,
      payload?.vendorId || null,
      payload?.orderId != null ? Number(payload.orderId) : null,
      payload?.billingId || null,
      payload?.status || payload?.newStatus || null,
      payload?.totalAmount != null ? Number(payload.totalAmount) : null,
      payload?.actor?.type || null,
    ];
    await this._runDuckDb(stmt, params);
  }

  async _insertInventoryEventToDuckDB(eventType, ts, payload) {
    if (!this.duckDbConnection) return;
    const stmt = `
      INSERT INTO inventory_events (ts, event_type, shop_id, item_id, item_name, delta, previous, current, order_id, billing_id, reason, actor_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const params = [
      toIsoTime(ts),
      eventType,
      payload?.shopId || null,
      payload?.itemId != null ? Number(payload.itemId) : null,
      payload?.itemName || null,
      payload?.delta != null ? Number(payload.delta) : null,
      payload?.previous != null ? Number(payload.previous) : null,
      payload?.current != null ? Number(payload.current) : null,
      payload?.orderId != null ? Number(payload.orderId) : null,
      payload?.billingId || null,
      payload?.reason || null,
      payload?.actor?.type || null,
    ];
    await this._runDuckDb(stmt, params);
  }

  async _runDuckDb(stmt, params) {
    return new Promise((resolve, reject) => {
      this.duckDbConnection.run(stmt, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

const analyticsIngestor = new AnalyticsIngestor();

module.exports = {
  analyticsIngestor,
  AnalyticsIngestor,
};
