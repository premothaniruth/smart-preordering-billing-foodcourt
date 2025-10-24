import React from "react";

const Cart = ({ cart, removeFromCart, scheduledTime, setScheduledTime }) => {
  const total = cart.reduce((sum, item) => sum + item.price, 0);

  return (
    <div>
      <h2>Cart</h2>
      <ul>
        {cart.map((item, i) => (
          <li key={i}>
            {item.name} - ₹{item.price}
            <button onClick={() => removeFromCart(i)} style={{ marginLeft: "10px" }}>
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

export default Cart;