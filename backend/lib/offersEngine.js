const clampNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toHM = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const isWithinTimeRange = (hm, start, end) => {
  if (!hm) return false;
  if (!start && !end) return true;
  if (start && !end) return hm >= start;
  if (!start && end) return hm <= end;
  if (start === end) return true;
  if (start < end) {
    return hm >= start && hm <= end;
  }
  // range spans midnight
  return hm >= start || hm <= end;
};

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeCondition = (condition = {}) => {
  const type = condition.type || condition.kind;
  if (!type) return null;
  const base = { ...condition, type };
  switch (type) {
    case 'min_total':
      base.amount = condition.amount != null ? Number(condition.amount) : null;
      break;
    case 'min_item_count':
      base.quantity = condition.quantity != null ? Number(condition.quantity) : null;
      break;
    case 'section_totals':
      base.sections = normalizeArray(condition.sections).map(String);
      if (condition.minSubtotal != null) base.minSubtotal = Number(condition.minSubtotal);
      if (condition.minQuantity != null) base.minQuantity = Number(condition.minQuantity);
      break;
    case 'item_quantity':
      base.itemIds = normalizeArray(condition.itemIds).map((id) => Number(id));
      if (condition.minQuantity != null) base.minQuantity = Number(condition.minQuantity);
      if (condition.minSubtotal != null) base.minSubtotal = Number(condition.minSubtotal);
      break;
    case 'combo_quantity':
      base.comboIds = normalizeArray(condition.comboIds).map(String);
      if (condition.minQuantity != null) base.minQuantity = Number(condition.minQuantity);
      break;
    case 'date_range':
      base.start = condition.start ? new Date(condition.start).toISOString() : null;
      base.end = condition.end ? new Date(condition.end).toISOString() : null;
      break;
    case 'day_of_week':
      base.days = normalizeArray(condition.days).map((d) => Number(d));
      break;
    case 'time_range':
      base.start = condition.start || null;
      base.end = condition.end || null;
      break;
    case 'min_unique_items':
      base.count = condition.count != null ? Number(condition.count) : null;
      break;
    default:
      break;
  }
  return base;
};

const normalizeReward = (reward = {}) => {
  const type = reward.type || reward.kind;
  if (!type) return null;
  const base = { ...reward, type };
  switch (type) {
    case 'percentage_discount':
      base.percent = reward.percent != null ? Number(reward.percent) : 0;
      base.maxDiscountAmount = reward.maxDiscountAmount != null ? Number(reward.maxDiscountAmount) : null;
      base.appliesTo = reward.appliesTo || 'order';
      if (reward.sections) base.sections = normalizeArray(reward.sections).map(String);
      if (reward.itemIds) base.itemIds = normalizeArray(reward.itemIds).map((id) => Number(id));
      break;
    case 'fixed_discount':
      base.amount = reward.amount != null ? Number(reward.amount) : 0;
      base.appliesTo = reward.appliesTo || 'order';
      if (reward.sections) base.sections = normalizeArray(reward.sections).map(String);
      if (reward.itemIds) base.itemIds = normalizeArray(reward.itemIds).map((id) => Number(id));
      break;
    case 'free_item':
      base.itemId = reward.itemId != null ? Number(reward.itemId) : null;
      base.quantity = reward.quantity != null ? Number(reward.quantity) : 1;
      base.price = reward.price != null ? Number(reward.price) : 0;
      break;
    case 'informational':
      base.message = reward.message || '';
      break;
    default:
      break;
  }
  return base;
};

const normalizeOffer = (offer = {}) => {
  const normalized = {
    id: offer.id,
    shopId: offer.shopId != null ? Number(offer.shopId) : null,
    title: offer.title || '',
    description: offer.description || '',
    bannerText: offer.bannerText || '',
    active: offer.active !== false,
    stackable: offer.stackable !== false,
    priority: offer.priority != null ? Number(offer.priority) : 0,
    maxDiscountAmount: offer.maxDiscountAmount != null ? Number(offer.maxDiscountAmount) : null,
    metadata: clone(offer)
  };

  const conditions = [];
  if (Array.isArray(offer.conditions) && offer.conditions.length > 0) {
    for (const cond of offer.conditions) {
      const norm = normalizeCondition(cond);
      if (norm) conditions.push(norm);
    }
  }

  if (offer.start || offer.end) {
    conditions.push(normalizeCondition({ type: 'date_range', start: offer.start || null, end: offer.end || null }));
  }
  if (offer.daysOfWeek) {
    conditions.push(normalizeCondition({ type: 'day_of_week', days: offer.daysOfWeek }));
  }
  if (offer.timeStart || offer.timeEnd) {
    conditions.push(normalizeCondition({ type: 'time_range', start: offer.timeStart || null, end: offer.timeEnd || null }));
  }
  if (offer.schedule) {
    const { start, end, daysOfWeek, timeStart, timeEnd } = offer.schedule;
    if (start || end) conditions.push(normalizeCondition({ type: 'date_range', start: start || null, end: end || null }));
    if (daysOfWeek) conditions.push(normalizeCondition({ type: 'day_of_week', days: daysOfWeek }));
    if (timeStart || timeEnd) conditions.push(normalizeCondition({ type: 'time_range', start: timeStart || null, end: timeEnd || null }));
  }

  normalized.conditions = conditions.filter(Boolean);

  const rewards = [];
  if (Array.isArray(offer.rewards) && offer.rewards.length > 0) {
    for (const reward of offer.rewards) {
      const norm = normalizeReward(reward);
      if (norm) rewards.push(norm);
    }
  } else {
    if (offer.discountPercent != null) {
      rewards.push(normalizeReward({
        type: 'percentage_discount',
        percent: offer.discountPercent,
        appliesTo: (offer.applicableSections && offer.applicableSections.length > 0) ? 'sections' : 'order',
        sections: offer.applicableSections,
        maxDiscountAmount: offer.maxDiscountAmount
      }));
    }
    if (offer.discountAmount != null) {
      rewards.push(normalizeReward({
        type: 'fixed_discount',
        amount: offer.discountAmount,
        appliesTo: (offer.applicableSections && offer.applicableSections.length > 0) ? 'sections' : 'order',
        sections: offer.applicableSections
      }));
    }
  }

  normalized.rewards = rewards.filter(Boolean);
  return normalized;
};

const buildCartContext = ({ flatItems = [], sectionLookup = new Map(), itemLookup = new Map(), comboCounts = new Map() }) => {
  const sectionTotals = new Map();
  const itemTotals = new Map();
  let totalAmount = 0;
  let totalQuantity = 0;

  for (const line of flatItems) {
    const quantity = Number(line.quantity || 0);
    const price = Number(line.price || 0);
    const amount = price * quantity;
    const itemId = Number(line.id);
    totalQuantity += quantity;
    totalAmount += amount;

    if (!itemTotals.has(itemId)) {
      itemTotals.set(itemId, { quantity: 0, amount: 0 });
    }
    const itemEntry = itemTotals.get(itemId);
    itemEntry.quantity += quantity;
    itemEntry.amount += amount;

    const section = sectionLookup.get(itemId) || 'All Items';
    if (!sectionTotals.has(section)) {
      sectionTotals.set(section, { quantity: 0, amount: 0 });
    }
    const sectionEntry = sectionTotals.get(section);
    sectionEntry.quantity += quantity;
    sectionEntry.amount += amount;
  }

  return {
    totalAmount,
    totalQuantity,
    sectionTotals,
    itemTotals,
    comboCounts,
    sectionLookup,
    itemLookup
  };
};

const evaluateCondition = (condition, context, evaluationTimeHM, evaluationDate) => {
  switch (condition.type) {
    case 'min_total':
      if (condition.amount == null) return true;
      return context.totalAmount >= Number(condition.amount);
    case 'min_item_count':
      if (condition.quantity == null) return true;
      return context.totalQuantity >= Number(condition.quantity);
    case 'section_totals': {
      const sections = Array.isArray(condition.sections) && condition.sections.length > 0 ? condition.sections : ['All Items'];
      let subtotal = 0;
      let quantity = 0;
      for (const sec of sections) {
        const entry = context.sectionTotals.get(sec);
        if (entry) {
          subtotal += entry.amount;
          quantity += entry.quantity;
        }
      }
      if (condition.minSubtotal != null && subtotal < Number(condition.minSubtotal)) return false;
      if (condition.minQuantity != null && quantity < Number(condition.minQuantity)) return false;
      return true;
    }
    case 'item_quantity': {
      const ids = Array.isArray(condition.itemIds) ? condition.itemIds : [];
      if (ids.length === 0) return false;
      let subtotal = 0;
      let quantity = 0;
      for (const id of ids) {
        const entry = context.itemTotals.get(Number(id));
        if (entry) {
          subtotal += entry.amount;
          quantity += entry.quantity;
        }
      }
      if (condition.minQuantity != null && quantity < Number(condition.minQuantity)) return false;
      if (condition.minSubtotal != null && subtotal < Number(condition.minSubtotal)) return false;
      return quantity > 0 || subtotal > 0;
    }
    case 'combo_quantity': {
      const ids = Array.isArray(condition.comboIds) ? condition.comboIds : [];
      if (ids.length === 0) return false;
      let total = 0;
      for (const id of ids) {
        total += context.comboCounts.get(String(id)) || 0;
      }
      if (condition.minQuantity != null && total < Number(condition.minQuantity)) return false;
      return total > 0;
    }
    case 'date_range': {
      if (!condition.start && !condition.end) return true;
      const start = condition.start ? new Date(condition.start) : null;
      const end = condition.end ? new Date(condition.end) : null;
      if (start && evaluationDate < start) return false;
      if (end && evaluationDate > end) return false;
      return true;
    }
    case 'day_of_week': {
      if (!Array.isArray(condition.days) || condition.days.length === 0) return true;
      const day = evaluationDate.getDay();
      return condition.days.map(Number).includes(day);
    }
    case 'time_range': {
      return isWithinTimeRange(evaluationTimeHM, condition.start || null, condition.end || null);
    }
    case 'min_unique_items': {
      if (condition.count == null) return true;
      return context.itemTotals.size >= Number(condition.count);
    }
    default:
      return true;
  }
};

const getScopedTotals = (reward, context) => {
  const fallback = { amount: context.totalAmount, quantity: context.totalQuantity };
  if (!reward || !reward.appliesTo || reward.appliesTo === 'order') return fallback;
  if (reward.appliesTo === 'sections') {
    const sections = Array.isArray(reward.sections) && reward.sections.length > 0 ? reward.sections : ['All Items'];
    let amount = 0;
    let quantity = 0;
    for (const sec of sections) {
      const entry = context.sectionTotals.get(sec);
      if (entry) {
        amount += entry.amount;
        quantity += entry.quantity;
      }
    }
    return { amount, quantity };
  }
  if (reward.appliesTo === 'items') {
    const ids = Array.isArray(reward.itemIds) ? reward.itemIds : [];
    let amount = 0;
    let quantity = 0;
    for (const id of ids) {
      const entry = context.itemTotals.get(Number(id));
      if (entry) {
        amount += entry.amount;
        quantity += entry.quantity;
      }
    }
    return { amount, quantity };
  }
  return fallback;
};

const evaluateReward = ({ reward, context, offer, itemLookup, summary }) => {
  let discount = 0;
  const extraItems = [];
  const rewardSummary = { type: reward.type, details: {}, description: reward.description || '' };

  switch (reward.type) {
    case 'percentage_discount': {
      const baseTotals = getScopedTotals(reward, context);
      const percent = clampNumber(reward.percent, 0);
      const computed = (baseTotals.amount * percent) / 100;
      const capped = reward.maxDiscountAmount != null ? Math.min(computed, Number(reward.maxDiscountAmount)) : computed;
      discount = Math.max(0, capped);
      rewardSummary.details = {
        percent,
        scope: reward.appliesTo || 'order',
        sections: reward.sections || null,
        itemIds: reward.itemIds || null,
        baseAmount: baseTotals.amount,
        computedDiscount: discount
      };
      break;
    }
    case 'fixed_discount': {
      const baseTotals = getScopedTotals(reward, context);
      const amount = Math.max(0, Number(reward.amount || 0));
      discount = Math.min(amount, baseTotals.amount);
      rewardSummary.details = {
        amount,
        scope: reward.appliesTo || 'order',
        sections: reward.sections || null,
        itemIds: reward.itemIds || null,
        baseAmount: baseTotals.amount,
        computedDiscount: discount
      };
      break;
    }
    case 'free_item': {
      const itemId = reward.itemId != null ? Number(reward.itemId) : null;
      const quantity = reward.quantity != null ? Number(reward.quantity) : 1;
      if (itemId != null && quantity > 0) {
        const lookup = itemLookup.get(itemId) || {};
        const name = lookup.name || reward.itemName || `Item ${itemId}`;
        const section = lookup.section || null;
        const price = reward.price != null ? Number(reward.price) : 0;
        const configSource = offer.metadata?.configSnapshot || offer.metadata?.config || offer.metadata || {};
        const findCondition = (type) => (offer.conditions || []).find((cond) => cond.type === type);
        const toNumber = (value) => {
          const num = Number(value);
          return Number.isFinite(num) ? num : null;
        };

        const computeMultiplier = () => {
          const template = offer.metadata?.template || configSource?.template;
          if (!template) return 1;
          if (template === 'item_buy_x_get_y') {
            const itemCond = findCondition('item_quantity');
            const buyQuantity = toNumber(configSource.buyQuantity ?? itemCond?.minQuantity);
            if (!buyQuantity || buyQuantity <= 0) return 1;
            const targetIdsRaw = Array.isArray(configSource.targetItemIds) && configSource.targetItemIds.length > 0
              ? configSource.targetItemIds
              : (Array.isArray(itemCond?.itemIds) ? itemCond.itemIds : []);
            const ids = (targetIdsRaw.length ? targetIdsRaw : [itemId])
              .map((id) => Number(id))
              .filter((id) => Number.isFinite(id));
            if (!ids.length) return 1;
            let qualifyingQuantity = 0;
            for (const id of ids) {
              const entry = context.itemTotals?.get(Number(id));
              if (entry?.quantity) qualifyingQuantity += Number(entry.quantity);
            }
            if (qualifyingQuantity <= 0) return 1;
            const tiers = Math.floor(qualifyingQuantity / buyQuantity);
            return tiers > 0 ? tiers : 1;
          }

          if (template === 'combo_buy_x_get_y') {
            const comboCond = findCondition('combo_quantity');
            const buyQuantity = toNumber(configSource.buyQuantity ?? comboCond?.minQuantity);
            if (!buyQuantity || buyQuantity <= 0) return 1;
            const comboIdsRaw = Array.isArray(offer.metadata?.applicableComboIds) && offer.metadata.applicableComboIds.length > 0
              ? offer.metadata.applicableComboIds
              : (Array.isArray(comboCond?.comboIds) ? comboCond.comboIds : []);
            if (!comboIdsRaw.length) return 1;
            const countsMap = context.comboCounts || new Map();
            let qualifyingQuantity = 0;
            for (const comboId of comboIdsRaw) {
              qualifyingQuantity += countsMap.get(String(comboId)) || 0;
            }
            if (qualifyingQuantity <= 0) return 1;
            const tiers = Math.floor(qualifyingQuantity / buyQuantity);
            return tiers > 0 ? tiers : 1;
          }

          return 1;
        };

        const multiplier = computeMultiplier();
        const totalQuantity = Math.max(1, multiplier) * quantity;
        extraItems.push({
          id: itemId,
          name,
          price,
          quantity: totalQuantity,
          section,
          fromOfferId: offer.id,
          fromOfferTitle: offer.title
        });
        rewardSummary.details = {
          itemId,
          quantity: totalQuantity,
          baseQuantity: quantity,
          multiplier,
          price,
          name,
          section
        };
      }
      break;
    }
    case 'informational': {
      rewardSummary.details = { message: reward.message || '' };
      break;
    }
    default:
      break;
  }

  if (discount > 0) {
    summary.discount += discount;
  }

  summary.extraItems.push(...extraItems);
  summary.rewards.push(rewardSummary);

  return discount;
};

const evaluateOffers = ({
  offers = [],
  flatItems = [],
  sectionLookup = new Map(),
  itemLookup = new Map(),
  comboCounts = new Map(),
  evaluationDate = null,
  now = new Date()
} = {}) => {
  const normalizedOffers = offers.map(normalizeOffer).filter((offer) => offer.active !== false);
  const sortedOffers = normalizedOffers.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

  const lookupMap = itemLookup instanceof Map ? itemLookup : new Map(Object.entries(itemLookup).map(([k, v]) => [Number(k), v]));
  const sectionMap = sectionLookup instanceof Map ? sectionLookup : new Map(Object.entries(sectionLookup).map(([k, v]) => [Number(k), v]));

  const comboMap = comboCounts instanceof Map ? comboCounts : new Map(Object.entries(comboCounts).map(([k, v]) => [String(k), Number(v)]));

  const context = buildCartContext({ flatItems, sectionLookup: sectionMap, itemLookup: lookupMap, comboCounts: comboMap });

  const evaluationTime = evaluationDate instanceof Date && !Number.isNaN(evaluationDate.getTime()) ? evaluationDate : new Date(now.getTime());
  const evaluationHM = toHM(evaluationTime);

  const result = {
    discountTotal: 0,
    appliedOffers: [],
    extraItems: [],
    subtotalBeforeDiscount: context.totalAmount
  };

  for (const offer of sortedOffers) {
    if (!offer.rewards || offer.rewards.length === 0) continue;

    let allConditionsPass = true;
    for (const condition of offer.conditions || []) {
      if (!evaluateCondition(condition, context, evaluationHM, evaluationTime)) {
        allConditionsPass = false;
        break;
      }
    }

    if (!allConditionsPass) continue;

    const appliedSummary = {
      id: offer.id,
      title: offer.title,
      description: offer.description || '',
      bannerText: offer.bannerText || '',
      rewards: [],
      discountAmount: 0,
      metadata: offer.metadata
    };

    const rewardAccumulator = { discount: 0, extraItems: [], rewards: [] };

    for (const reward of offer.rewards) {
      rewardAccumulator.discount += evaluateReward({
        reward,
        context,
        offer,
        itemLookup: lookupMap,
        summary: rewardAccumulator
      });
    }

    let offerDiscount = rewardAccumulator.discount;
    if (offer.maxDiscountAmount != null && offer.maxDiscountAmount >= 0) {
      offerDiscount = Math.min(offerDiscount, Number(offer.maxDiscountAmount));
    }

    if (offerDiscount > 0 || rewardAccumulator.extraItems.length > 0 || rewardAccumulator.rewards.some((r) => r.type === 'informational')) {
      appliedSummary.discountAmount = offerDiscount;
      appliedSummary.rewards = rewardAccumulator.rewards;
      appliedSummary.extraItems = rewardAccumulator.extraItems;
      result.appliedOffers.push(appliedSummary);
      result.discountTotal += offerDiscount;
      result.extraItems.push(...rewardAccumulator.extraItems);
      if (offer.stackable === false) {
        break;
      }
    }
  }

  return result;
};

module.exports = {
  normalizeOffer,
  evaluateOffers,
  buildCartContext
};
