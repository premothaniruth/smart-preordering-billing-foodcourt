import React, { useEffect, useMemo, useState } from "react";

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
 *  onPayment: ()=>void
 * }} props
 */

const Cart = ({ cart, removeFromCart, decrementFromCart, incrementFromCart, scheduledTime, setScheduledTime, onPayment }) => {
  const [customNotes, setCustomNotes] = useState("");
  const getTodayStr = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const todayStr = getTodayStr();
  const todayDisplay = (() => {
    const [y,m,d] = todayStr.split('-');
    return `${d}-${m}-${y}`; // dd-mm-yyyy
  })();
  const [scheduledDate, setScheduledDate] = useState(() => todayStr); // YYYY-MM-DD, locked to today
  const [scheduledHM, setScheduledHM] = useState(""); // HH:MM
  const MIN_HM = "08:00";
  const MAX_HM = "22:00";

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
    if (!scheduledTime) { setScheduledDate(todayStr); setScheduledHM(""); return; }
    // Expecting ISO-like 'YYYY-MM-DDTHH:MM'
    try {
      const [d, t] = scheduledTime.split("T");
      setScheduledDate(d || "");
      setScheduledHM((t || "").slice(0,5));
    } catch {
      setScheduledDate(""); setScheduledHM("");
    }
  }, [scheduledTime]);

  const clampHM = (hm) => {
    if (!hm) return hm;
    // snap to nearest allowed slot within window
    const idx = slots.indexOf(hm);
    if (idx >= 0) return hm;
    // round to nearest 10 and clamp
    const [h,m] = hm.split(":").map(Number);
    const rounded = `${String(h).padStart(2,'0')}:${String(Math.round(m/5)*5).padStart(2,'0')}`;
    if (slots.includes(rounded)) return rounded;
    if (hm < MIN_HM) return MIN_HM;
    if (hm > MAX_HM) return MAX_HM;
    // fallback to first slot
    return slots[0] || MIN_HM;
  };

  const syncScheduled = (nextDate, nextHM) => {
    // force date to today only
    if (nextDate && nextDate !== todayStr) nextDate = todayStr;
    // clamp time within operational window
    nextHM = clampHM(nextHM);
    setScheduledDate(nextDate);
    setScheduledHM(nextHM);
    if (nextDate && nextHM) {
      setScheduledTime(`${nextDate}T${nextHM}`);
    } else if (!nextDate && !nextHM) {
      setScheduledTime("");
    } else {
      // partial entry; do not update parent until both present
    }
  };
  
  const total = cart.reduce((sum, c) => sum + c.item.finalPrice * c.quantity, 0);
  const totalPrepTime = cart.reduce((sum, c) => sum + (c.item.prepTime || 5) * c.quantity, 0);

  // Attach custom notes to the first item (simple demo) and trigger payment
  const handlePayment = () => {
    // Add custom notes to the first item or create a general note
    if (cart.length > 0 && customNotes) {
      cart[0].item.customization = {
        ...cart[0].item.customization,
        notes: customNotes
      };
    }
    onPayment();
    setCustomNotes("");
  };

  return (
    <div>
      <h2>Cart ({cart.length})</h2>
      {cart.length === 0 && <p className="empty-state">Your cart is empty</p>}
      <div>
        {cart.map((c, i) => {
          const inventory = Number(c.item.inventory ?? 100);
          const totalForThis = cart
            .filter(d => d.shopId === c.shopId && d.item.id === c.item.id && (d.item.selectedOption?.name || null) === (c.item.selectedOption?.name || null))
            .reduce((sum, d) => sum + d.quantity, 0);
          const remaining = Math.max(0, inventory - totalForThis);
          return (
          <div key={i} className="cart-item">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "bold", fontSize: 14 }}>{c.item.name}</div>
              {c.item.selectedOption && (
                <div style={{ fontSize: 11, color: "#666" }}>
                  Variant: {c.item.selectedOption.name}
                </div>
              )}
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                {c.quantity} x ₹{c.item.finalPrice} = ₹{c.item.finalPrice * c.quantity}
              </div>
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
        );})}
      </div>
      
      {cart.length > 0 && (
        <>
          <div style={{ marginTop: 15, paddingTop: 15, borderTop: "2px solid #ddd" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span>Subtotal:</span>
              <span>₹{total}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "18px", fontWeight: "bold", marginTop: 10, paddingTop: 10, borderTop: "1px solid #ddd" }}>
              <span>Total:</span>
              <span>₹{total}</span>
            </div>
          </div>

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
              placeholder="E.g., Less spicy, no onions, extra garnish, less oil..."
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
          
          {/* Optional later schedule for pickup */}
          <div style={{ marginTop: 15 }}>
            <label style={{ fontSize: "12px", fontWeight: "bold", display:'block' }}>Schedule for Later (optional):</label>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input
                type="text"
                value={todayDisplay}
                readOnly
                aria-label="Scheduled date"
                style={{ flex:1, background:'#f8f9fa', border:'1px solid #ddd', padding:'8px 10px', borderRadius:6 }}
              />
              <select
                value={scheduledHM || MIN_HM}
                onChange={(e) => syncScheduled(scheduledDate, e.target.value)}
                style={{ width: 160 }}
              >
                {slots.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          
          <button 
            onClick={handlePayment} 
            style={{ width: "100%", marginTop: 15, background: "#27ae60", padding: "14px", fontSize: "16px", fontWeight: "bold" }}
          >
            Place Order (₹{total})
          </button>
        </>
      )}
    </div>
  );
};

export default Cart;