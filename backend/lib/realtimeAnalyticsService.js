const EventEmitter = require("events");
const { createClient } = require("redis");
const analyticsConfig = require("./analyticsConfig");
const { analyticsQueryService } = require("./analyticsQueryService");
const { metricsRegistry } = require("./metricsRegistry");

const GRANULARITIES = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

const MAX_BUCKETS = 500;
const MAX_RECENT_ADJUSTMENTS = 50;

const ensureMap = (obj, key, factory) => {
  if (!obj.has(key)) {
    obj.set(key, factory());
  }
  return obj.get(key);
};

const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const calcBucket = (timestamp, granularityMs) => {
  const time = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(granularityMs) || granularityMs <= 0) return null;
  return Math.floor(time / granularityMs) * granularityMs;
};

const defaultState = (shopId = null) => ({
  shopId: shopId != null ? String(shopId) : null,
  generatedAt: null,
  rangeStart: null,
  totals: {
    orders: 0,
    revenue: 0,
    averageOrderValue: 0,
    inventoryNetDelta: 0,
  },
  statusBreakdown: {},
  averagePrepExtensionMinutes: 0,
  prepExtensionSamples: 0,
  timeSeries: {
    hour: new Map(),
    day: new Map(),
    week: new Map(),
  },
  inventory: {
    items: new Map(),
    recentAdjustments: [],
  },
  history: [],
});

class RealtimeAnalyticsService extends EventEmitter {
  constructor(config = analyticsConfig) {
    super();
    this.config = config;
    this.redis = createClient({ url: config.REDIS_URL });
    this.redis.on("error", (err) => console.error("[RealtimeAnalyticsService] Redis error", err));
    this.state = new Map();
    this.subscriptions = new Map();
    this.running = false;
    metricsRegistry.setHealthStatus("realtimeAnalytics", { healthy: false, detail: "initialized" });
  }

  async start() {
    if (this.running) return;
    await this.redis.connect();
    try {
      await this.redis.xGroupCreate(
        this.config.ANALYTICS_STREAM,
        `${this.config.ANALYTICS_CONSUMER_GROUP}-realtime`,
        "$",
        { MKSTREAM: true }
      );
    } catch (err) {
      if (!/BUSYGROUP/.test(String(err?.message || ""))) {
        console.error("[RealtimeAnalyticsService] xGroupCreate failed", err);
      }
    }
    this.running = true;
    metricsRegistry.setHealthStatus("realtimeAnalytics", { healthy: true, detail: "running" });
    this._loop();
  }

  async stop() {
    this.running = false;
    try {
      await this.redis.quit();
    } catch (error) {
      console.error("[RealtimeAnalyticsService] Failed to quit Redis", error);
    }
    metricsRegistry.setHealthStatus("realtimeAnalytics", { healthy: false, detail: "stopped" });
  }

  async getSummary(shopId, fallback = true) {
    const state = this.state.get(String(shopId));
    if (state) {
      return this._serializeState(state);
    }
    if (!fallback) return this._serializeState(defaultState(shopId));
    const summary = await analyticsQueryService.getVendorSummary({ shopId });
    this._hydrateFromSummary(String(shopId), summary);
    return summary;
  }

  async getTimeSeries(shopId, granularity = "hour") {
    const state = this.state.get(String(shopId));
    if (!state) {
      await this.getSummary(shopId); // hydrate
    }
    const snapshot = this.state.get(String(shopId)) || defaultState(shopId);
    const granularityKey = GRANULARITIES[granularity] ? granularity : "hour";
    const entries = Array.from(snapshot.timeSeries[granularityKey].entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, stats]) => ({
        time: new Date(bucket).toISOString(),
        orders: stats.orders,
        revenue: stats.revenue,
      }));
    return {
      shopId: String(shopId),
      granularity: granularityKey,
      series: entries,
    };
  }

  async getInventory(shopId) {
    const state = this.state.get(String(shopId));
    if (!state) {
      await this.getSummary(shopId);
    }
    const snapshot = this.state.get(String(shopId)) || defaultState(shopId);
    const items = Array.from(snapshot.inventory.items.values()).map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      current: item.current,
      lastUpdate: item.lastUpdate,
    }));
    return {
      shopId: String(shopId),
      totals: {
        distinctItems: items.length,
        netDelta: snapshot.totals.inventoryNetDelta,
      },
      recentAdjustments: snapshot.inventory.recentAdjustments,
      items,
    };
  }

  async exportCurrent(shopId, format = "json") {
    const summary = await this.getSummary(shopId);
    const timeseries = await this.getTimeSeries(shopId, "hour");
    const inventory = await this.getInventory(shopId);

    if (format === "csv") {
      const rows = [
        ["metric", "value"],
        ["orders", summary.totals.orders],
        ["revenue", summary.totals.revenue],
        ["averageOrderValue", summary.totals.averageOrderValue],
        ["inventoryNetDelta", summary.totals.inventoryNetDelta],
      ];
      const csv = rows.map((row) => row.join(",")).join("\n");
      return { contentType: "text/csv", payload: csv };
    }

    return {
      contentType: "application/json",
      payload: JSON.stringify({ summary, timeseries, inventory }),
    };
  }

  registerWebSocket(shopId, ws) {
    const key = String(shopId);
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    const set = this.subscriptions.get(key);
    set.add(ws);
    ws.on("close", () => {
      set.delete(ws);
      if (set.size === 0) {
        this.subscriptions.delete(key);
      }
    });
  }

  async _loop() {
    const group = `${this.config.ANALYTICS_CONSUMER_GROUP}-realtime`;
    const consumer = `${this.config.ANALYTICS_CONSUMER_NAME}-rt-${process.pid}`;
    let retryMs = this.config.ANALYTICS_INGESTOR_RETRY_MS || 1000;
    const maxRetry = Math.min((this.config.ANALYTICS_INGESTOR_RETRY_MS || 1000) * 8, 30000);
    while (this.running) {
      try {
        const response = await this.redis.xReadGroup(
          group,
          consumer,
          [{ key: this.config.ANALYTICS_STREAM, id: ">" }],
          {
            COUNT: 200,
            BLOCK: this.config.ANALYTICS_INGESTOR_BLOCK_MS,
          }
        );
        if (!response || response.length === 0) {
          await this._updateLagGauge();
          metricsRegistry.setHealthStatus("realtimeAnalytics", { healthy: true, detail: "idle" });
          continue;
        }
        for (const stream of response) {
          const messages = stream.messages || [];
          for (const message of messages) {
            const payload = this._deserializeEvent(message.message || {});
            if (payload) {
              this._applyEvent(payload);
            }
            await this.redis.xAck(this.config.ANALYTICS_STREAM, group, message.id);
          }
        }
        await this._updateLagGauge();
        metricsRegistry.setHealthStatus("realtimeAnalytics", { healthy: true, detail: "processing" });
        retryMs = this.config.ANALYTICS_INGESTOR_RETRY_MS || 1000;
      } catch (error) {
        console.error("[RealtimeAnalyticsService] Loop error", error);
        metricsRegistry.incrementCounter("realtimeAnalytics.errors");
        metricsRegistry.setHealthStatus("realtimeAnalytics", { healthy: false, detail: error.message });
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        retryMs = Math.min(retryMs * 2, maxRetry);
      }
    }
  }

  async _updateLagGauge() {
    try {
      const summary = await this.redis.xPending(
        this.config.ANALYTICS_STREAM,
        `${this.config.ANALYTICS_CONSUMER_GROUP}-realtime`
      );
      metricsRegistry.setGauge("realtime.redisLag", summary?.count || 0);
    } catch (error) {
      metricsRegistry.incrementCounter("realtimeAnalytics.lagErrors");
    }
  }

  _deserializeEvent(message) {
    if (!message || !message.type) return null;
    let payload;
    try {
      payload = message.payload ? JSON.parse(message.payload) : {};
    } catch (error) {
      payload = {};
    }
    return {
      type: message.type,
      ts: message.ts,
      app: message.app,
      payload,
    };
  }

  _applyEvent(event) {
    const shopId = event?.payload?.shopId;
    if (shopId == null) return;
    const key = String(shopId);
    const state = ensureMap(this.state, key, () => defaultState(shopId));
    const eventTs = event.payload?.eventTimestamp || event.ts || new Date().toISOString();
    const timestampMs = new Date(eventTs).getTime();

    switch (event.type) {
      case "order.created":
        this._applyOrderCreated(state, event.payload, timestampMs);
        break;
      case "order.status":
        this._applyOrderStatus(state, event.payload);
        break;
      case "order.prep_extended":
        this._applyPrepExtended(state, event.payload);
        break;
      case "inventory.adjusted":
        this._applyInventoryAdjustment(state, event.payload, timestampMs);
        break;
      default:
        break;
    }

    state.generatedAt = new Date().toISOString();
    state.totals.averageOrderValue = state.totals.orders > 0
      ? state.totals.revenue / state.totals.orders
      : 0;
    state.history = [...state.history, { timestamp: new Date().toISOString(), event }].slice(-MAX_BUCKETS);

    this._notifySubscribers(key, this._serializeState(state));
  }

  _applyOrderCreated(state, payload, timestampMs) {
    const amount = safeNumber(payload.totalAmount);
    state.totals.orders += 1;
    state.totals.revenue += amount;

    Object.entries(GRANULARITIES).forEach(([granularityKey, granularityMs]) => {
      const bucket = calcBucket(timestampMs, granularityMs);
      if (bucket == null) return;
      const bucketMap = state.timeSeries[granularityKey];
      const entry = ensureMap(bucketMap, bucket, () => ({ orders: 0, revenue: 0 }));
      entry.orders += 1;
      entry.revenue += amount;
      if (bucketMap.size > MAX_BUCKETS) {
        const firstKey = Array.from(bucketMap.keys()).sort((a, b) => a - b)[0];
        bucketMap.delete(firstKey);
      }
    });
  }

  _applyOrderStatus(state, payload) {
    const status = String(payload.newStatus || payload.status || "unknown").toLowerCase();
    state.statusBreakdown[status] = (state.statusBreakdown[status] || 0) + 1;
  }

  _applyPrepExtended(state, payload) {
    const addMinutes = safeNumber(payload.addMinutes);
    if (!addMinutes) return;
    const totalMinutes = safeNumber(state.averagePrepExtensionMinutes) * state.prepExtensionSamples + addMinutes;
    state.prepExtensionSamples += 1;
    state.averagePrepExtensionMinutes = totalMinutes / state.prepExtensionSamples;
  }

  _applyInventoryAdjustment(state, payload, timestampMs) {
    const delta = safeNumber(payload.delta);
    const itemId = payload.itemId != null ? Number(payload.itemId) : null;
    if (itemId == null) return;
    state.totals.inventoryNetDelta += delta;
    const item = ensureMap(state.inventory.items, String(itemId), () => ({
      itemId,
      itemName: payload.itemName || null,
      current: payload.current != null ? Number(payload.current) : null,
      lastUpdate: null,
    }));
    if (payload.itemName) item.itemName = payload.itemName;
    if (payload.current != null) item.current = Number(payload.current);
    item.lastUpdate = new Date(timestampMs).toISOString();

    state.inventory.recentAdjustments.unshift({
      time: new Date(timestampMs).toISOString(),
      itemId,
      itemName: payload.itemName || item.itemName || null,
      delta,
      current: payload.current != null ? Number(payload.current) : item.current,
      reason: payload.reason || null,
    });
    state.inventory.recentAdjustments = state.inventory.recentAdjustments.slice(0, MAX_RECENT_ADJUSTMENTS);
  }

  _notifySubscribers(shopId, snapshot) {
    const listeners = this.subscriptions.get(shopId);
    if (!listeners || listeners.size === 0) return;
    const payload = JSON.stringify({ type: "analytics:update", data: snapshot });
    for (const ws of listeners) {
      try {
        ws.send(payload);
      } catch (error) {
        console.error("[RealtimeAnalyticsService] Failed to notify subscriber", error);
      }
    }
  }

  _serializeState(state) {
    const timeseriesHour = Array.from(state.timeSeries.hour.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, stats]) => ({
        time: new Date(bucket).toISOString(),
        orders: stats.orders,
        revenue: stats.revenue,
      }));
    const inventoryAdjustments = [...state.inventory.recentAdjustments];
    return {
      shopId: state.shopId,
      generatedAt: state.generatedAt || new Date().toISOString(),
      rangeStart: state.rangeStart,
      totals: {
        orders: state.totals.orders,
        revenue: state.totals.revenue,
        averageOrderValue: state.totals.averageOrderValue,
        inventoryNetDelta: state.totals.inventoryNetDelta,
      },
      statusBreakdown: { ...state.statusBreakdown },
      averagePrepExtensionMinutes: Number(state.averagePrepExtensionMinutes || 0),
      timeSeries: timeseriesHour,
      inventory: {
        recentAdjustments: inventoryAdjustments,
        totalDepletion: inventoryAdjustments
          .filter((entry) => entry.delta < 0)
          .reduce((sum, entry) => sum + Math.abs(entry.delta), 0),
      },
      history: [...state.history],
    };
  }

  _hydrateFromSummary(shopId, summary) {
    const state = ensureMap(this.state, String(shopId), () => defaultState(shopId));
    state.shopId = String(shopId);
    state.generatedAt = summary.generatedAt;
    state.rangeStart = summary.rangeStart || null;
    state.totals.orders = summary.totals?.orders || 0;
    state.totals.revenue = summary.totals?.revenue || 0;
    state.totals.averageOrderValue = summary.totals?.averageOrderValue || 0;
    state.totals.inventoryNetDelta = summary.totals?.inventoryNetDelta || 0;
    state.statusBreakdown = { ...(summary.statusBreakdown || {}) };
    state.averagePrepExtensionMinutes = summary.averagePrepExtensionMinutes || 0;
    state.prepExtensionSamples = summary.averagePrepExtensionMinutes ? 1 : 0;
    state.history = Array.isArray(summary.history) ? [...summary.history] : [];

    if (Array.isArray(summary.timeSeries)) {
      summary.timeSeries.forEach((row) => {
        const timestampMs = new Date(row.time).getTime();
        Object.entries(GRANULARITIES).forEach(([key, ms]) => {
          const bucket = calcBucket(timestampMs, ms);
          if (bucket == null) return;
          const entry = ensureMap(state.timeSeries[key], bucket, () => ({ orders: 0, revenue: 0 }));
          entry.orders += safeNumber(row.orders);
          entry.revenue += safeNumber(row.revenue);
        });
      });
    }

    const inventoryAdjustments = summary.inventory?.recentAdjustments || [];
    state.inventory.recentAdjustments = inventoryAdjustments.slice(0, MAX_RECENT_ADJUSTMENTS);
    (summary.inventory?.items || []).forEach((item) => {
      state.inventory.items.set(String(item.itemId), {
        itemId: item.itemId,
        itemName: item.itemName,
        current: item.current,
        lastUpdate: item.lastUpdate,
      });
    });
  }
}

const realtimeAnalyticsService = new RealtimeAnalyticsService();

module.exports = {
  RealtimeAnalyticsService,
  realtimeAnalyticsService,
};
