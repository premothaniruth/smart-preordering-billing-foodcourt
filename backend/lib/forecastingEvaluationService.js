const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const analyticsConfig = require("./analyticsConfig");
const { analyticsQueryService } = require("./analyticsQueryService");
const { metricsRegistry } = require("./metricsRegistry");

const HORIZON_DAYS = Number(process.env.FORECAST_EVAL_WINDOW_DAYS || 7);
const MAP_THRESHOLD = Number(process.env.FORECAST_MAPE_ALERT_THRESHOLD || 0.25);

const latestAccuracy = new Map();

const coerceNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const computeAccuracy = (actual, predicted) => {
  if (!Array.isArray(actual) || !Array.isArray(predicted) || actual.length === 0) {
    return { mae: null, mape: null };
  }
  const paired = actual
    .map((value, idx) => ({ actual: coerceNumber(value, 0), forecast: coerceNumber(predicted[idx], 0) }))
    .filter((item, idx) => idx < predicted.length);
  if (paired.length === 0) {
    return { mae: null, mape: null };
  }
  const mae =
    paired.reduce((sum, item) => sum + Math.abs(item.actual - item.forecast), 0) / paired.length;
  const mape =
    paired.reduce((sum, item) => {
      const denominator = Math.max(1, Math.abs(item.actual));
      return sum + Math.abs((item.actual - item.forecast) / denominator);
    }, 0) /
    paired.length;
  return { mae, mape };
};

const influxClient = new InfluxDB({ url: analyticsConfig.INFLUX_URL, token: analyticsConfig.INFLUX_TOKEN });
const writeApi = influxClient.getWriteApi(analyticsConfig.INFLUX_ORG, analyticsConfig.INFLUX_BUCKET, "ns");

const evaluateVendorForecastAccuracy = async ({ vendorId, shopId }) => {
  const features = await analyticsQueryService.getRollingDemandFeatures({ shopId, windowDays: HORIZON_DAYS + 7 });
  if (!Array.isArray(features) || features.length < HORIZON_DAYS + 1) {
    return null;
  }

  const actualSeries = features.slice(-HORIZON_DAYS).map((row) => coerceNumber(row.orders, 0));
  const naiveForecast = features.slice(-HORIZON_DAYS - 1, -1).map((row) => coerceNumber(row.orders, 0));

  const { mae, mape } = computeAccuracy(actualSeries, naiveForecast);
  if (mae == null || mape == null) {
    return null;
  }

  metricsRegistry.setGauge(`forecast.mae.vendor.${vendorId}`, mae);
  metricsRegistry.setGauge(`forecast.mape.vendor.${vendorId}`, mape);
  metricsRegistry.setGauge("forecast.mape.threshold", MAP_THRESHOLD);
  if (mape > MAP_THRESHOLD) {
    metricsRegistry.incrementCounter("forecast.mape.thresholdBreaches");
  }

  const point = new Point("forecast_accuracy")
    .tag("vendor_id", String(vendorId))
    .tag("shop_id", String(shopId))
    .intField("horizon_days", HORIZON_DAYS)
    .floatField("mae", mae)
    .floatField("mape", mape)
    .timestamp(new Date());
  writeApi.writePoint(point);
  await writeApi.flush();

  const record = {
    vendorId,
    shopId,
    horizonDays: HORIZON_DAYS,
    mae,
    mape,
    evaluatedAt: new Date().toISOString(),
  };

  latestAccuracy.set(`${vendorId}:${shopId}`, record);

  return record;
};

const getLatestAccuracyForVendor = (vendorId) => {
  const results = [];
  latestAccuracy.forEach((value, key) => {
    if (String(value.vendorId) === String(vendorId)) {
      results.push(value);
    }
  });
  return results;
};

module.exports = {
  evaluateVendorForecastAccuracy,
  getLatestAccuracyForVendor,
};
