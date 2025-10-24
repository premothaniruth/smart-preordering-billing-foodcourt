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
          <li key={item.id}>
            {item.name} - ₹{item.price} {item.available ? "" : "(Sold Out)"}
            <button
              onClick={() => addToCart(item, selectedShop)}
              disabled={!item.available}
              style={{ marginLeft: "10px" }}
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Menu;