import React, { useEffect, useMemo, useState } from "react";
import { fetchOffers, fetchCombos, fetchMenuSections, updateOffers } from "../api";
import { toast } from "react-toastify";

const TEMPLATE_OPTIONS = [
  { value: "percent_order", label: "% Off Order / Sections" },
  { value: "flat_order", label: "Flat Discount" },
  { value: "combo_buy_x_get_y", label: "Combo – Buy X Get Free Item (legacy)" },
  { value: "combo_buy_item_free", label: "Combo – Buy Combo Get Item Free" },
  { value: "item_buy_x_get_y", label: "Menu Item – Buy X Get Y" }
];

const TemplateConfigFields = ({ offer, idx, updateConfigField, updateOfferField, combos, menuItems, groupedMenuItems }) => {
  const cfg = sanitizeConfig(offer.config);

  const handleTargetItemsChange = (event) => {
    const selected = Array.from(event.target.selectedOptions || []).map((opt) => Number(opt.value));
    updateConfigField(idx, 'targetItemIds', selected);
  };

  const handleFreeItemChange = (event) => {
    const value = event.target.value;
    updateConfigField(idx, 'freeItemId', value);
    if (!value) {
      updateConfigField(idx, 'freeItemLabel', '');
      updateConfigField(idx, 'freeItemPrice', '');
      return;
    }
    const match = menuItems.find((item) => String(item.id) === value);
    updateConfigField(idx, 'freeItemLabel', match?.name || '');
    updateConfigField(idx, 'freeItemPrice', match && match.price != null ? String(match.price) : '');
  };

  const handleComboSelection = (event) => {
    const selected = Array.from(event.target.selectedOptions || []).map((opt) => opt.value);
    updateOfferField(idx, 'applicableComboIds', selected);
  };

  const menuOptions = menuItems || [];
  const selectedComboIds = Array.isArray(offer.applicableComboIds) ? offer.applicableComboIds.map(String) : [];

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
    case "combo_buy_x_get_y":
      return (
        <>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Minimum Combo Quantity</div>
            <input
              type="number"
              value={cfg.buyQuantity}
              onChange={(e) => updateConfigField(idx, 'buyQuantity', e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Free Item ID</div>
            <input
              type="number"
              value={cfg.freeItemId}
              onChange={(e) => updateConfigField(idx, 'freeItemId', e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Free Quantity</div>
            <input
              type="number"
              value={cfg.freeQuantity}
              onChange={(e) => updateConfigField(idx, 'freeQuantity', e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Optional Free Item Label</div>
            <input
              value={cfg.freeItemLabel}
              onChange={(e) => updateConfigField(idx, 'freeItemLabel', e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Optional Free Item Price</div>
            <input
              type="number"
              value={cfg.freeItemPrice}
              onChange={(e) => updateConfigField(idx, 'freeItemPrice', e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Optional Extra Discount %</div>
            <input
              type="number"
              value={cfg.discountPercent}
              onChange={(e) => updateConfigField(idx, 'discountPercent', e.target.value)}
            />
          </div>
          {combos.length === 0 && (
            <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#c0392b' }}>
              Tip: Add combos first from the Combos tab to use this template.
            </div>
          )}
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
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>Free Item</div>
            <select value={cfg.freeItemId} onChange={handleFreeItemChange} style={{ width: '100%', minHeight: 32 }}>
              <option value="">-- Select Item --</option>
              {menuOptions.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name} {item.section ? `(${item.section})` : ''}
                </option>
              ))}
            </select>
          </div>
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
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Target Items (Buy)</div>
            <select
              multiple
              value={Array.isArray(cfg.targetItemIds) ? cfg.targetItemIds.map(String) : []}
              onChange={handleTargetItemsChange}
              style={{ minHeight: 120 }}
            >
              {groupedMenuItems.map(({ section, items }) => (
                <optgroup key={section || 'Ungrouped'} label={section || 'All Items'}>
                  {items.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {menuOptions.length === 0 && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 4 }}>Add menu items first to configure item-based offers.</div>}
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Buy Quantity</div>
            <input
              type="number"
              value={cfg.buyQuantity}
              onChange={(e) => updateConfigField(idx, 'buyQuantity', e.target.value)}
            />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 0 }}>Free Item</div>
            <select value={cfg.freeItemId} onChange={handleFreeItemChange} style={{ width: '100%', minHeight: 32 }}>
              <option value="">-- Select Item --</option>
              {menuOptions.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.name} {item.section ? `(${item.section})` : ''}
                </option>
              ))}
            </select>
          </div>
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
  const targetItemIds = Array.isArray(config.targetItemIds)
    ? config.targetItemIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];

  return {
    template,
    minTotal: config.minTotal != null ? String(config.minTotal) : "",
    percent: config.percent != null ? String(config.percent) : "",
    amount: config.amount != null ? String(config.amount) : "",
    buyQuantity: config.buyQuantity != null ? String(config.buyQuantity) : "",
    freeQuantity: config.freeQuantity != null ? String(config.freeQuantity) : "1",
    freeItemId: config.freeItemId != null ? String(config.freeItemId) : "",
    freeItemLabel: config.freeItemLabel != null ? String(config.freeItemLabel) : "",
    freeItemPrice: config.freeItemPrice != null ? String(config.freeItemPrice) : "",
    discountPercent: config.discountPercent != null ? String(config.discountPercent) : "",
    targetItemIds
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
      const freeItemId = Number(cfg.freeItemId || 0);
      const freeQty = Number(cfg.freeQuantity || 1);
      const freePrice = Number(cfg.freeItemPrice || 0);
      if (freeItemId > 0 && freeQty > 0) {
        const reward = {
          type: "free_item",
          itemId: freeItemId,
          quantity: freeQty
        };
        if (!Number.isNaN(freePrice) && freePrice > 0) reward.price = freePrice;
        if (cfg.freeItemLabel) reward.description = cfg.freeItemLabel;
        rewards.push(reward);
      }
      break;
    }
    case "item_buy_x_get_y": {
      const targetIds = Array.isArray(cfg.targetItemIds) ? cfg.targetItemIds : [];
      const buyQty = Number(cfg.buyQuantity || 0);
      if (targetIds.length > 0 && buyQty > 0) {
        conditions.push({
          type: "item_quantity",
          itemIds: targetIds,
          minQuantity: buyQty
        });
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
    if (Array.isArray(itemCond.itemIds) && itemCond.itemIds.length > 0) {
      config.targetItemIds = itemCond.itemIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
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

  const freeReward = rewards.find((r) => r.type === "free_item");
  if (freeReward) {
    if (freeReward.itemId != null) config.freeItemId = String(freeReward.itemId);
    if (freeReward.quantity != null) config.freeQuantity = String(freeReward.quantity);
    if (freeReward.price != null) config.freeItemPrice = String(freeReward.price);
    if (freeReward.description) config.freeItemLabel = freeReward.description;
  }

  let template = offer.template;
  if (!template && offer.metadata?.configSnapshot?.template) {
    template = offer.metadata.configSnapshot.template;
  }
  if (!template) {
    if (comboCond || (Array.isArray(offer.applicableComboIds) && offer.applicableComboIds.length > 0)) {
      template = "combo_buy_x_get_y";
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
      config: sanitizeConfig({ template: "percent_order", percent: "5" })
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
          percent_order: { template: 'percent_order', percent: current.config?.percent || current.discountPercent || "10", minTotal: current.config?.minTotal || "" },
          flat_order: { template: 'flat_order', amount: current.config?.amount || current.discountAmount || "20", minTotal: current.config?.minTotal || "" },
          combo_buy_x_get_y: { template: 'combo_buy_x_get_y', buyQuantity: current.config?.buyQuantity || "2", freeQuantity: current.config?.freeQuantity || "1", freeItemId: current.config?.freeItemId || "", freeItemLabel: current.config?.freeItemLabel || "", freeItemPrice: current.config?.freeItemPrice || "", discountPercent: current.config?.discountPercent || "" },
          combo_buy_item_free: { template: 'combo_buy_item_free', buyQuantity: current.config?.buyQuantity || "1", freeQuantity: current.config?.freeQuantity || "1", freeItemId: current.config?.freeItemId || "", freeItemLabel: current.config?.freeItemLabel || "", freeItemPrice: current.config?.freeItemPrice || "" },
          item_buy_x_get_y: { template: 'item_buy_x_get_y', buyQuantity: current.config?.buyQuantity || "3", freeQuantity: current.config?.freeQuantity || "1", freeItemId: current.config?.freeItemId || "", freeItemLabel: current.config?.freeItemLabel || "", targetItemIds: current.config?.targetItemIds || [] }
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
              <select value={o.template || 'percent_order'} onChange={(e)=>updateField(idx,'template', e.target.value)}>
                {TEMPLATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Title</div>
              <input value={o.title || ''} onChange={(e)=>updateField(idx,'title',e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Banner Text</div>
              <input value={o.bannerText || ''} onChange={(e)=>updateField(idx,'bannerText',e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Start (ISO)</div>
              <input placeholder="YYYY-MM-DDTHH:MM:SSZ" value={o.start || ''} onChange={(e)=>updateField(idx,'start',e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>End (ISO)</div>
              <input placeholder="YYYY-MM-DDTHH:MM:SSZ" value={o.end || ''} onChange={(e)=>updateField(idx,'end',e.target.value)} />
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
