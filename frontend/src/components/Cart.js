import React, { useState } from "react";

const Cart = ({ cart, removeFromCart, decrementFromCart, incrementFromCart, scheduledTime, setScheduledTime, onPayment }) => {
  const [customNotes, setCustomNotes] = useState("");
  
  const total = cart.reduce((sum, c) => sum + c.item.finalPrice * c.quantity, 0);
  const totalPrepTime = cart.reduce((sum, c) => sum + (c.item.prepTime || 5) * c.quantity, 0);

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
        {cart.map((c, i) => (
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
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button 
                className="icon-btn" 
                onClick={() => decrementFromCart(i)}
                style={{ width: 28, height: 28, fontSize: 16, background: "#e74c3c" }}
              >
                −
              </button>
              <span style={{ fontWeight: "bold", minWidth: 25, textAlign: "center", fontSize: 14 }}>{c.quantity}</span>
              <button 
                className="icon-btn" 
                onClick={() => incrementFromCart(i)}
                style={{ width: 28, height: 28, fontSize: 16, background: "#27ae60" }}
              >
                +
              </button>
              <button 
                onClick={() => removeFromCart(i)} 
                style={{ background: "#e74c3c", padding: "6px 10px", fontSize: "14px", marginLeft: 6 }}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      
      {cart.length > 0 && (
        <>
          <div style={{ marginTop: 15, paddingTop: 15, borderTop: "2px solid #ddd" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span>Subtotal:</span>
              <span>₹{total}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, color: "#666" }}>
              <span>Est. Prep Time:</span>
              <span>{totalPrepTime} mins</span>
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
              onChange={(e) => setCustomNotes(e.target.value)}
              placeholder="E.g., Less spicy, no onions, extra garnish, less oil..."
              style={{ 
                width: "100%", 
                padding: 8, 
                minHeight: 70, 
                fontFamily: "inherit",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid #ddd"
              }}
            />
          </div>
          
          <div style={{ marginTop: 15 }}>
            <label style={{ fontSize: "12px", fontWeight: "bold" }}>Schedule for Later (optional):</label>
            <input 
              type="datetime-local" 
              value={scheduledTime} 
              onChange={(e) => setScheduledTime(e.target.value)}
              style={{ width: "100%", marginTop: 5 }}
            />
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