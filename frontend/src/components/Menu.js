import React, { useState } from "react";

const Menu = ({ menu, addToCart, cart, selectedShop, setSelectedShop }) => {
  const [dietFilter, setDietFilter] = useState("all");
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);

  if (!menu.length) return <p>Loading menu...</p>;

  const shop = menu.find((s) => s.shopId === selectedShop);
  if (!shop) return <p>Shop not found.</p>;

  const handleAddClick = (item) => {
    if (item.hasOptions && item.options) {
      setSelectedItem(item);
      setSelectedOption(item.options[0]);
      setShowOptionsModal(true);
    } else {
      addToCart(item, selectedShop);
    }
  };

  const handleConfirmOption = () => {
    if (selectedItem && selectedOption) {
      addToCart(selectedItem, selectedShop, selectedOption);
      setShowOptionsModal(false);
      setSelectedItem(null);
      setSelectedOption(null);
    }
  };

  let filteredItems = shop.items;
  if (dietFilter === "veg") {
    filteredItems = shop.items.filter(item => item.isVeg);
  } else if (dietFilter === "non-veg") {
    filteredItems = shop.items.filter(item => !item.isVeg);
  }

  const recommended = filteredItems.filter(item => item.isRecommended);
  const hotSellers = filteredItems.filter(item => item.isHotSeller && !item.isRecommended);
  const regularItems = filteredItems.filter(item => !item.isRecommended && !item.isHotSeller);

  const renderItem = (item) => {
    return (
      <div key={item.id} className="menu-item-card">
        <img src={item.image} alt={item.name} className="menu-item-image" />
        <div className="menu-item-content">
          <div className="menu-item-name">{item.name}</div>
          <div className="menu-item-price">₹{item.price}+</div>
          {item.isVeg ? (
            <span className="menu-item-badge" style={{ color: "#27ae60", border: "1px solid #27ae60" }}>🟢 VEG</span>
          ) : (
            <span className="menu-item-badge" style={{ color: "#e74c3c", border: "1px solid #e74c3c" }}>🔴 NON-VEG</span>
          )}
          {item.hasOptions && (
            <div style={{ fontSize: "11px", color: "#666", marginTop: 4 }}>
              {item.options.length} options available
            </div>
          )}
          <div className="menu-item-actions">
            <button 
              className="icon-btn" 
              onClick={() => handleAddClick(item)}
              disabled={!item.available}
              style={{ background: "#27ae60" }}
            >
              +
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2>Menu</h2>
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <label>Shop:&nbsp;</label>
        <select value={selectedShop} onChange={(e) => setSelectedShop(Number(e.target.value))}>
          {menu.map(shop => (<option key={shop.shopId} value={shop.shopId}>{shop.shopName}</option>))}
        </select>

        <label style={{ marginLeft: "20px" }}>Filter:&nbsp;</label>
        <select value={dietFilter} onChange={(e) => setDietFilter(e.target.value)}>
          <option value="all">All Items</option>
          <option value="veg">Veg Only</option>
          <option value="non-veg">Non-Veg Only</option>
        </select>
      </div>

      {recommended.length > 0 && (
        <>
          <h3>🌟 Recommended</h3>
          <div className="menu-grid">
            {recommended.map(renderItem)}
          </div>
        </>
      )}

      {hotSellers.length > 0 && (
        <>
          <h3>🔥 Hot Sellers</h3>
          <div className="menu-grid">
            {hotSellers.map(renderItem)}
          </div>
        </>
      )}

      {regularItems.length > 0 && (
        <>
          <h3>All Items</h3>
          <div className="menu-grid">
            {regularItems.map(renderItem)}
          </div>
        </>
      )}

      {filteredItems.length === 0 && (
        <p style={{ color: "#999", fontStyle: "italic" }}>No items match the selected filter.</p>
      )}

      {/* Options Modal */}
      {showOptionsModal && selectedItem && (
        <div className="modal-overlay" onClick={() => setShowOptionsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Choose Option for {selectedItem.name}</h3>
            <div style={{ marginTop: 15 }}>
              {selectedItem.options.map((option, idx) => (
                <label key={idx} style={{ display: "block", marginBottom: 10, cursor: "pointer" }}>
                  <input 
                    type="radio" 
                    name="option" 
                    checked={selectedOption?.name === option.name}
                    onChange={() => setSelectedOption(option)}
                  />
                  &nbsp;{option.name} 
                  {option.priceModifier > 0 && <span style={{ color: "#27ae60" }}> (+₹{option.priceModifier})</span>}
                </label>
              ))}
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <button onClick={handleConfirmOption} style={{ flex: 1, background: "#27ae60" }}>
                Add to Cart - ₹{selectedItem.price + (selectedOption?.priceModifier || 0)}
              </button>
              <button onClick={() => setShowOptionsModal(false)} style={{ background: "#95a5a6" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Menu;