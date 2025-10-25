import React from "react";

const Cart = ({ cart, removeFromCart, decrementFromCart, incrementFromCart, scheduledTime, setScheduledTime }) => {
  const total = cart.reduce((sum, c) => sum + c.item.price * c.quantity, 0);

  return (
    <div>
      <h2>Cart</h2>
      {cart.length === 0 && <p>Your cart is empty</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {cart.map((c, i) => (
          <li key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0" }}>
            <span style={{ minWidth: 180 }}>{c.item.name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                aria-label="Decrease quantity"
                onClick={() => decrementFromCart(i)}
                style={iconButtonStyle}
              >
                −
              </button>
              <span>{c.quantity}</span>
              <button
                aria-label="Increase quantity"
                onClick={() => incrementFromCart(c.item, c.shopId)}
                style={iconButtonStyle}
              >
                +
              </button>
            </div>
            <span style={{ marginLeft: "auto" }}>₹{c.item.price * c.quantity}</span>
            <button onClick={() => removeFromCart(i)} style={{ marginLeft: "8px" }}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p>Total: ₹{total}</p>
      <label>Schedule for (optional): </label>
      <input
        type="datetime-local"
        value={scheduledTime}
        onChange={(e) => setScheduledTime(e.target.value)}
      />
    </div>
  );
};

// inline style for icon buttons
const iconButtonStyle = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: "1px solid #aaa",
  background: "#f0f0f0",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: "28px",
  textAlign: "center",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center"
};

export default Cart;