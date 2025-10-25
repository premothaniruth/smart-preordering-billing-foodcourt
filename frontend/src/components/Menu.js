import React from "react";

const Menu = ({ menu, addToCart, selectedShop, setSelectedShop }) => {
  if (!menu.length) return <p>Loading menu...</p>;

  const shop = menu.find((s) => s.shopId === selectedShop);
  if (!shop) return <p>Shop not found.</p>;

  const recommended = shop.items.filter(item => item.isRecommended);
  const hotSellers = shop.items.filter(item => item.isHotSeller && !item.isRecommended);
  const regularItems = shop.items.filter(item => !item.isRecommended && !item.isHotSeller);

  const renderItem = (item) => (
    <li key={item.id} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px", padding: "10px", background: "#f8f9fa", borderRadius: "8px" }}>
      <img src={item.image} alt={item.name} style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 6 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: "bold", fontSize: "16px" }}>{item.name}</div>
        <div style={{ color: "#27ae60", fontSize: "14px" }}>₹{item.price}</div>
      </div>
      <button 
        onClick={() => addToCart(item, selectedShop)} 
        disabled={!item.available} 
        style={{ padding: "8px 16px", background: "#27ae60", color: "white", border: "none", borderRadius: "6px" }}
      >
        +
      </button>
    </li>
  );

  return (
    <div>
      <h2>Menu</h2>
      <label>Choose a Shop:&nbsp;</label>
      <select value={selectedShop} onChange={(e) => setSelectedShop(Number(e.target.value))}>
        {menu.map(shop => (<option key={shop.shopId} value={shop.shopId}>{shop.shopName}</option>))}
      </select>

      {recommended.length > 0 && (
        <>
          <h3>🌟 Recommended</h3>
          <ul style={{ paddingLeft: 0, listStyle: "none" }}>
            {recommended.map(renderItem)}
          </ul>
        </>
      )}

      {hotSellers.length > 0 && (
        <>
          <h3>🔥 Hot Sellers</h3>
          <ul style={{ paddingLeft: 0, listStyle: "none" }}>
            {hotSellers.map(renderItem)}
          </ul>
        </>
      )}

      {regularItems.length > 0 && (
        <>
          <h3>All Items</h3>
          <ul style={{ paddingLeft: 0, listStyle: "none" }}>
            {regularItems.map(renderItem)}
          </ul>
        </>
      )}
    </div>
  );
};

export default Menu;