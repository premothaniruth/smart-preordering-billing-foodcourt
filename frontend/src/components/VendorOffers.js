import React, { useEffect, useMemo, useState } from "react";
import { fetchOffers, fetchCombos, fetchMenuSections, updateOffers } from "../api";
import { toast } from "react-toastify";

const CUSTOM_FREE_ITEM_OPTIONS = [
  { value: "custom-1", label: "Custom 1" },
  { value: "custom-2", label: "Custom 2" },
  { value: "custom-3", label: "Custom 3" }
];

const CUSTOM_TARGET_ITEM_OPTIONS = [
  { value: "custom-target-1", label: "Custom Target 1" },
  { value: "custom-target-2", label: "Custom Target 2" },
  { value: "custom-target-3", label: "Custom Target 3" }
];

const TEMPLATE_OPTIONS = [
  { value: "percent_order", label: "% Off Order / Sections" },
  { value: "flat_order", label: "Flat Discount" },
  { value: "combo_buy_item_free", label: "Combo – Buy Combo Get Item Free" },
  { value: "item_buy_x_get_y", label: "Menu Item – Buy X Get Y" }
];

const CUSTOM_ANY_TOKEN = "__custom_any__";

const buildSelectionDefaults = () => ({
  buy: {
    mode: "fixed",
    allowAny: false,
    priceCap: "",
    items: []
  },
  free: {
    mode: "fixed",
    allowAny: false,
    priceCap: "",
    items: []
  }
});

const normalizeSelectionItems = (items) => {
  if (!Array.isArray(items)) return [];
  const unique = new Set();
  const normalized = [];
  items.forEach((entry) => {
    if (entry == null) return;
    let value = null;
    if (typeof entry === "object") {
      if (entry.id != null) value = entry.id;
      else if (entry.value != null) value = entry.value;
    } else {
      value = entry;
    }
    if (value == null) return;
    const str = String(value);
    if (!str || unique.has(str)) return;
    unique.add(str);
    normalized.push(str);
  });
  return normalized;
};

const hydrateSelection = (rawSelection = {}, fallbackBuyItems = [], fallbackFreeItems = []) => {
  const defaults = buildSelectionDefaults();
  const buyRaw = rawSelection.buy || {};
  const freeRaw = rawSelection.free || {};

  const hydrateSide = (sideRaw, fallbackItems, defaultsForSide) => {
    const rawMode = sideRaw.mode === "custom" ? "custom" : sideRaw.mode === "fixed" ? "fixed" : defaultsForSide.mode;
    const itemsSource = Array.isArray(sideRaw.items) && sideRaw.items.length > 0 ? sideRaw.items : fallbackItems;
    const items = normalizeSelectionItems(itemsSource);
    const priceCap = sideRaw.priceCap != null && sideRaw.priceCap !== "" ? String(sideRaw.priceCap) : "";
    const allowAny = rawMode === "custom"
      ? (sideRaw.allowAny != null ? Boolean(sideRaw.allowAny) : items.length === 0)
      : false;
    return {
      mode: rawMode,
      allowAny,
      priceCap,
      items
    };
  };

  return {
    buy: hydrateSide(buyRaw, fallbackBuyItems, defaults.buy),
    free: hydrateSide(freeRaw, fallbackFreeItems, defaults.free)
  };
};

const buildSelectionSummary = (cfg) => {
  const selection = cfg.selection || buildSelectionDefaults();
  const buyQty = Number(cfg.buyQuantity || 0);
  const freeQty = Number(cfg.freeQuantity || 0);

  const pluralize = (qty, noun) => {
    const safeQty = Number.isFinite(qty) ? qty : 0;
    if (safeQty === 1) return `1 ${noun}`;
    return `${safeQty || 0} ${noun}s`;
  };

  const describeSide = (side, qty, noun) => {
    if (qty <= 0) return `0 ${noun}s`;
    if (side.mode === "fixed") {
      if (side.items.length === 0) return `${pluralize(qty, noun)} (selected manually)`;
      if (side.items.length === 1) return `${pluralize(qty, noun)} of ${side.items.length} selected item`;
      return `${pluralize(qty, noun)} from ${side.items.length} selected items`;
    }
    if (side.allowAny) {
      return `any ${pluralize(qty, noun)}`;
    }
    if (side.items.length > 0) {
      return `${pluralize(qty, noun)} from selected items`;
    }
    return `any ${pluralize(qty, noun)}`;
  };

  const buyText = describeSide(selection.buy, buyQty, "item");
  const freeText = describeSide(selection.free, freeQty, "item");
  const priceCapText = selection.free.priceCap
    ? ` (up to ₹${selection.free.priceCap} each)`
    : "";

  const baseSummary = `Customer buys ${buyText}, gets ${freeText} free${priceCapText}.`;
  const priceLogic = " Paid items are charged on higher-priced selections, free items apply to the lowest-priced eligible items.";
  return `${baseSummary}${priceLogic}`;
};

const TemplateConfigFields = ({ offer, idx, updateConfigField, updateOfferField, combos, menuItems, groupedMenuItems }) => {
  const cfg = sanitizeConfig(offer.config);

  const selectTargetItems = (values) => {
    const existing = new Map((Array.isArray(cfg.targetItems) ? cfg.targetItems : []).map((item) => [String(item.id), item]));
    const normalized = values.map((value) => {
      const key = String(value);
      if (existing.has(key)) {
        return { ...existing.get(key), id: key };
      }
      const custom = CUSTOM_TARGET_ITEM_OPTIONS.find((opt) => opt.value === key);
      if (custom) {
        return { id: key, label: custom.label, section: 'Custom' };
      }
      const match = menuItems.find((item) => String(item.id) === key);
      return {
        id: key,
        label: match?.name || '',
        section: match?.section || null
      };
    });
    const hasCustom = normalized.some((item) => typeof item.id === 'string' && item.id.startsWith('custom-target-'));
    const finalList = hasCustom ? normalized.filter((item) => typeof item.id === 'string' && item.id.startsWith('custom-target-')) : normalized;
    updateConfigField(idx, 'targetItems', finalList);
  };

  const handleTargetItemToggle = (value, checked) => {
    const current = Array.isArray(cfg.targetItems) ? cfg.targetItems.map((item) => item.id) : [];
    let next;
    if (checked) {
      next = [...new Set([...current, value])];
    } else {
      next = current.filter((id) => id !== value);
    }
    selectTargetItems(next);
  };

  const selectFreeItems = (values) => {
    const existing = new Map((Array.isArray(cfg.freeItems) ? cfg.freeItems : []).map((item) => [String(item.id), item]));
    const normalized = values.map((value) => {
      const key = String(value);
      if (existing.has(key)) {
        const preserved = existing.get(key);
        return {
          id: key,
          label: preserved?.label || '',
          price: preserved?.price || '',
          quantity: preserved?.quantity || ''
        };
      }
      const custom = CUSTOM_FREE_ITEM_OPTIONS.find((opt) => opt.value === key);
      if (custom) {
        return { id: key, label: custom.label, price: '', quantity: '' };
      }
      const match = menuItems.find((item) => String(item.id) === key);
      return {
        id: key,
        label: match?.name || '',
        price: match && match.price != null ? String(match.price) : '',
        quantity: ''
      };
    });
    const hasCustom = normalized.some((item) => typeof item.id === 'string' && item.id.startsWith('custom-'));
    const finalList = hasCustom ? normalized.filter((item) => typeof item.id === 'string' && item.id.startsWith('custom-')) : normalized;
    updateConfigField(idx, 'freeItems', finalList);

    const primary = finalList[0]?.id || '';
    updateConfigField(idx, 'freeItemId', primary);
    if (!primary || (typeof primary === 'string' && primary.startsWith('custom-'))) {
      updateConfigField(idx, 'freeItemLabel', finalList[0]?.label || '');
      updateConfigField(idx, 'freeItemPrice', finalList[0]?.price || '');
      return;
    }
    const primaryEntry = CUSTOM_FREE_ITEM_OPTIONS.find((opt) => opt.value === primary);
    if (primaryEntry) {
      updateConfigField(idx, 'freeItemLabel', primaryEntry.label);
      updateConfigField(idx, 'freeItemPrice', '');
      return;
    }
    const match = menuItems.find((item) => String(item.id) === primary);
    updateConfigField(idx, 'freeItemLabel', match?.name || '');
    updateConfigField(idx, 'freeItemPrice', match && match.price != null ? String(match.price) : '');
  };

  const handleFreeItemToggle = (value, checked) => {
    const current = Array.isArray(cfg.freeItems) ? cfg.freeItems.map((item) => item.id) : [];
    let next;
    if (checked) {
      next = [...new Set([...current, value])];
    } else {
      next = current.filter((id) => id !== value);
    }
    selectFreeItems(next);
    if (next.length === 0) {
      updateConfigField(idx, 'freeItemLabel', '');
      updateConfigField(idx, 'freeItemPrice', '');
    }
  };

  const handleComboSelection = (event) => {
    const selected = Array.from(event.target.selectedOptions || []).map((opt) => opt.value);
    updateOfferField(idx, 'applicableComboIds', selected);
  };

  const menuOptions = menuItems || [];
  const targetItemOptions = useMemo(() => {
    const customOpts = CUSTOM_TARGET_ITEM_OPTIONS.map((opt) => ({
      value: opt.value,
      label: opt.label,
      helper: 'Custom'
    }));
    const menuOpts = menuOptions.map((item) => ({
      value: String(item.id),
      label: item.name,
      helper: item.section ? item.section : null
    }));
    return [...customOpts, ...menuOpts];
  }, [menuOptions]);
  const freeItemOptions = useMemo(() => {
    const customOpts = CUSTOM_FREE_ITEM_OPTIONS.map((opt) => ({
      value: opt.value,
      label: opt.label,
      helper: 'Custom'
    }));
    const menuOpts = menuOptions.map((item) => ({
      value: String(item.id),
      label: item.name,
      helper: item.section ? item.section : null
    }));
    return [...customOpts, ...menuOpts];
  }, [menuOptions]);
  const selectedComboIds = Array.isArray(offer.applicableComboIds) ? offer.applicableComboIds.map(String) : [];
  const selectedTargetItemIds = Array.isArray(cfg.targetItems) ? cfg.targetItems.map((item) => item.id) : (Array.isArray(cfg.targetItemIds) ? cfg.targetItemIds.map((id) => String(id)) : []);
  const selectedFreeItemIds = Array.isArray(cfg.freeItems) ? cfg.freeItems.map((item) => item.id) : (cfg.freeItemId ? [cfg.freeItemId] : []);

  const renderTargetItemChoices = (label) => (
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', padding: '6px 8px', border: '1px solid #dfe4ea', borderRadius: 6 }}>
        {targetItemOptions.map((option) => (
          <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={selectedTargetItemIds.includes(option.value)}
              onChange={(e) => handleTargetItemToggle(option.value, e.target.checked)}
            />
            <span>
              {option.label}
              {option.helper ? (
                <span style={{ marginLeft: 6, fontSize: 11, color: '#7f8c8d' }}>({option.helper})</span>
              ) : null}
            </span>
          </label>
        ))}
        {targetItemOptions.length === 0 && (
          <span style={{ fontSize: 12, color: '#c0392b' }}>No items available.</span>
        )}
      </div>
    </div>
  );

  const renderFreeItemChoices = (label) => (
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', padding: '6px 8px', border: '1px solid #dfe4ea', borderRadius: 6 }}>
        {freeItemOptions.map((option) => (
          <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={selectedFreeItemIds.includes(option.value)}
              onChange={(e) => handleFreeItemToggle(option.value, e.target.checked)}
            />
            <span>
              {option.label}
              {option.helper ? (
                <span style={{ marginLeft: 6, fontSize: 11, color: '#7f8c8d' }}>({option.helper})</span>
              ) : null}
            </span>
          </label>
        ))}
        {freeItemOptions.length === 0 && (
          <span style={{ fontSize: 12, color: '#c0392b' }}>No items available.</span>
        )}
      </div>
      {Array.isArray(cfg.freeItems) && cfg.freeItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#7f8c8d' }}>Selected Free Items</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {cfg.freeItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #d1d8e0', borderRadius: 6, padding: '6px 10px', background: '#f7f9fc', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{item.label || item.id}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#7f8c8d' }}>Qty</div>
                    <input
                      type="number"
                      value={item.quantity || cfg.freeQuantity || '1'}
                      onChange={(e) => updateConfigField(idx, 'freeItems', cfg.freeItems.map((fi) => fi.id === item.id ? { ...fi, quantity: e.target.value } : fi))}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#7f8c8d' }}>Price</div>
                    <input
                      type="number"
                      value={item.price || ''}
                      onChange={(e) => updateConfigField(idx, 'freeItems', cfg.freeItems.map((fi) => fi.id === item.id ? { ...fi, price: e.target.value } : fi))}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <input
                  value={item.label || ''}
                  onChange={(e) => updateConfigField(idx, 'freeItems', cfg.freeItems.map((fi) => fi.id === item.id ? { ...fi, label: e.target.value } : fi))}
                  placeholder="Display label"
                  style={{ width: '100%' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  switch (offer.template) {
    case "percent_order":
      return (
        <>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Minimum Order Amount</div>
            <input
              type="number"
              value={cfg.minTotal}
              onChange={(e) => updateConfigField(idx, 'minTotal', e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Discount Percent</div>
            <input
              type="number"
              value={cfg.percent || offer.discountPercent || ''}
              onChange={(e) => updateConfigField(idx, 'percent', e.target.value)}
            />
          </div>
        </>
      );
    case "flat_order":
      return (
        <>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Minimum Order Amount</div>
            <input
              type="number"
              value={cfg.minTotal}
              onChange={(e) => updateConfigField(idx, 'minTotal', e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Flat Discount Amount</div>
            <input
              type="number"
              value={cfg.amount || offer.discountAmount || ''}
              onChange={(e) => updateConfigField(idx, 'amount', e.target.value)}
            />
          </div>
        </>
      );
    case "combo_buy_item_free":
      return (
        <>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Eligible Combos</div>
            <select
              multiple
              value={selectedComboIds}
              onChange={handleComboSelection}
              style={{ minHeight: 120 }}
            >
              {combos.map((combo) => (
                <option key={combo.id} value={String(combo.id)}>
                  {combo.name} ({combo.id})
                </option>
              ))}
            </select>
            {combos.length === 0 && (
              <div style={{ fontSize: 12, color: '#c0392b', marginTop: 4 }}>
                No combos available. Add combos first to use this template.
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Buy Quantity</div>
            <input
              type="number"
              value={cfg.buyQuantity || '1'}
              onChange={(e) => updateConfigField(idx, 'buyQuantity', e.target.value)}
            />
          </div>
          {renderFreeItemChoices('Free Item')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>Free Quantity</div>
            <input
              type="number"
              value={cfg.freeQuantity}
              onChange={(e) => updateConfigField(idx, 'freeQuantity', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>Optional Free Item Label</div>
            <input
              value={cfg.freeItemLabel}
              onChange={(e) => updateConfigField(idx, 'freeItemLabel', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>Optional Free Item Price</div>
            <input
              type="number"
              value={cfg.freeItemPrice}
              onChange={(e) => updateConfigField(idx, 'freeItemPrice', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </>
      );
    case "item_buy_x_get_y":
      return (
        <>
          {renderTargetItemChoices('Target Items (Buy)')}
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Buy Quantity</div>
            <input
              type="number"
              value={cfg.buyQuantity}
              onChange={(e) => updateConfigField(idx, 'buyQuantity', e.target.value)}
            />
          </div>
          {renderFreeItemChoices('Free Item')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>Free Quantity</div>
            <input
              type="number"
              value={cfg.freeQuantity}
              onChange={(e) => updateConfigField(idx, 'freeQuantity', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>Optional Free Item Label</div>
            <input
              value={cfg.freeItemLabel}
              onChange={(e) => updateConfigField(idx, 'freeItemLabel', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>Optional Free Item Price</div>
            <input
              type="number"
              value={cfg.freeItemPrice}
              onChange={(e) => updateConfigField(idx, 'freeItemPrice', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </>
      );
    default:
      return null;
  }
};

const sanitizeConfig = (config = {}) => {
  const template = config.template != null ? String(config.template) : "";
  const rawTargetItemIds = Array.isArray(config.targetItemIds) ? config.targetItemIds : [];
  const rawTargetItems = Array.isArray(config.targetItems) ? config.targetItems : [];
  const rawFreeItems = Array.isArray(config.freeItems) ? config.freeItems : [];

  const targetLookup = new Map();
  rawTargetItems.forEach((item) => {
    const id = item?.id != null ? String(item.id) : (item?.value != null ? String(item.value) : "");
    if (!id) return;
    if (!targetLookup.has(id)) {
      targetLookup.set(id, {
        id,
        label: item?.label != null ? String(item.label) : "",
        section: item?.section != null ? String(item.section) : ""
      });
    }
  });

  const freeLookup = new Map();
  rawFreeItems.forEach((item) => {
    const id = item?.id != null ? String(item.id) : (item?.value != null ? String(item.value) : "");
    if (!id) return;
    if (!freeLookup.has(id)) {
      freeLookup.set(id, {
        id,
        label: item?.label != null ? String(item.label) : "",
        price: item?.price != null && item.price !== "" ? String(item.price) : "",
        quantity: item?.quantity != null && item.quantity !== "" ? String(item.quantity) : ""
      });
    }
  });

  let normalizedTargetItems = Array.from(targetLookup.values());
  if (!normalizedTargetItems.length && rawTargetItemIds.length > 0) {
    rawTargetItemIds.forEach((id) => {
      const strId = String(id);
      if (!strId || targetLookup.has(strId)) return;
      normalizedTargetItems.push({ id: strId, label: "", section: "" });
    });
  }

  let normalizedFreeItems = Array.from(freeLookup.values());

  const selection = hydrateSelection(
    config.selection,
    normalizedTargetItems,
    normalizedFreeItems
  );

  if (selection.buy.mode === "custom") {
    if (selection.buy.allowAny) {
      normalizedTargetItems = [];
    } else if (selection.buy.items.length > 0) {
      normalizedTargetItems = selection.buy.items.map((id) => {
        const key = String(id);
        return targetLookup.get(key) || { id: key, label: "", section: "" };
      });
    }
  }

  if (selection.free.mode === "custom") {
    if (selection.free.allowAny) {
      normalizedFreeItems = [];
    } else if (selection.free.items.length > 0 && normalizedFreeItems.length === 0) {
      normalizedFreeItems = selection.free.items.map((id) => {
        const key = String(id);
        return freeLookup.get(key) || { id: key, label: "", price: "", quantity: "" };
      });
    }
  }

  let legacyFreeItemId = config.freeItemId != null ? String(config.freeItemId) : "";
  let legacyFreeItemLabel = config.freeItemLabel != null ? String(config.freeItemLabel) : "";
  let legacyFreeItemPrice = config.freeItemPrice != null ? String(config.freeItemPrice) : "";

  if (!normalizedFreeItems.length && legacyFreeItemId) {
    normalizedFreeItems.push({
      id: legacyFreeItemId,
      label: legacyFreeItemLabel,
      price: legacyFreeItemPrice,
      quantity: config.freeQuantity != null ? String(config.freeQuantity) : ""
    });
  }

  const primaryFreeItem = normalizedFreeItems[0];
  legacyFreeItemId = primaryFreeItem?.id || legacyFreeItemId;
  legacyFreeItemLabel = primaryFreeItem?.label || legacyFreeItemLabel;
  legacyFreeItemPrice = primaryFreeItem?.price || legacyFreeItemPrice;

  let targetItemIds = normalizedTargetItems.map((item) => {
    const num = Number(item.id);
    return Number.isFinite(num) ? num : item.id;
  });

  if (selection.buy.mode === "custom") {
    if (selection.buy.allowAny) {
      targetItemIds = [CUSTOM_ANY_TOKEN];
    } else if (selection.buy.items.length > 0) {
      targetItemIds = selection.buy.items.map((value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : String(value);
      });
    }
  }

  const hasWildcardTargets = targetItemIds.some((id) => typeof id === "string" && (id.startsWith("custom-target-") || id === CUSTOM_ANY_TOKEN));

  const summaryText = buildSelectionSummary({
    ...config,
    selection,
    buyQuantity: config.buyQuantity,
    freeQuantity: config.freeQuantity
  });

  return {
    template,
    minTotal: config.minTotal != null ? String(config.minTotal) : "",
    percent: config.percent != null ? String(config.percent) : "",
    amount: config.amount != null ? String(config.amount) : "",
    buyQuantity: config.buyQuantity != null ? String(config.buyQuantity) : "",
    freeQuantity: config.freeQuantity != null ? String(config.freeQuantity) : "1",
    freeItemId: legacyFreeItemId,
    freeItemLabel: legacyFreeItemLabel,
    freeItemPrice: legacyFreeItemPrice,
    freeItems: normalizedFreeItems,
    targetItems: normalizedTargetItems,
    targetItemIds,
    targetMatchMode: hasWildcardTargets
      ? (targetItemIds.some((id) => Number.isFinite(Number(id))) ? "mixed" : "any")
      : "specific",
    discountPercent: config.discountPercent != null ? String(config.discountPercent) : "",
    selection,
    summaryText
  };
};

const buildConditionsAndRewards = (offer) => {
  const cfg = sanitizeConfig(offer.config);
  const conditions = [];
  const rewards = [];

  const minTotalValue = Number(cfg.minTotal);
  if (!Number.isNaN(minTotalValue) && minTotalValue > 0) {
    conditions.push({ type: "min_total", amount: minTotalValue });
  }

  const sections = Array.isArray(offer.applicableSections) ? offer.applicableSections : [];
  const combos = Array.isArray(offer.applicableComboIds) ? offer.applicableComboIds.map(String) : [];

  switch (offer.template) {
    case "percent_order": {
      const percent = Number(cfg.percent || offer.discountPercent || 0);
      if (percent > 0) {
        rewards.push({
          type: "percentage_discount",
          percent,
          appliesTo: sections.length > 0 ? "sections" : "order",
          sections: sections.length > 0 ? sections : undefined,
        });
      }
      break;
    }
    case "flat_order": {
      const amount = Number(cfg.amount || offer.discountAmount || 0);
      if (amount > 0) {
        rewards.push({
          type: "fixed_discount",
          amount,
          appliesTo: sections.length > 0 ? "sections" : "order",
          sections: sections.length > 0 ? sections : undefined,
        });
      }
      break;
    }
    case "combo_buy_x_get_y": {
      const buyQty = Number(cfg.buyQuantity || 0);
      if (combos.length > 0 && buyQty > 0) {
        conditions.push({
          type: "combo_quantity",
          comboIds: combos,
          minQuantity: buyQty
        });
      }
      if (cfg.discountPercent) {
        const percent = Number(cfg.discountPercent || 0);
        if (percent > 0) {
          rewards.push({
            type: "percentage_discount",
            percent,
            appliesTo: "order"
          });
        }
      }
      const freeItemId = Number(cfg.freeItemId || 0);
      const freeQty = Number(cfg.freeQuantity || 1);
      const freePrice = Number(cfg.freeItemPrice || 0);
      if (freeItemId > 0 && freeQty > 0) {
        const reward = {
          type: "free_item",
          itemId: freeItemId,
          quantity: freeQty,
        };
        if (!Number.isNaN(freePrice) && freePrice > 0) reward.price = freePrice;
        if (cfg.freeItemLabel) reward.description = cfg.freeItemLabel;
        rewards.push(reward);
      }
      break;
    }
    case "combo_buy_item_free": {
      const buyQty = Number(cfg.buyQuantity || 1);
      if (combos.length > 0 && buyQty > 0) {
        conditions.push({
          type: "combo_quantity",
          comboIds: combos,
          minQuantity: buyQty
        });
      }
      const freeItems = Array.isArray(cfg.freeItems) && cfg.freeItems.length > 0
        ? cfg.freeItems
        : (cfg.freeItemId
            ? [{ id: cfg.freeItemId, label: cfg.freeItemLabel, price: cfg.freeItemPrice, quantity: cfg.freeQuantity }]
            : []);
      freeItems.forEach((entry) => {
        if (!entry || entry.id == null) return;
        const idString = String(entry.id);
        const isCustom = idString.startsWith('custom-');
        const numericId = Number(idString);
        const itemId = !isCustom && Number.isFinite(numericId) ? numericId : idString;
        if (!itemId) return;
        const quantityRaw = entry.quantity != null ? entry.quantity : cfg.freeQuantity;
        const quantityNum = Number(quantityRaw || 1);
        const quantity = Number.isFinite(quantityNum) && quantityNum > 0 ? quantityNum : 1;
        const priceNum = Number(entry.price || 0);
        const reward = {
          type: "free_item",
          itemId,
          quantity
        };
        if (!Number.isNaN(priceNum) && priceNum > 0) reward.price = priceNum;
        const description = entry.label || (isCustom ? idString.replace('custom-', 'Custom ') : '');
        if (description) reward.description = description;
        rewards.push(reward);
      });
      break;
    }
    case "item_buy_x_get_y": {
      const targetIds = Array.isArray(cfg.targetItemIds) ? cfg.targetItemIds : [];
      const buyQty = Number(cfg.buyQuantity || 0);
      if (buyQty > 0 && targetIds.length > 0) {
        conditions.push({
          type: "item_quantity",
          itemIds: targetIds,
          minQuantity: buyQty
        });
      }
      const selection = cfg.selection || buildSelectionDefaults();
      const freeQty = Number(cfg.freeQuantity || 0);

      const isCustomSelection = selection.buy.mode === 'custom' || selection.free.mode === 'custom' || selection.free.allowAny || selection.buy.allowAny;
      if (isCustomSelection && freeQty > 0) {
        const reward = {
          type: "custom_free_selection",
          quantity: freeQty,
          selection: {
            buy: {
              mode: selection.buy.mode,
              allowAny: Boolean(selection.buy.allowAny),
              priceCap: selection.buy.priceCap,
              items: Array.isArray(selection.buy.items) ? selection.buy.items : []
            },
            free: {
              mode: selection.free.mode,
              allowAny: Boolean(selection.free.allowAny),
              priceCap: selection.free.priceCap,
              items: Array.isArray(selection.free.items) ? selection.free.items : []
            }
          },
          description: cfg.summaryText
        };
        if (selection.free.priceCap != null && selection.free.priceCap !== "") {
          const capNum = Number(selection.free.priceCap);
          if (Number.isFinite(capNum) && capNum >= 0) {
            reward.maxPrice = capNum;
          }
        }
        rewards.push(reward);
      } else {
        const freeItems = Array.isArray(cfg.freeItems) && cfg.freeItems.length > 0
          ? cfg.freeItems
          : (cfg.freeItemId
              ? [{ id: cfg.freeItemId, label: cfg.freeItemLabel, price: cfg.freeItemPrice, quantity: cfg.freeQuantity }]
              : []);
        freeItems.forEach((entry) => {
          if (!entry || entry.id == null) return;
          const idString = String(entry.id);
          const isCustom = idString.startsWith('custom-');
          const numericId = Number(idString);
          const itemId = !isCustom && Number.isFinite(numericId) ? numericId : idString;
          if (!itemId) return;
          const quantityRaw = entry.quantity != null ? entry.quantity : cfg.freeQuantity;
          const quantityNum = Number(quantityRaw || 1);
          const quantity = Number.isFinite(quantityNum) && quantityNum > 0 ? quantityNum : 1;
          const priceNum = Number(entry.price || 0);
          const reward = {
            type: "free_item",
            itemId,
            quantity
          };
          if (!Number.isNaN(priceNum) && priceNum > 0) reward.price = priceNum;
          const description = entry.label || (isCustom ? idString.replace('custom-', 'Custom ') : '');
          if (description) reward.description = description;
          rewards.push(reward);
        });
      }
      break;
    }
    default:
      break;
  }

  const snapshot = { ...cfg, template: offer.template };
  return { conditions, rewards, configSnapshot: snapshot };
};

const adaptOffer = (offer = {}) => {
  const conditions = Array.isArray(offer.conditions) ? offer.conditions : [];
  const rewards = Array.isArray(offer.rewards) ? offer.rewards : [];
  const config = sanitizeConfig(offer.config);

  if (!config.minTotal) {
    const cond = conditions.find((c) => c.type === "min_total");
    if (cond?.amount != null) config.minTotal = String(cond.amount);
  }

  const comboCond = conditions.find((c) => c.type === "combo_quantity");
  if (comboCond) {
    if (comboCond.minQuantity != null) config.buyQuantity = String(comboCond.minQuantity);
  }

  const itemCond = conditions.find((c) => c.type === "item_quantity");
  if (itemCond) {
    if (itemCond.minQuantity != null) config.buyQuantity = String(itemCond.minQuantity);
    if ((!Array.isArray(config.targetItems) || config.targetItems.length === 0) && Array.isArray(itemCond.itemIds)) {
      const unique = new Set();
      const mapped = [];
      itemCond.itemIds.forEach((rawId) => {
        const id = rawId != null ? String(rawId) : "";
        if (!id || unique.has(id)) return;
        unique.add(id);
        mapped.push({ id, label: config.targetItems?.find((ti) => String(ti.id) === id)?.label || "", section: config.targetItems?.find((ti) => String(ti.id) === id)?.section || "" });
      });
      if (mapped.length > 0) {
        config.targetItems = mapped;
      }
    }
    if ((!Array.isArray(config.targetItemIds) || config.targetItemIds.length === 0) && Array.isArray(itemCond.itemIds)) {
      config.targetItemIds = itemCond.itemIds.map((rawId) => {
        const idNum = Number(rawId);
        return Number.isFinite(idNum) ? idNum : String(rawId);
      });
    }
  }

  const percentReward = rewards.find((r) => r.type === "percentage_discount");
  if (percentReward && percentReward.percent != null) {
    const val = String(percentReward.percent);
    if (!config.percent) config.percent = val;
    if (!config.discountPercent) config.discountPercent = val;
  }

  const fixedReward = rewards.find((r) => r.type === "fixed_discount");
  if (fixedReward && fixedReward.amount != null) {
    config.amount = config.amount || String(fixedReward.amount);
  }

  const freeRewards = rewards.filter((r) => r.type === "free_item");
  if (freeRewards.length > 0 && (!Array.isArray(config.freeItems) || config.freeItems.length === 0)) {
    const mapped = [];
    const seen = new Set();
    freeRewards.forEach((reward) => {
      const rawId = reward.itemId != null ? reward.itemId : reward.description || "";
      const id = rawId != null ? String(rawId) : "";
      if (!id || seen.has(id)) return;
      seen.add(id);
      mapped.push({
        id,
        label: reward.description || "",
        price: reward.price != null ? String(reward.price) : "",
        quantity: reward.quantity != null ? String(reward.quantity) : ""
      });
    });
    if (mapped.length > 0) {
      config.freeItems = mapped;
    }
  }
  const primaryReward = freeRewards[0];
  if (primaryReward) {
    if (primaryReward.itemId != null) config.freeItemId = String(primaryReward.itemId);
    else if (!config.freeItemId && primaryReward.description) config.freeItemId = primaryReward.description;
    if (primaryReward.quantity != null) config.freeQuantity = String(primaryReward.quantity);
    if (primaryReward.price != null) config.freeItemPrice = String(primaryReward.price);
    if (primaryReward.description) config.freeItemLabel = primaryReward.description;
  }

  let template = offer.template;
  if (!template && offer.metadata?.configSnapshot?.template) {
    template = offer.metadata.configSnapshot.template;
  }
  if (!template) {
    if (comboCond || (Array.isArray(offer.applicableComboIds) && offer.applicableComboIds.length > 0)) {
      template = "combo_buy_item_free";
    } else if (itemCond) {
      template = "item_buy_x_get_y";
    } else if (offer.discountAmount != null && offer.discountAmount !== "") {
      template = "flat_order";
    } else {
      template = "percent_order";
    }
  }

  if (!config.percent && offer.discountPercent != null) {
    config.percent = String(offer.discountPercent);
  }
  if (!config.amount && offer.discountAmount != null) {
    config.amount = String(offer.discountAmount);
  }

  return {
    ...offer,
    template,
    config: { ...config, template },
    applicableSections: Array.isArray(offer.applicableSections) ? offer.applicableSections : [],
    applicableComboIds: Array.isArray(offer.applicableComboIds) ? offer.applicableComboIds : [],
  };
};

/**
 * VendorOffers
 * CRUD panel for managing special offers for the vendor's shop.
 * @param {{ token: string }} props
 */
const VendorOffers = ({ token }) => {
  const vendorShopId = useMemo(() => {
    try { return JSON.parse(atob(token.split(".")[1])).shopId || 1; } catch { return 1; }
  }, [token]);

  const [offers, setOffers] = useState([]);
  const [sections, setSections] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [off, sec, cmb] = await Promise.all([
        fetchOffers(vendorShopId),
        fetchMenuSections(vendorShopId),
        fetchCombos(vendorShopId, false)
      ]);
      setOffers(Array.isArray(off) ? off.map(adaptOffer) : []);
      const sectionNames = Array.isArray(sec?.sections) ? sec.sections.map((s) => s.name) : [];
      setSections(sectionNames);
      if (Array.isArray(sec?.sections)) {
        const itemsFlat = [];
        sec.sections.forEach((section) => {
          if (!Array.isArray(section.items)) return;
          section.items.forEach((item) => {
            itemsFlat.push({
              id: item.id,
              name: item.name,
              price: item.price,
              section: section.name,
            });
          });
        });
        setMenuItems(itemsFlat);
      } else {
        setMenuItems([]);
      }
      setCombos(Array.isArray(cmb) ? cmb : []);
    } catch {
      setOffers([]); setSections([]); setCombos([]);
      setMenuItems([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [vendorShopId]);

  const addOffer = () => {
    setOffers(prev => ([{
      id: Date.now(),
      shopId: vendorShopId,
      title: "New Offer",
      bannerText: "New Offer",
      discountPercent: 0,
      discountAmount: null,
      applicableSections: [],
      applicableComboIds: [],
      start: "",
      end: "",
      active: true,
      stackable: true,
      maxDiscountAmount: null,
      template: "percent_order",
      config: sanitizeConfig({ template: "percent_order", percent: "5", freeItems: [] })
    }, ...prev]));
  };

  const groupedMenuItems = useMemo(() => {
    if (!Array.isArray(menuItems) || menuItems.length === 0) return [];
    const grouped = new Map();
    menuItems.forEach((item) => {
      const section = item.section || "All Items";
      if (!grouped.has(section)) grouped.set(section, []);
      grouped.get(section).push(item);
    });
    return Array.from(grouped.entries()).map(([section, items]) => ({ section, items }));
  }, [menuItems]);

  const updateField = (idx, field, value) => {
    setOffers(prev => {
      const next = [...prev];
      const current = { ...next[idx] };
      if (field === 'template') {
        const defaults = {
          percent_order: { template: 'percent_order', percent: current.config?.percent || current.discountPercent || "10", minTotal: current.config?.minTotal || "", freeItems: current.config?.freeItems || [] },
          flat_order: { template: 'flat_order', amount: current.config?.amount || current.discountAmount || "20", minTotal: current.config?.minTotal || "", freeItems: current.config?.freeItems || [] },
          combo_buy_item_free: { template: 'combo_buy_item_free', buyQuantity: current.config?.buyQuantity || "1", freeQuantity: current.config?.freeQuantity || "1", freeItems: current.config?.freeItems || (current.config?.freeItemId ? [{ id: current.config.freeItemId, label: current.config.freeItemLabel, price: current.config.freeItemPrice }] : []) },
          item_buy_x_get_y: { template: 'item_buy_x_get_y', buyQuantity: current.config?.buyQuantity || "3", freeQuantity: current.config?.freeQuantity || "1", freeItems: current.config?.freeItems || (current.config?.freeItemId ? [{ id: current.config.freeItemId, label: current.config.freeItemLabel, price: current.config.freeItemPrice }] : []), targetItemIds: current.config?.targetItemIds || [] }
        };
        current.template = value;
        const baseConfig = sanitizeConfig(defaults[value] || {});
        current.config = { ...baseConfig, template: value };
      } else {
        current[field] = value;
      }
      next[idx] = current;
      return next;
    });
  };

  const updateConfigField = (idx, field, value) => {
    setOffers(prev => {
      const next = [...prev];
      const current = { ...next[idx] };
      const config = sanitizeConfig(current.config);
      if (field === 'targetItemIds') {
        config.targetItemIds = Array.isArray(value) ? value.map((id) => Number(id)).filter((id) => Number.isFinite(id)) : [];
      } else if (field === 'targetItems') {
        const items = Array.isArray(value) ? value : [];
        const normalizedItems = [];
        const seen = new Set();
        items.forEach((item) => {
          const id = item?.id != null ? String(item.id) : (item?.value != null ? String(item.value) : '');
          if (!id || seen.has(id)) return;
          seen.add(id);
          normalizedItems.push({
            id,
            label: item?.label != null ? String(item.label) : '',
            section: item?.section != null ? String(item.section) : ''
          });
        });
        config.targetItems = normalizedItems;
        config.targetItemIds = normalizedItems.map((entry) => {
          const num = Number(entry.id);
          return Number.isFinite(num) ? num : entry.id;
        });
      } else if (field === 'freeItems') {
        config.freeItems = Array.isArray(value) ? value.map((item) => ({
          id: String(item?.id ?? item?.value ?? ''),
          label: item?.label != null ? String(item.label) : '',
          price: item?.price != null && item.price !== '' ? String(item.price) : ''
        })).filter((item) => item.id) : [];
      } else {
        config[field] = value;
      }
      config.template = current.template || config.template || "";
      if (field === 'percent' || field === 'discountPercent') {
        current.discountPercent = value;
      }
      if (field === 'amount') {
        current.discountAmount = value;
      }
      current.config = config;
      next[idx] = current;
      return next;
    });
  };

  const toggleArrayValue = (idx, field, value) => {
    setOffers(prev => {
      const next = [...prev];
      const arr = Array.isArray(next[idx][field]) ? [...next[idx][field]] : [];
      const i = arr.findIndex(v => String(v) === String(value));
      if (i >= 0) arr.splice(i, 1); else arr.push(value);
      next[idx] = { ...next[idx], [field]: arr };
      return next;
    });
  };

  const removeOffer = (idx) => {
    setOffers(prev => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    try {
      const cleaned = offers.map(o => {
        const { conditions, rewards, configSnapshot } = buildConditionsAndRewards(o);
        const discountPercent = (o.template === 'percent_order')
          ? (configSnapshot.percent ? Number(configSnapshot.percent) : null)
          : ((o.discountPercent == null || o.discountPercent === "") ? null : Number(o.discountPercent));
        const discountAmount = (o.template === 'flat_order')
          ? (configSnapshot.amount ? Number(configSnapshot.amount) : null)
          : ((o.discountAmount == null || o.discountAmount === "") ? null : Number(o.discountAmount));

        return {
          ...o,
          discountPercent,
          discountAmount,
          maxDiscountAmount: (o.maxDiscountAmount == null || o.maxDiscountAmount === "") ? null : Number(o.maxDiscountAmount),
          applicableSections: Array.isArray(o.applicableSections) ? o.applicableSections : [],
          applicableComboIds: Array.isArray(o.applicableComboIds) ? o.applicableComboIds.map((cid) => Number(cid)) : [],
          conditions,
          rewards,
          config: configSnapshot,
        };
      });
      const res = await updateOffers(cleaned, token);
      if (res && res.status === "success") {
        toast.success("Offers saved");
        await load();
      } else {
        toast.error(res?.message || "Failed to save offers");
      }
    } catch {
      toast.error("Error saving offers");
    }
  };

  return (
    <div>
      <h2>Manage Offers</h2>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <button onClick={addOffer}>+ Add Offer</button>
        <button onClick={save} style={{ background: '#27ae60' }}>Save Changes</button>
      </div>
      {loading && <div>Loading...</div>}
      {offers.map((o, idx) => (
        <div key={o.id} className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">{o.title || 'Offer'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Template</div>
              <select
                value={o.template || 'percent_order'}
                onChange={(e)=>updateField(idx,'template', e.target.value)}
                style={{ width: '100%', maxWidth: 260 }}
              >
                {TEMPLATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Title</div>
              <input
                value={o.title || ''}
                onChange={(e)=>updateField(idx,'title',e.target.value)}
                style={{ width: '100%', maxWidth: 260 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Banner Text</div>
              <input
                value={o.bannerText || ''}
                onChange={(e)=>updateField(idx,'bannerText',e.target.value)}
                style={{ width: '100%', maxWidth: 320 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Start (ISO)</div>
              <input
                placeholder="YYYY-MM-DDTHH:MM:SSZ"
                value={o.start || ''}
                onChange={(e)=>updateField(idx,'start',e.target.value)}
                style={{ width: '100%', maxWidth: 260 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>End (ISO)</div>
              <input
                placeholder="YYYY-MM-DDTHH:MM:SSZ"
                value={o.end || ''}
                onChange={(e)=>updateField(idx,'end',e.target.value)}
                style={{ width: '100%', maxWidth: 260 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label>
                <input type="checkbox" checked={o.active !== false} onChange={(e)=>updateField(idx,'active', e.target.checked)} /> Active
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label>
                <input type="checkbox" checked={o.stackable !== false} onChange={(e)=>updateField(idx,'stackable', e.target.checked)} /> Stackable
              </label>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Max Discount Cap</div>
              <input type="number" value={o.maxDiscountAmount ?? ''} onChange={(e)=>updateField(idx,'maxDiscountAmount', e.target.value)} />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Template Settings</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <TemplateConfigFields
                offer={o}
                idx={idx}
                updateConfigField={updateConfigField}
                updateOfferField={updateField}
                combos={combos}
                menuItems={menuItems}
                groupedMenuItems={groupedMenuItems}
              />
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Applicable Sections</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select
                  multiple
                  value={Array.isArray(o.applicableSections) ? o.applicableSections : []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions || []).map((opt) => opt.value);
                    updateField(idx, 'applicableSections', selected);
                  }}
                  style={{ minHeight: 120 }}
                >
                  {sections.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => updateField(idx, 'applicableSections', [])}
                  style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 12 }}
                  disabled={!Array.isArray(o.applicableSections) || o.applicableSections.length === 0}
                >
                  Clear Selection
                </button>
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Applicable Combos</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select
                  multiple
                  value={Array.isArray(o.applicableComboIds) ? o.applicableComboIds.map(String) : []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions || []).map((opt) => opt.value);
                    updateField(idx, 'applicableComboIds', selected);
                  }}
                  style={{ minHeight: 120 }}
                >
                  {combos.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name} ({c.id})</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => updateField(idx, 'applicableComboIds', [])}
                  style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 12 }}
                  disabled={!Array.isArray(o.applicableComboIds) || o.applicableComboIds.length === 0}
                >
                  Clear Selection
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button onClick={()=>removeOffer(idx)} style={{ background: '#e74c3c' }}>Remove Offer</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default VendorOffers;
