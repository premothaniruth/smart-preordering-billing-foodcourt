const analyticsConfig = require("./analyticsConfig");
const { analyticsQueryService } = require("./analyticsQueryService");
const { getAverageHeadcount } = require("./headcountStore");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

class ForecastingService {
  constructor(config = analyticsConfig) {
    this.config = config;
  }

  async getRecommendations({ shopId, vendorId }) {
    if (shopId == null) {
      throw new Error("shopId is required");
    }
    const lookbackDays = Number(process.env.FORECAST_LOOKBACK_DAYS || 14);
    const stats = await analyticsQueryService.getInventoryConsumptionStats({
      shopId,
      lookbackDays,
    });

    const headcountEntry = vendorId != null ? getAverageHeadcount(vendorId) : null;
    const headcountMultiplier = headcountEntry ? clamp(headcountEntry / 100, 0.5, 3) : 1;

    const recommendations = stats.map((item) => this._buildRecommendation({ item, lookbackDays, headcountMultiplier }));
    return {
      generatedAt: new Date().toISOString(),
      lookbackDays,
      headcount: headcountEntry,
      recommendations,
    };
  }

  _buildRecommendation({ item, lookbackDays, headcountMultiplier }) {
    const averageDailyConsumption = item.averageDailyConsumption || 0;
    const forecastWindowDays = Number(process.env.FORECAST_WINDOW_DAYS || 7);
    const expectedConsumption = averageDailyConsumption * forecastWindowDays * headcountMultiplier;
    const currentInventory = item.currentInventory != null ? Number(item.currentInventory) : null;

    const safetyStockDays = Number(process.env.FORECAST_SAFETY_STOCK_DAYS || 2);
    const safetyStock = averageDailyConsumption * safetyStockDays;

    let suggestedRestock = 0;
    if (currentInventory != null) {
      const projectedEnding = currentInventory - expectedConsumption;
      if (projectedEnding < safetyStock) {
        suggestedRestock = Math.ceil(safetyStock - projectedEnding + averageDailyConsumption);
      }
    } else {
      suggestedRestock = Math.ceil(expectedConsumption + safetyStock);
    }

    const rationale = [];
    rationale.push(`Average daily consumption: ${averageDailyConsumption.toFixed(2)} units`);
    rationale.push(`Forecast window (${forecastWindowDays} days) demand: ${expectedConsumption.toFixed(2)} units`);
    if (headcountMultiplier !== 1) {
      rationale.push(`Headcount multiplier applied: x${headcountMultiplier.toFixed(2)}`);
    }
    rationale.push(`Safety stock (${safetyStockDays} days): ${safetyStock.toFixed(2)} units`);

    return {
      itemId: item.itemId,
      itemName: item.itemName,
      currentInventory,
      averageDailyConsumption,
      forecastWindowDays,
      expectedConsumption,
      suggestedRestock: Math.max(0, Math.round(suggestedRestock)),
      safetyStock,
      rationale,
    };
  }
}

const forecastingService = new ForecastingService();

module.exports = {
  ForecastingService,
  forecastingService,
};
