const { InfluxDB } = require("@influxdata/influxdb-client");
const duckdb = require("duckdb");
const analyticsConfig = require("./analyticsConfig");

const PERIOD_TO_DAYS = {
  day: 1,
  daily: 1,
  week: 7,
  weekly: 7,
  month: 30,
  monthly: 30,
  quarter: 90,
  quarterly: 90,
  year: 365,
  yearly: 365,
};

const GRANULARITY_TO_MS = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

const safeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const truncateTime = (timestamp, bucketMs) => {
  const timeMs = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (!Number.isFinite(timeMs) || !bucketMs) return null;
  return Math.floor(timeMs / bucketMs) * bucketMs;
};

class AnalyticsQueryService {
  constructor(config = analyticsConfig) {
    this.config = config;
    this.influx = new InfluxDB({ url: config.INFLUX_URL, token: config.INFLUX_TOKEN });
    this.influxQueryApi = this.influx.getQueryApi(config.INFLUX_ORG);
    this.duckDb = new duckdb.Database(config.DUCKDB_PATH);
    this.duckConnectionPromise = null;
  }

  async _getDuckConnection() {
    if (this.duckConnectionPromise) return this.duckConnectionPromise;
    this.duckConnectionPromise = new Promise((resolve, reject) => {
      this.duckDb.connect((err, connection) => {
        if (err) reject(err);
        else resolve(connection);
      });
    });
    return this.duckConnectionPromise;
  }

  resolveStart(period) {
    const normalized = String(period || "week").toLowerCase();
    const days = PERIOD_TO_DAYS[normalized] || 7;
    const ms = days * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms);
  }

  resolveGranularity(granularity) {
    const normalized = String(granularity || "hour").toLowerCase();
    return GRANULARITY_TO_MS[normalized] || GRANULARITY_TO_MS.hour;
  }

  formatTimeSeries(buckets, bucketMs) {
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    return sorted.map(([bucketTime, stats]) => ({
      time: new Date(Number(bucketTime)).toISOString(),
      ...stats,
    }));
  }

  async queryFlux(fluxQuery) {
    const rows = [];
    await new Promise((resolve, reject) => {
      this.influxQueryApi.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
          const obj = tableMeta.toObject(row);
          rows.push(obj);
        },
        error: (err) => {
          console.error("[AnalyticsQueryService] Flux query failed", err, fluxQuery);
          reject(err);
        },
        complete: () => resolve(),
      });
    });
    return rows;
  }

  buildOrderFlux(shopId, start) {
    return `from(bucket: "${this.config.INFLUX_BUCKET}")
  |> range(start: time(v: "${start.toISOString()}"))
  |> filter(fn: (r) => r._measurement == "order_events")
  |> filter(fn: (r) => r["shop_id"] == "${shopId}")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "order_id", "billing_id", "total_amount", "event_type", "status", "actor_type"])
  |> sort(columns: ["_time"])
`;
  }

  buildInventoryFlux(shopId, start) {
    return `from(bucket: "${this.config.INFLUX_BUCKET}")
  |> range(start: time(v: "${start.toISOString()}"))
  |> filter(fn: (r) => r._measurement == "inventory_events")
  |> filter(fn: (r) => r["shop_id"] == "${shopId}")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "item_id", "item_name", "delta", "previous", "current", "reason", "order_id", "billing_id", "actor_type"])
  |> sort(columns: ["_time"], desc: true)
`;
  }

  async fetchOrderMetrics(shopId, start, bucketMs) {
    const flux = this.buildOrderFlux(shopId, start);
    const rows = await this.queryFlux(flux).catch(() => []);

    const orderCreated = rows.filter((row) => row.event_type === "order_created");
    const orderStatus = rows.filter((row) => row.event_type === "order_status");
    const prepExtended = rows.filter((row) => row.event_type === "order_prep_extended");

    const uniqueOrders = new Set(orderCreated.map((row) => row.order_id));
    const totalRevenue = orderCreated.reduce((sum, row) => sum + safeNumber(row.total_amount), 0);

    const buckets = new Map();
    for (const row of orderCreated) {
      const bucketTime = truncateTime(row._time, bucketMs);
      if (bucketTime == null) continue;
      const stats = buckets.get(bucketTime) || { orders: 0, revenue: 0 };
      stats.orders += 1;
      stats.revenue += safeNumber(row.total_amount);
      buckets.set(bucketTime, stats);
    }

    const statusBreakdown = orderStatus.reduce((acc, row) => {
      const status = String(row.status || row.newStatus || "unknown").toLowerCase();
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    const averagePrepExtension = prepExtended.length
      ? prepExtended.reduce((sum, row) => sum + safeNumber(row.currentPrepMinutes - row.previousPrepMinutes), 0) / prepExtended.length
      : 0;

    return {
      totalOrders: uniqueOrders.size,
      totalRevenue,
      timeSeries: this.formatTimeSeries(buckets, bucketMs),
      statusBreakdown,
      averagePrepExtension,
      raw: {
        orderCreated,
        orderStatus,
      },
    };
  }

  async fetchInventoryMetrics(shopId, start) {
    const flux = this.buildInventoryFlux(shopId, start);
    const rows = await this.queryFlux(flux).catch(() => []);

    const netDelta = rows.reduce((sum, row) => sum + safeNumber(row.delta), 0);
    const totalDepletion = rows
      .filter((row) => safeNumber(row.delta) < 0)
      .reduce((sum, row) => sum + Math.abs(safeNumber(row.delta)), 0);

    const recent = rows.slice(0, 20).map((row) => ({
      time: new Date(row._time).toISOString(),
      itemId: row.item_id != null ? Number(row.item_id) : null,
      itemName: row.item_name || null,
      delta: safeNumber(row.delta),
      current: row.current != null ? Number(row.current) : null,
      reason: row.reason || null,
    }));

    return {
      netDelta,
      totalDepletion,
      adjustments: recent,
    };
  }

  async fetchHistoricalSnapshots(shopId) {
    try {
      const conn = await this._getDuckConnection();
      const query = `
        SELECT
          date_trunc('month', ts) AS period_start,
          COUNT(*) FILTER (WHERE event_type = 'order_created') AS orders,
          SUM(CASE WHEN event_type = 'order_created' THEN total_amount ELSE 0 END) AS revenue
        FROM order_events
        WHERE shop_id = ?
        GROUP BY 1
        ORDER BY period_start DESC
        LIMIT 12;
      `;
      const rows = await new Promise((resolve, reject) => {
        conn.all(query, [String(shopId)], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      return rows
        .map((row) => ({
          period: new Date(row.period_start).toISOString(),
          orders: safeNumber(row.orders, 0),
          revenue: safeNumber(row.revenue, 0),
        }))
        .reverse();
    } catch (error) {
      console.error("[AnalyticsQueryService] DuckDB query failed", error);
      return [];
    }
  }

  async getRollingDemandFeatures({ shopId, endDate = new Date(), windowDays = 30 }) {
    if (shopId == null) {
      throw new Error("shopId is required");
    }
    const end = new Date(endDate);
    const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
    try {
      const conn = await this._getDuckConnection();
      const query = `
        WITH orders AS (
          SELECT
            ts,
            total_amount,
            order_id,
            billing_id,
            holiday_flag,
            weather_code
          FROM order_events
          WHERE shop_id = ?
            AND ts >= ?
            AND ts < ?
            AND event_type = 'order_created'
        ),
        daily_orders AS (
          SELECT
            date_trunc('day', ts) AS day,
            COUNT(*) AS orders,
            SUM(total_amount) AS revenue,
            MAX(weather_code) AS weather_code,
            MAX(holiday_flag::INT)::BOOLEAN AS holiday_flag
          FROM orders
          GROUP BY 1
        ),
        inventory AS (
          SELECT
            date_trunc('day', ts) AS day,
            SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS daily_consumption
          FROM inventory_events
          WHERE shop_id = ?
            AND ts >= ?
            AND ts < ?
          GROUP BY 1
        )
        SELECT
          d.day,
          d.orders,
          d.revenue,
          COALESCE(i.daily_consumption, 0) AS daily_consumption,
          COALESCE(d.weather_code, 'clear') AS weather_code,
          COALESCE(d.holiday_flag, FALSE) AS holiday_flag
        FROM daily_orders d
        LEFT JOIN inventory i ON d.day = i.day
        ORDER BY d.day;
      `;

      const rows = await new Promise((resolve, reject) => {
        conn.all(
          query,
          [
            String(shopId),
            start.toISOString(),
            end.toISOString(),
            String(shopId),
            start.toISOString(),
            end.toISOString(),
          ],
          (err, result) => {
            if (err) reject(err);
            else resolve(result || []);
          }
        );
      });

      const withFeatures = rows.map((row, index) => {
        const slice = rows.slice(Math.max(0, index - 6), index + 1);
        const rollingOrders = slice.reduce((sum, r) => sum + safeNumber(r.orders), 0);
        const rollingRevenue = slice.reduce((sum, r) => sum + safeNumber(r.revenue), 0);
        const rollingConsumption = slice.reduce((sum, r) => sum + safeNumber(r.daily_consumption), 0);
        return {
          day: new Date(row.day).toISOString(),
          orders: safeNumber(row.orders),
          revenue: safeNumber(row.revenue),
          consumption: safeNumber(row.daily_consumption),
          rolling7Orders: rollingOrders,
          rolling7Revenue: rollingRevenue,
          rolling7Consumption: rollingConsumption,
          weatherCode: row.weather_code || 'clear',
          holidayFlag: Boolean(row.holiday_flag),
        };
      });

      return withFeatures;
    } catch (error) {
      console.error("[AnalyticsQueryService] Failed to compute rolling demand features", error);
      return [];
    }
  }

  async getInventoryConsumptionStats({ shopId, lookbackDays = 14 }) {
    if (shopId == null) {
      throw new Error("shopId is required");
    }
    const days = Math.max(1, Number(lookbackDays) || 14);
    const lookbackStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const conn = await this._getDuckConnection();
      const query = `
        WITH filtered AS (
          SELECT *,
                 ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY ts DESC) AS rn_latest
          FROM inventory_events
          WHERE shop_id = ?
            AND ts >= ?
        )
        SELECT
          item_id,
          MAX(CASE WHEN rn_latest = 1 THEN item_name END) AS item_name,
          MAX(CASE WHEN rn_latest = 1 THEN current END) AS current_inventory,
          SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS total_consumption,
          SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS total_restock,
          COUNT(*) AS event_count
        FROM filtered
        GROUP BY item_id
        HAVING SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) > 0;
      `;
      const rows = await new Promise((resolve, reject) => {
        conn.all(query, [String(shopId), lookbackStart.toISOString()], (err, result) => {
          if (err) reject(err);
          else resolve(result || []);
        });
      });

      return rows.map((row) => ({
        itemId: row.item_id != null ? Number(row.item_id) : null,
        itemName: row.item_name || null,
        currentInventory: row.current_inventory != null ? Number(row.current_inventory) : null,
        totalConsumption: Number(row.total_consumption || 0),
        totalRestock: Number(row.total_restock || 0),
        eventCount: Number(row.event_count || 0),
        averageDailyConsumption: Number(row.total_consumption || 0) / days,
      }));
    } catch (error) {
      console.error("[AnalyticsQueryService] Failed to compute consumption stats", error);
      return [];
    }
  }

  async getVendorSummary({ shopId, period, granularity }) {
    if (shopId == null) {
      throw new Error("shopId is required");
    }
    const start = this.resolveStart(period);
    const bucketMs = this.resolveGranularity(granularity);

    const [orders, inventory, history] = await Promise.all([
      this.fetchOrderMetrics(shopId, start, bucketMs),
      this.fetchInventoryMetrics(shopId, start),
      this.fetchHistoricalSnapshots(shopId),
    ]);

    const averageOrderValue = orders.totalOrders > 0 ? orders.totalRevenue / orders.totalOrders : 0;

    return {
      generatedAt: new Date().toISOString(),
      rangeStart: start.toISOString(),
      shopId: String(shopId),
      totals: {
        orders: orders.totalOrders,
        revenue: orders.totalRevenue,
        averageOrderValue,
        inventoryNetDelta: inventory.netDelta,
      },
      statusBreakdown: orders.statusBreakdown,
      averagePrepExtensionMinutes: orders.averagePrepExtension,
      timeSeries: orders.timeSeries,
      inventory: {
        recentAdjustments: inventory.adjustments,
        totalDepletion: inventory.totalDepletion,
      },
      history,
    };
  }
}

const analyticsQueryService = new AnalyticsQueryService();

module.exports = {
  AnalyticsQueryService,
  analyticsQueryService,
};
