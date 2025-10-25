import React from "react";

const Cart = ({ cart, removeFromCart, decrementFromCart, incrementFromCart, scheduledTime, setScheduledTime, onPayment }) => {
  const total = cart.reduce((sum, c) => sum + c.item.finalPrice * c.quantity, 0);

  return (
    <div>
      <h2>Cart</h2>
      {cart.length === 0 && <p>Your cart is empty</p>}
      <div>
        {cart.map((c, i) => (
          <div key={i} className="cart-item">
            <div>
              <div style={{ fontWeight: "bold" }}>{c.item.name}</div>
              {c.item.selectedOption && (
                <div style={{ fontSize: "11px", color: "#666" }}>
                  ({c.item.selectedOption.name})
                </div>
              )}
              <div style={{ fontSize: "12px", color: "#666" }}>
                {c.quantity} x ₹{c.item.finalPrice}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button 
                className="icon-btn" 
                onClick={() => decrementFromCart(i)}
                style={{ width: 24, height: 24, fontSize: 14, background: "#e74c3c" }}
              >
                −
              </button>
              <span style={{ fontWeight: "bold", minWidth: 20, textAlign: "center" }}>{c.quantity}</span>
              <button 
                className="icon-btn" 
                onClick={() => incrementFromCart(i)}
                style={{ width: 24, height: 24, fontSize: 14, background: "#27ae60" }}
              >
                +
              </button>
              <button 
                onClick={() => removeFromCart(i)} 
                style={{ background: "#e74c3c", padding: "4px 8px", fontSize: "12px", marginLeft: 8 }}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 15, paddingTop: 15, borderTop: "2px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "18px", fontWeight: "bold" }}>
          <span>Total:</span>
          <span>₹{total}</span>
        </div>
      </div>
      <div style={{ marginTop: 15 }}>
        <label style={{ fontSize: "12px" }}>Schedule (optional):</label>
        <input 
          type="datetime-local" 
          value={scheduledTime} 
          onChange={(e) => setScheduledTime(e.target.value)}
          style={{ width: "100%", marginTop: 5 }}
        />
      </div>
      <button 
        disabled={cart.length === 0} 
        onClick={onPayment} 
        style={{ width: "100%", marginTop: 15, background: "#27ae60", padding: "12px", fontSize: "16px" }}
      >
        Pay Now (₹{total})
      </button>
    </div>
  );
};

export default Cart;