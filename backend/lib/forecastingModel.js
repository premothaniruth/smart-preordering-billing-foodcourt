const { forecastingService } = require("./forecastingService");
const { analyticsQueryService } = require("./analyticsQueryService");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const smoothSeries = (series, factor = 0.3) => {
  if (!Array.isArray(series) || series.length === 0) return [];
  let previous = series[0];
  return series.map((value) => {
    const next = factor * value + (1 - factor) * previous;
    previous = next;
    return next;
  });
};

const buildBaselineForecast = (features) => {
  if (!Array.isArray(features) || features.length === 0) {
    return [];
  }
  const ordersSeries = features.map((row) => row.orders || 0);
  const smoothed = smoothSeries(ordersSeries, 0.4);
  const lastValue = smoothed[smoothed.length - 1] || 0;
  const trend = smoothed.length >= 2 ? smoothed[smoothed.length - 1] - smoothed[smoothed.length - 2] : 0;

  const forecastHorizon = Number(process.env.FORECAST_HORIZON_DAYS || 7);
  const results = [];
  for (let i = 1; i <= forecastHorizon; i += 1) {
    const projected = Math.max(0, lastValue + trend * i);
    results.push({ dayOffset: i, projectedOrders: projected });
  }
  return results;
};

const enrichForecastWithRecommendations = (forecast, recommendations) => {
  if (!Array.isArray(forecast)) return [];
  const recommendationMap = new Map();
  (recommendations || []).forEach((item) => {
    if (item && item.itemId != null) {
      recommendationMap.set(String(item.itemId), item);
    }
  });
  return forecast.map((entry) => {
    const dayKey = String(entry.dayOffset);
    const relevant = [];
    recommendationMap.forEach((value) => {
      if (value && value.suggestedRestock > 0) {
        relevant.push({ itemId: value.itemId, itemName: value.itemName, suggestedRestock: value.suggestedRestock });
      }
    });
    return {
      ...entry,
      recommendations: relevant,
    };
  });
};

const buildForecastResponse = (features, recommendations) => {
  const baseline = buildBaselineForecast(features);
  return {
    generatedAt: new Date().toISOString(),
    horizonDays: baseline.length,
    baseline,
    recommendations: enrichForecastWithRecommendations(baseline, recommendations || []),
    features,
  };
};

const generateForecast = async ({ shopId, vendorId }) => {
  const windowDays = Number(process.env.FORECAST_FEATURE_WINDOW_DAYS || 60);
  const features = await analyticsQueryService.getRollingDemandFeatures({ shopId, windowDays });
  const recommendationBundle = await forecastingService.getRecommendations({ shopId, vendorId });
  return buildForecastResponse(features, recommendationBundle?.recommendations || []);
};

module.exports = {
  generateForecast,
};
