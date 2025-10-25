import React from "react";

const Menu = ({ menu, addToCart, selectedShop, setSelectedShop }) => {
  return (
    <div>
      <h2>Menu</h2>
      <label>Choose a Shop: </label>
      <select
        value={selectedShop}
        onChange={(e) => setSelectedShop(Number(e.target.value))}
      >
        {menu.map((shop) => (
          <option key={shop.shopId} value={shop.shopId}>
            {shop.shopName}
          </option>
        ))}
      </select>
      <ul>
        {menu.find((s) => s.shopId === selectedShop)?.items.map((item) => (
          <li key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span>{item.name}</span>
            <span style={{ marginLeft: "auto" }}>₹{item.price}</span>
            <button
              aria-label={`Add ${item.name}`}
              onClick={() => addToCart(item, selectedShop)}
              disabled={!item.available}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "none",
                background: "#28a745",
                color: "white",
                cursor: item.available ? "pointer" : "not-allowed",
              }}
            >
              +
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Menu;