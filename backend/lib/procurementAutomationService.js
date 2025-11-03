const { forecastingService } = require("./forecastingService");
const { realtimeAnalyticsService } = require("./realtimeAnalyticsService");
const { analyticsQueryService } = require("./analyticsQueryService");
const {
  listTasks,
  saveTask,
  generateTaskId,
  getTaskById,
} = require("./procurementTaskStore");

const DEFAULT_LEAD_TIME_DAYS = Number(process.env.PROCUREMENT_LEAD_TIME_DAYS || 2);
const DEFAULT_SAFETY_STOCK_DAYS = Number(process.env.PROCUREMENT_SAFETY_DAYS || 1.5);

const coerceNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const computeReorderPoint = ({
  averageDailyConsumption,
  leadTimeDays = DEFAULT_LEAD_TIME_DAYS,
  safetyDays = DEFAULT_SAFETY_STOCK_DAYS,
}) => {
  const daily = Math.max(0, coerceNumber(averageDailyConsumption, 0));
  return Math.max(0, daily * (leadTimeDays + safetyDays));
};

const computeProjectedStockoutDays = ({ currentInventory, averageDailyConsumption }) => {
  const daily = Math.max(0.01, coerceNumber(averageDailyConsumption, 0.01));
  const current = Math.max(0, coerceNumber(currentInventory, 0));
  return current / daily;
};

const normalizeInventoryMap = (inventory) => {
  const map = new Map();
  if (Array.isArray(inventory?.items)) {
    inventory.items.forEach((item) => {
      if (item?.itemId != null) {
        map.set(String(item.itemId), item);
      }
    });
  }
  return map;
};

const shouldCreateTaskLine = ({ currentInventory, reorderPoint, suggestedRestock }) => {
  const current = coerceNumber(currentInventory, 0);
  const point = coerceNumber(reorderPoint, 0);
  const restock = coerceNumber(suggestedRestock, 0);
  return current <= point || restock > 0;
};

const buildTaskPayload = ({ vendorId, shopId, items, recommendationsSource, forecastMetadata }) => ({
  id: generateTaskId(),
  vendorId,
  shopId,
  status: "pending",
  createdAt: new Date().toISOString(),
  recommendationsSource,
  forecastMetadata,
  items,
});

const generateProcurementTask = async ({ vendorId, shopId }) => {
  const [recommendationsBundle, inventorySnapshot, rollingFeatures] = await Promise.all([
    forecastingService.getRecommendations({ vendorId, shopId }),
    realtimeAnalyticsService.getInventory(shopId),
    analyticsQueryService.getRollingDemandFeatures({ shopId }),
  ]);

  const inventoryMap = normalizeInventoryMap(inventorySnapshot);
  const recommendationItems = Array.isArray(recommendationsBundle?.recommendations)
    ? recommendationsBundle.recommendations
    : [];

  const featureByItem = new Map();
  rollingFeatures.forEach((feature) => {
    if (feature?.itemId != null) {
      featureByItem.set(String(feature.itemId), feature);
    }
  });

  const taskItems = recommendationItems
    .map((rec) => {
      const itemId = rec.itemId != null ? String(rec.itemId) : null;
      if (!itemId) return null;
      const inventoryEntry = inventoryMap.get(itemId) || {};
      const feature = featureByItem.get(itemId) || {};

      const averageDailyConsumption = coerceNumber(
        rec.averageDailyConsumption ?? feature.averageDailyConsumption,
        0
      );
      const reorderPoint = computeReorderPoint({ averageDailyConsumption });
      const currentInventory = coerceNumber(
        rec.currentInventory ?? inventoryEntry.current,
        0
      );
      const projectedStockoutDays = computeProjectedStockoutDays({
        currentInventory,
        averageDailyConsumption,
      });

      if (
        !shouldCreateTaskLine({
          currentInventory,
          reorderPoint,
          suggestedRestock: rec.suggestedRestock,
        })
      ) {
        return null;
      }

      return {
        itemId: rec.itemId,
        itemName: rec.itemName || inventoryEntry.itemName || `Item ${rec.itemId}`,
        currentInventory,
        suggestedRestock: Math.max(0, Math.round(coerceNumber(rec.suggestedRestock, 0))),
        reorderPoint: Math.round(reorderPoint),
        projectedStockoutDays: Number(projectedStockoutDays.toFixed(2)),
        safetyStock: Number(
          (averageDailyConsumption * DEFAULT_SAFETY_STOCK_DAYS).toFixed(2)
        ),
        averageDailyConsumption,
      };
    })
    .filter(Boolean);

  if (taskItems.length === 0) {
    return null;
  }

  const payload = buildTaskPayload({
    vendorId,
    shopId,
    items: taskItems,
    recommendationsSource: recommendationsBundle,
    forecastMetadata: {
      generatedAt: recommendationsBundle?.generatedAt,
      lookbackDays: recommendationsBundle?.lookbackDays,
    },
  });

  saveTask(payload);
  return payload;
};

const updateTaskStatus = (taskId, updates) => {
  const existing = getTaskById(taskId);
  if (!existing) return null;
  const updated = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  saveTask(updated);
  return updated;
};

module.exports = {
  generateProcurementTask,
  listTasks,
  getTaskById,
  saveTask,
  updateTaskStatus,
};
