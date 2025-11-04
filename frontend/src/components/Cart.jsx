import React, { useEffect, useMemo, useState, useCallback } from "react";
import { fetchSectionsMeta } from "../api";

/**
 * Cart
 * Displays cart lines with quantity steppers, notes, schedule time, and place-order action.
 * @param {{
 *  cart: Array,
 *  removeFromCart: (index:number)=>void,
 *  decrementFromCart: (index:number)=>void,
 *  incrementFromCart: (index:number)=>void,
 *  scheduledTime: string,
 *  setScheduledTime: (iso:string)=>void,
 *  onProceedToPayment: (details?:{ notes?:string })=>void,
 *  shopItems?: any[],
 *  inventoryById?: Map<number, any> | Record<string, any>,
 *  initialNotes?: string,
 *  onNotesChange?: (value:string)=>void
 * }} props
 */

const Cart = ({
  cart,
  removeFromCart,
  decrementFromCart,
  incrementFromCart,
  scheduledTime,
  setScheduledTime,
  onProceedToPayment,
  shopItems = [],
  inventoryById = new Map(),
  initialNotes = "",
  onNotesChange,
  cartShopMismatch = false,
  offerPreview = null,
  offersLoading = false
}) => {
  const [customNotes, setCustomNotes] = useState(() => initialNotes || "");

  useEffect(() => {
    setCustomNotes(initialNotes || "");
  }, [initialNotes]);

  useEffect(() => {
    if (typeof onNotesChange === "function") {
      onNotesChange(customNotes);
    }
  }, [customNotes, onNotesChange]);
  const getTodayStr = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const todayStr = getTodayStr();
  const formatDisplayDate = (dateId) => {
    if (!dateId) return "";
    const [y, m, d] = dateId.split('-');
    return `${d}-${m}-${y}`;
  };
  const todayDisplay = formatDisplayDate(todayStr);
  const tomorrowStr = (() => {
    const base = new Date();
    base.setDate(base.getDate() + 1);
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();
  const tomorrowDisplay = formatDisplayDate(tomorrowStr);
  const initialScheduledDate = (() => {
    if (scheduledTime) {
      try {
        const [d] = scheduledTime.split("T");
        if (d === tomorrowStr) return tomorrowStr;
        if (d === todayStr) return todayStr;
        if (d) return d;
      } catch {}
    }
    return todayStr;
  })();
  const [scheduledDate, setScheduledDate] = useState(initialScheduledDate);
  const [scheduledHM, setScheduledHM] = useState(""); // HH:MM
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(scheduledTime));
  const MIN_HM = "08:00";
  const MAX_HM = "22:30";

  const slots = useMemo(() => {
    const toMinutes = (hm) => {
      const [h,m] = hm.split(":").map(Number);
      return h*60 + m;
    };
    const fromMinutes = (t) => {
      const h = String(Math.floor(t/60)).padStart(2,'0');
      const m = String(t%60).padStart(2,'0');
      return `${h}:${m}`;
    };
    const start = toMinutes(MIN_HM);
    const end = toMinutes(MAX_HM);
    const arr = [];
    for (let t = start; t <= end; t += 5) arr.push(fromMinutes(t));
    return arr;
  }, []);

  useEffect(() => {
    if (!scheduledTime) {
      setScheduleEnabled(false);
      setScheduledDate(todayStr);
      setScheduledHM("");
      return;
    }
    setScheduleEnabled(true);
    // Expecting ISO-like 'YYYY-MM-DDTHH:MM'
    try {
      const [d, t] = scheduledTime.split("T");
      setScheduledDate(d || "");
      setScheduledHM((t || "").slice(0,5));
    } catch {
      setScheduledDate(""); setScheduledHM("");
    }
  }, [scheduledTime, todayStr, setScheduledTime]);

  // scheduling helpers are defined after current time calculations
  const clampHM = (hm, available) => {
    if (!hm) return hm;
    const source = Array.isArray(available) && available.length ? available : slots;
    const idx = source.indexOf(hm);
    if (idx >= 0) return hm;
    if (hm < MIN_HM) return MIN_HM;
    if (hm > MAX_HM) return MAX_HM;
    const [hours, minutes] = hm.split(":").map(Number);
    const roundedMinutes = Math.ceil(minutes / 5) * 5;
    let h = hours;
    let m = roundedMinutes;
    if (roundedMinutes >= 60) {
      h = hours + 1;
      m = 0;
    }
    const candidate = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (source.includes(candidate)) return candidate;
    return source.find((slot) => slot > hm) || source[source.length - 1] || MIN_HM;
  };

  const findNextSlot = (hm, available) => {
    const source = Array.isArray(available) && available.length ? available : slots;
    if (!source.length) return null;
    const futureSlot = source.find((slot) => slot > hm);
    return futureSlot || null;
  };

  const toHM = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const [currentHM, setCurrentHM] = useState(() => toHM(new Date()));
  useEffect(() => {
    const id = setInterval(() => setCurrentHM(toHM(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  const todaySlots = useMemo(() => slots.filter((slot) => slot > currentHM), [slots, currentHM]);
  const tomorrowSlots = useMemo(() => slots.slice(), [slots]);
  const slotsForDate = scheduledDate === tomorrowStr ? tomorrowSlots : todaySlots;

  const pickFirstAvailableDate = useCallback(() => {
    const candidateDates = [scheduledDate, todayStr, tomorrowStr].filter(Boolean);
    for (const dateId of candidateDates) {
      const normalized = dateId === tomorrowStr ? tomorrowStr : todayStr;
      const pool = normalized === tomorrowStr ? tomorrowSlots : todaySlots;
      if (Array.isArray(pool) && pool.length > 0) {
        return { dateId: normalized, slots: pool };
      }
    }
    return { dateId: todayStr, slots: [] };
  }, [scheduledDate, todayStr, tomorrowStr, todaySlots, tomorrowSlots]);

  const syncScheduled = useCallback((nextDate, nextHM) => {
    const dateId = nextDate === tomorrowStr ? tomorrowStr : todayStr;
    const available = dateId === tomorrowStr ? tomorrowSlots : todaySlots;
    const referenceHM = dateId === tomorrowStr ? MIN_HM : currentHM;
    let adjustedHM = nextHM ? clampHM(nextHM, available) : findNextSlot(referenceHM, available);
    if (dateId === todayStr && adjustedHM && adjustedHM <= currentHM) {
      adjustedHM = findNextSlot(currentHM, available);
    }
    if (!adjustedHM) {
      setScheduledDate(dateId);
      setScheduledHM("");
      setScheduledTime("");
      setScheduleEnabled(false);
      return;
    }
    setScheduledDate(dateId);
    setScheduledHM(adjustedHM);
    setScheduledTime(`${dateId}T${adjustedHM}`);
  }, [todayStr, tomorrowStr, currentHM, clampHM, findNextSlot, todaySlots, tomorrowSlots, setScheduledDate, setScheduledHM, setScheduledTime, setScheduleEnabled]);

  const [sectionWindows, setSectionWindows] = useState({}); // name -> { start, end }
  useEffect(() => {
    fetchSectionsMeta().then((d)=> setSectionWindows(d?.windows || {})).catch(()=>setSectionWindows({}));
  }, []);

  const effectiveHM = scheduledHM || currentHM; // if scheduled, validate against selected slot; else now
  const handleToggleSchedule = (e) => {
    const enabled = e.target.checked;
    if (enabled) {
      const { dateId, slots: defaultSlots } = pickFirstAvailableDate();
      if (!defaultSlots.length) {
        setScheduleEnabled(false);
        setScheduledHM("");
        setScheduledDate(todayStr);
        setScheduledTime("");
        return;
      }
      const defaultHM = defaultSlots[0];
      setScheduleEnabled(true);
      syncScheduled(dateId, defaultHM || MIN_HM);
    } else {
      setScheduleEnabled(false);
      setScheduledHM("");
      setScheduledDate(todayStr);
      setScheduledTime("");
    }
  };

  useEffect(() => {
    if (!scheduleEnabled) return;
    if (!slotsForDate.length) {
      setScheduleEnabled(false);
      setScheduledHM("");
      setScheduledDate(todayStr);
      setScheduledTime("");
      return;
    }
    if (scheduledDate === todayStr && (!scheduledHM || scheduledHM <= currentHM)) {
      syncScheduled(todayStr, slotsForDate[0]);
      return;
    }
    if (!scheduledHM || !slotsForDate.includes(scheduledHM)) {
      syncScheduled(scheduledDate, slotsForDate[0]);
    }
  }, [scheduleEnabled, slotsForDate, scheduledHM, currentHM, todayStr, scheduledDate, syncScheduled, setScheduledTime]);
  const inWindow = (secName, hm) => {
    const w = sectionWindows[secName];
    if (!w || !w.start || !w.end) return true;
    return hm >= w.start && hm <= w.end;
  };

  const inventoryLookup = useMemo(() => {
    if (inventoryById instanceof Map) {
      return inventoryById;
    }
    const map = new Map();
    if (inventoryById && typeof inventoryById === 'object') {
      Object.values(inventoryById).forEach((entry) => {
        if (entry && entry.id != null) {
          map.set(Number(entry.id), entry);
        }
      });
    }
    if (Array.isArray(shopItems)) {
      shopItems.forEach((item) => {
        if (item && item.id != null && !map.has(Number(item.id))) {
          map.set(Number(item.id), item);
        }
      });
    }
    return map;
  }, [inventoryById, shopItems]);

  const getInventoryFor = useCallback((itemId, fallback) => {
    const entry = inventoryLookup.get(Number(itemId));
    const inv = entry?.inventory ?? entry?.item?.inventory;
    if (inv != null && !Number.isNaN(Number(inv))) return Number(inv);
    if (fallback != null && !Number.isNaN(Number(fallback))) return Number(fallback);
    return 0;
  }, [inventoryLookup]);

  const subtotal = cart.reduce((sum, c) => sum + c.item.finalPrice * c.quantity, 0);
  const discountTotal = offerPreview?.discountTotal != null ? Number(offerPreview.discountTotal) : 0;
  const total = offerPreview?.totalPayable != null ? Number(offerPreview.totalPayable) : subtotal;
  const extraItems = Array.isArray(offerPreview?.extraItems) ? offerPreview.extraItems : [];
  const handleProceedToPayment = () => {
    onProceedToPayment({ notes: customNotes.trim() || undefined });
  };

  return (
    <div>
      <h2>Cart ({cart.length})</h2>

      {cartShopMismatch && cart.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            background: '#fff4e6',
            border: '1px solid #f5cba7',
            color: '#8a4b08',
            fontSize: 13,
            fontWeight: 600
          }}
        >
          Cart already has items from another shop. Please place separate orders.
        </div>
      )}

      {cart.length === 0 ? (
        <div className="empty-cart">
          <p>Your cart is Hungry too! Let's add some delicious treats!</p>
        </div>
      ) : (
        <div className="cart-items">
          {cart.map((c, i) => {
            const isCombo = !!c.item?.comboId && Array.isArray(c.item?.comboComponents);
            let remaining = 0;
            if (isCombo) {
              // Build consumed per item id across cart
              const consumed = new Map();
              for (const line of cart) {
                if (line.item?.comboId && Array.isArray(line.item?.comboComponents)) {
                  for (const comp of line.item.comboComponents) {
                    const need = Math.max(1, Number(comp.quantity || 1));
                    consumed.set(comp.itemId, (consumed.get(comp.itemId) || 0) + need * Number(line.quantity || 0));
                  }
                } else if (line.item && line.item.id != null) {
                  consumed.set(Number(line.item.id), (consumed.get(Number(line.item.id)) || 0) + Number(line.quantity || 0));
                }
              }
              // Compute combo capacity from current inventories
              let cap = Infinity;
              for (const comp of c.item.comboComponents) {
                const inv = getInventoryFor(comp.itemId, 0);
                const used = Number(consumed.get(Number(comp.itemId)) || 0);
                const avail = Math.max(0, inv - used);
                const need = Math.max(1, Number(comp.quantity || 1));
                const possible = Math.floor(avail / need);
                cap = Math.min(cap, possible);
              }
              const totalThisCombo = cart.filter(d => d.shopId === c.shopId && d.item?.comboId === c.item.comboId).reduce((s, d) => s + d.quantity, 0);
              remaining = Math.max(0, cap - totalThisCombo);
            } else {
              const baseInventory = getInventoryFor(c.item.id, c.item.inventory ?? 100);
              const totalForThis = cart
                .filter(d => d.shopId === c.shopId && d.item.id === c.item.id && (d.item.selectedOption?.name || null) === (c.item.selectedOption?.name || null))
                .reduce((sum, d) => sum + d.quantity, 0);
              remaining = Math.max(0, baseInventory - totalForThis);
            }
            const secName = c.item.section || 'All Items';
            const w = sectionWindows[secName];
            const availableNow = inWindow(secName, effectiveHM);
            return (
            <div key={i} className="cart-item">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "bold", fontSize: 14, display:'flex', alignItems:'center', gap:6 }}>
                  {c.item.name}
                  {!availableNow && (
                    <span title={w ? `Available ${w.start}-${w.end}` : 'Available in configured window'} style={{ fontSize: 12, color: '#e67e22', display:'inline-flex', alignItems:'center', gap:4 }}>
                      <span role="img" aria-label="time">⏰</span>
                      <span style={{ fontSize: 11 }}>{w ? `${w.start}-${w.end}` : ''}</span>
                    </span>
                  )}
                </div>
                {c.item.selectedOption && (
                  <div style={{ fontSize: 11, color: "#666" }}>
                    Variant: {c.item.selectedOption.name}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  {c.quantity} x ₹{c.item.finalPrice} = ₹{c.item.finalPrice * c.quantity}
                </div>
                {!availableNow && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#e67e22' }}>
                    {scheduledHM
                      ? `Not available at ${scheduledHM}. Choose a time within ${w?.start || '--:--'}-${w?.end || '--:--'}`
                      : `Currently unavailable. Available ${w?.start || '--:--'}-${w?.end || '--:--'}`}
                  </div>
                )}
                {remaining <= 0 && (
                  <div style={{ marginTop: 4, fontSize: 12, color: '#e74c3c' }}>No more items available to order</div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button 
                  className="icon-btn" 
                  onClick={() => decrementFromCart(i)}
                  style={{ width: 28, height: 28, fontSize: 16, background: '#fff', color: '#111', border: '1px solid #111', borderRadius: 6 }}
                >
                  −
                </button>
                <span style={{ fontWeight: "bold", minWidth: 25, textAlign: "center", fontSize: 14 }}>{c.quantity}</span>
                <button 
                  className="icon-btn" 
                  onClick={() => { if (remaining <= 0) return; incrementFromCart(i); }}
                  disabled={remaining <= 0}
                  style={{ width: 28, height: 28, fontSize: 16, background: '#fff', color: '#111', border: '1px solid #111', borderRadius: 6 }}
                >
                  +
                </button>
                <button 
                  onClick={() => removeFromCart(i)} 
                  style={{ background: '#fff', color: '#111', border: '1px solid #111', padding: "6px 10px", fontSize: "14px", marginLeft: 6, borderRadius: 6 }}
                >
                  Remove
                </button>
              </div>
            </div>
          );
          })}
        </div>
      )}
      <div className="cart-scheduler">
        <label className="cart-scheduler-toggle">
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={handleToggleSchedule}
          />
          <span>Schedule this order</span>
        </label>
        {scheduleEnabled ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <select
                value={scheduledDate}
                onChange={(e) => syncScheduled(e.target.value, MIN_HM)}
                style={{ flex: 1, background: '#f8f9fa', border: '1px solid #ddd', padding: '8px 10px', borderRadius: 6 }}
              >
                <option value={todayStr}>Today ({todayDisplay})</option>
                <option value={tomorrowStr}>Tomorrow ({tomorrowDisplay})</option>
              </select>
              <select
                value={slotsForDate.length ? (scheduledHM || slotsForDate[0]) : ""}
                onChange={(e) => syncScheduled(scheduledDate, e.target.value)}
                style={{ width: 160 }}
                disabled={!slotsForDate.length}
              >
                {slotsForDate.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <small style={{ display: 'block', marginTop: 6, color: '#7f8c8d' }}>
              {slotsForDate.length
                ? `Select a ${scheduledDate === todayStr ? 'later today' : 'tomorrow'} slot between ${MIN_HM}-${MAX_HM}.`
                : scheduledDate === todayStr
                  ? 'No future slots available today. Switch to tomorrow to pre-order.'
                  : 'No slots available tomorrow.'}
            </small>
          </>
        ) : (
          <small style={{ display: 'block', marginTop: 6, color: '#7f8c8d' }}>
            Leave unchecked to prepare this order immediately.
          </small>
        )}
      </div>

      {cart.length > 0 && (
        <>
          <div style={{ marginTop: 15, paddingTop: 15, borderTop: "2px solid #ddd" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span>Subtotal:</span>
              <span>₹{subtotal.toFixed(2)}</span>
            </div>
            {discountTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, color: '#27ae60' }}>
                <span>Offer Savings:</span>
                <span>-₹{discountTotal.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "18px", fontWeight: "bold", marginTop: 10, paddingTop: 10, borderTop: "1px solid #ddd" }}>
              <span>Total:</span>
              <span>₹{total.toFixed(2)}</span>
            </div>
            {offersLoading && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#7f8c8d' }}>Refreshing offers…</div>
            )}
            {!offersLoading && offerPreview?.appliedOffers && offerPreview.appliedOffers.length > 0 && (
              <div style={{ marginTop: 12, padding: 10, borderRadius: 6, background: '#f5f9f6', border: '1px solid #d4edda' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Applied Offers</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {offerPreview.appliedOffers.map((off) => (
                    <li key={off.id}>
                      <strong>{off.title || 'Offer'}</strong>
                      {off.discountAmount != null && off.discountAmount > 0 && (
                        <span> — saved ₹{Number(off.discountAmount).toFixed(2)}</span>
                      )}
                      {off.rewards && off.rewards.some((r) => r.type === 'free_item') && (
                        <span> — includes freebies</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {extraItems.length > 0 && (
            <div style={{ marginTop: 15, padding: 12, border: '1px dashed #95a5a6', borderRadius: 6, background: '#f7f9fa' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Complimentary Items</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {extraItems.map((item, idx) => (
                  <li key={`${item.id || 'free'}-${idx}`}>
                    {item.name || `Free Item ${idx + 1}`} ×{item.quantity || 1}
                    {item.fromOfferTitle && (
                      <span style={{ color: '#7f8c8d' }}> ({item.fromOfferTitle})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 15 }}>
            <label style={{ fontSize: "12px", fontWeight: "bold", display: "block", marginBottom: 5 }}>
              Special Instructions for All Items (Optional):
            </label>
            <textarea
              value={customNotes}
              onChange={(e) => {
                const input = e.target.value;
                const words = input.trim().split(/\s+/).filter(Boolean);
                const limited = words.length > 100 ? words.slice(0, 100).join(' ') : input;
                setCustomNotes(limited);
              }}
              placeholder="E.g., Extra spicy, less oil, more garnish..."
              rows={4}
              style={{
                width: "100%",
                padding: 8,
                minHeight: 70,
                fontFamily: "inherit",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid #ddd",
                resize: 'none'
              }}
            />
          </div>

          <button
            onClick={handleProceedToPayment}
            style={{ width: "100%", marginTop: 15, background: "#27ae60", padding: "14px", fontSize: "16px", fontWeight: "bold", color: '#fff', border: 'none', borderRadius: 6 }}
          >
            Proceed to Payment (₹{total.toFixed(2)})
          </button>
        </>
      )}
    </div>
  );
};

export default Cart;