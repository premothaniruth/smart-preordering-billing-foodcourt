import React, { useEffect, useMemo, useState } from "react";
import { fetchOffers, fetchSectionsMeta, fetchCombos, updateOffers } from "../api";
import { toast } from "react-toastify";

const TEMPLATE_OPTIONS = [
  { value: "percent_order", label: "% Off Order / Sections" },
  { value: "flat_order", label: "Flat Discount" },
  { value: "combo_buy_x_get_y", label: "Combo – Buy X Get Free Item" },
  { value: "item_buy_x_get_y", label: "Menu Item – Buy X Get Y" }
];

const parseCommaNumbers = (input) => {
  if (!input) return [];
  return String(input)
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
};

const TemplateConfigFields = ({ offer, idx, updateConfigField, combos }) => {
  const cfg = sanitizeConfig(offer.config);

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
    case "item_buy_x_get_y":
      return (
        <>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Target Item IDs (comma separated)</div>
            <input
              value={cfg.targetItemIdsInput}
              onChange={(e) => updateConfigField(idx, 'targetItemIdsInput', e.target.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Buy Quantity</div>
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
        </>
      );
    default:
      return null;
  }
};

const sanitizeConfig = (config = {}) => ({
  minTotal: config.minTotal ?? "",
  percent: config.percent ?? "",
  amount: config.amount ?? "",
  buyQuantity: config.buyQuantity ?? "",
  freeQuantity: config.freeQuantity ?? "1",
  freeItemId: config.freeItemId ?? "",
  freeItemLabel: config.freeItemLabel ?? "",
  freeItemPrice: config.freeItemPrice ?? "",
  discountPercent: config.discountPercent ?? "",
  targetItemIdsInput: config.targetItemIdsInput ?? (Array.isArray(config.targetItemIds) ? config.targetItemIds.join(", ") : "")
});

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
    case "item_buy_x_get_y": {
      const targetIds = parseCommaNumbers(cfg.targetItemIdsInput);
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

  const snapshot = { ...cfg };
  if (snapshot.targetItemIdsInput) {
    snapshot.targetItemIds = parseCommaNumbers(snapshot.targetItemIdsInput);
  }
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
      config.targetItemIdsInput = itemCond.itemIds.join(", ");
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
    config,
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
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [off, sec, cmb] = await Promise.all([
        fetchOffers(vendorShopId),
        fetchSectionsMeta(),
        fetchCombos(vendorShopId, false)
      ]);
      setOffers(Array.isArray(off) ? off.map(adaptOffer) : []);
      setSections(Array.isArray(sec?.names) ? sec.names : []);
      setCombos(Array.isArray(cmb) ? cmb : []);
    } catch {
      setOffers([]); setSections([]); setCombos([]);
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
      config: sanitizeConfig({ percent: "5" })
    }, ...prev]));
  };

  const updateField = (idx, field, value) => {
    setOffers(prev => {
      const next = [...prev];
      const current = { ...next[idx] };
      if (field === 'template') {
        const defaults = {
          percent_order: { percent: current.config?.percent || current.discountPercent || "10", minTotal: current.config?.minTotal || "" },
          flat_order: { amount: current.config?.amount || current.discountAmount || "20", minTotal: current.config?.minTotal || "" },
          combo_buy_x_get_y: { buyQuantity: current.config?.buyQuantity || "2", freeQuantity: current.config?.freeQuantity || "1", freeItemId: current.config?.freeItemId || "", freeItemLabel: current.config?.freeItemLabel || "", freeItemPrice: current.config?.freeItemPrice || "", discountPercent: current.config?.discountPercent || "" },
          item_buy_x_get_y: { buyQuantity: current.config?.buyQuantity || "3", freeQuantity: current.config?.freeQuantity || "1", freeItemId: current.config?.freeItemId || "", freeItemLabel: current.config?.freeItemLabel || "", targetItemIdsInput: current.config?.targetItemIdsInput || "" }
        };
        current.template = value;
        current.config = sanitizeConfig(defaults[value] || {});
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
      config[field] = value;
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
                combos={combos}
              />
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Applicable Sections</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {sections.map((s) => (
                  <label key={s} className="menu-item-badge" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" style={{ display: 'none' }} checked={Array.isArray(o.applicableSections) && o.applicableSections.includes(s)} onChange={()=>toggleArrayValue(idx,'applicableSections', s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Applicable Combo IDs</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {combos.map((c) => (
                  <label key={c.id} className="menu-item-badge" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" style={{ display: 'none' }} checked={Array.isArray(o.applicableComboIds) && o.applicableComboIds.map(String).includes(String(c.id))} onChange={()=>toggleArrayValue(idx,'applicableComboIds', c.id)} />
                    {c.name} ({c.id})
                  </label>
                ))}
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
