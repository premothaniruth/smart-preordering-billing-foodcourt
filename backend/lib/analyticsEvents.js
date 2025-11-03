const { getEventBus } = require("./eventBus");

const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const safeInteger = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
};

const sanitizeActor = (actor = {}) => {
  if (!actor || typeof actor !== "object") return null;
  const normalized = {};
  if (actor.type) normalized.type = String(actor.type);
  if (actor.userId != null) normalized.userId = String(actor.userId);
  if (actor.vendorId != null) normalized.vendorId = String(actor.vendorId);
  if (actor.shopId != null) normalized.shopId = String(actor.shopId);
  if (actor.username) normalized.username = String(actor.username);
  if (actor.email) normalized.email = String(actor.email);
  if (actor.mobile) normalized.mobile = String(actor.mobile);
  if (actor.source) normalized.source = String(actor.source);
  return Object.keys(normalized).length ? normalized : null;
};

const mapOrderItems = (items = []) =>
  items.map((item) => ({
    id: item?.id ?? null,
    name: item?.name || null,
    quantity: safeNumber(item?.quantity),
    price: safeNumber(item?.price),
    option: item?.option || null,
    isOfferFreebie: item?.isOfferFreebie === true,
    offerSource: item?.offerSource || null,
    comboId: item?.comboId ?? null,
    prepTime: safeNumber(item?.prepTime),
  }));

const safeEmit = async (eventType, payload) => {
  try {
    const bus = getEventBus();
    await bus.connect();
    await bus.emit(eventType, payload);
  } catch (error) {
    console.error(`[AnalyticsEvents] Failed to emit ${eventType}`, error, payload);
  }
};

const emitOrderCreatedEvent = (order, context = {}) => {
  if (!order) return Promise.resolve();
  const payload = {
    orderId: order.id,
    billingId: order.billingId || null,
    shopId: order.shopId != null ? String(order.shopId) : null,
    vendorId: context?.vendor?.vendorId != null ? String(context.vendor.vendorId) : null,
    vendorUsername: context?.vendor?.username || null,
    user: context.user || order.user || null,
    status: order.status || null,
    totalAmount: safeNumber(order.totalAmount),
    subtotalBeforeDiscount: safeNumber(order.subtotalBeforeDiscount),
    discountTotal: safeNumber(order.discountTotal),
    scheduledTime: order.scheduledTime || null,
    createdAt: order.createdAt || null,
    estimatedReadyTime: order.estimatedReadyTime || null,
    baseEstimatedReadyTime: order.baseEstimatedReadyTime || null,
    bulkOrderId: order.bulkOrderId ?? null,
    payment: context.payment || order.payment || null,
    excludedItems: context.excludedItems || null,
    items: mapOrderItems(order.items),
    meta: context.meta || null,
  };
  return safeEmit("order.created", payload);
};

const emitOrderStatusEvent = (order, details = {}) => {
  if (!order) return Promise.resolve();
  const payload = {
    orderId: order.id,
    billingId: order.billingId || null,
    shopId: order.shopId != null ? String(order.shopId) : null,
    vendorId: details?.vendor?.vendorId != null ? String(details.vendor.vendorId) : null,
    vendorUsername: details?.vendor?.username || null,
    previousStatus: details.previousStatus || null,
    newStatus: order.status || null,
    reason: details.reason || null,
    actor: sanitizeActor(details.actor || details.vendor || null),
    readyAt: order.readyAt || null,
    pickedAt: order.pickedAt || null,
    completedAt: order.completedAt || null,
    cancelledAt: order.cancelledAt || null,
  };
  return safeEmit("order.status", payload);
};

const emitOrderPrepExtendedEvent = (order, details = {}) => {
  if (!order) return Promise.resolve();
  const payload = {
    orderId: order.id,
    billingId: order.billingId || null,
    shopId: order.shopId != null ? String(order.shopId) : null,
    vendorId: details?.vendor?.vendorId != null ? String(details.vendor.vendorId) : null,
    vendorUsername: details?.vendor?.username || null,
    addMinutes: safeNumber(details.addMinutes),
    previousPrepMinutes: safeNumber(details.previousPrepMinutes),
    currentPrepMinutes: safeNumber(order.prepTime),
    previousEta: details.previousEta || null,
    newEta: order.estimatedReadyTime || null,
    actor: sanitizeActor(details.actor || details.vendor || null),
  };
  return safeEmit("order.prep_extended", payload);
};

const emitInventoryAdjustedEvent = (adjustment = {}) => {
  const payload = {
    shopId: adjustment.shopId != null ? String(adjustment.shopId) : null,
    itemId: adjustment.itemId != null ? Number(adjustment.itemId) : null,
    itemName: adjustment.itemName || null,
    delta: safeNumber(adjustment.delta),
    previousInventory: safeNumber(adjustment.previous),
    newInventory: safeNumber(adjustment.current),
    orderId: adjustment.orderId ?? null,
    billingId: adjustment.billingId ?? null,
    reason: adjustment.reason || null,
    actor: sanitizeActor(adjustment.actor),
    metadata: adjustment.metadata || null,
  };
  return safeEmit("inventory.adjusted", payload);
};

module.exports = {
  emitOrderCreatedEvent,
  emitOrderStatusEvent,
  emitOrderPrepExtendedEvent,
  emitInventoryAdjustedEvent,
};
