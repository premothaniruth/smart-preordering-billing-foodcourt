import React, { useState } from "react";
import { toggleFavorite } from "../api";
import { toast } from "react-toastify";

const Menu = ({ menu, addToCart, cart, selectedShop, setSelectedShop, favorites, onFavoriteToggle, userId }) => {
  const [dietFilter, setDietFilter] = useState("all");
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [customization, setCustomization] = useState({
    spiceLevel: "medium",
    oilLevel: "medium",
    notes: ""
  });

  if (!menu.length) return <p>Loading menu...</p>;

  const shop = menu.find((s) => s.shopId === selectedShop);
  if (!shop) return <p>Shop not found.</p>;

  const handleAddClick = (item) => {
    setSelectedItem(item);
    setCustomization({ spiceLevel: "medium", oilLevel: "medium", notes: "" });
    
    if (item.hasOptions && item.options) {
      setSelectedOption(item.options[0]);
      setShowOptionsModal(true);
    } else {
      setShowCustomizationModal(true);
    }
  };

  const handleOptionConfirm = () => {
    setShowOptionsModal(false);
    setShowCustomizationModal(true);
  };

  const handleCustomizationConfirm = () => {
    if (selectedItem) {
      addToCart(selectedItem, selectedShop, selectedOption, customization);
      setShowCustomizationModal(false);
      setSelectedItem(null);
      setSelectedOption(null);
      toast.success(`${selectedItem.name} added to cart!`);
    }
  };

  const handleFavoriteClick = async (itemId, e) => {
    e.stopPropagation();
    try {
      const result = await toggleFavorite(userId, itemId);
      onFavoriteToggle();
      toast.success(result.message);
    } catch (error) {
      toast.error("Failed to update favorite");
    }
  };

  const isFavorite = (itemId) => favorites.includes(itemId);

  let filteredItems = shop.items;
  if (dietFilter === "veg") {
    filteredItems = shop.items.filter(item => item.isVeg);
  } else if (dietFilter === "non-veg") {
    filteredItems = shop.items.filter(item => !item.isVeg);
  }

  const favoriteItems = filteredItems.filter(item => isFavorite(item.id));
  const recommended = filteredItems.filter(item => item.isRecommended && !isFavorite(item.id));
  const hotSellers = filteredItems.filter(item => item.isHotSeller && !item.isRecommended && !isFavorite(item.id));
  const regularItems = filteredItems.filter(item => !item.isRecommended && !item.isHotSeller && !isFavorite(item.id));

  const renderItem = (item) => {
    return (
      <div key={item.id} className="menu-item-card">
        <div style={{ position: "relative" }}>
          <img 
            src={item.image.startsWith('http') ? item.image : `http://localhost:3001${item.image}`}
            alt={item.name} 
            className="menu-item-image"
            onError={(e) => {
              e.target.src = "https://via.placeholder.com/200x150/95a5a6/ffffff?text=No+Image";
            }}
          />
          <button
            onClick={(e) => handleFavoriteClick(item.id, e)}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "rgba(255, 255, 255, 0.9)",
              border: "none",
              borderRadius: "50%",
              width: 32,
              height: 32,
              cursor: "pointer",
              fontSize: 18
            }}
          >
            {isFavorite(item.id) ? "❤️" : "🤍"}
          </button>
        </div>
        <div className="menu-item-content">
          <div className="menu-item-name">{item.name}</div>
          <div className="menu-item-price">₹{item.price}+</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            {item.isVeg ? (
              <span className="menu-item-badge" style={{ color: "#27ae60", border: "1px solid #27ae60" }}>🟢 VEG</span>
            ) : (
              <span className="menu-item-badge" style={{ color: "#e74c3c", border: "1px solid #e74c3c" }}>🔴 NON-VEG</span>
            )}
          </div>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: 8 }}>
            ⏱️ {item.prepTime || 5} mins prep time
          </div>
          {item.hasOptions && (
            <div style={{ fontSize: "11px", color: "#666", marginBottom: 4 }}>
              {item.options.length} options available
            </div>
          )}
          <div className="menu-item-actions">
            <button 
              className="icon-btn" 
              onClick={() => handleAddClick(item)}
              disabled={!item.available}
              style={{ background: "#27ae60", width: "100%" }}
            >
              + Add
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2>Menu</h2>
      <div className="filter-section">
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

      {favoriteItems.length > 0 && (
        <>
          <h3>❤️ Your Favorite Picks</h3>
          <div className="menu-grid">
            {favoriteItems.map(renderItem)}
          </div>
        </>
      )}

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
        <p className="empty-state">No items match the selected filter.</p>
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
              <button onClick={handleOptionConfirm} style={{ flex: 1, background: "#27ae60" }}>
                Next
              </button>
              <button onClick={() => setShowOptionsModal(false)} style={{ background: "#95a5a6" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customization Modal */}
      {showCustomizationModal && selectedItem && (
        <div className="modal-overlay" onClick={() => setShowCustomizationModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Customize {selectedItem.name}</h3>
            
            <div style={{ marginTop: 20 }}>
              <label style={{ display: "block", marginBottom: 10, fontWeight: "bold" }}>
                Spice Level:
              </label>
              <select 
                value={customization.spiceLevel} 
                onChange={(e) => setCustomization({...customization, spiceLevel: e.target.value})}
                style={{ width: "100%", padding: 8 }}
              >
                <option value="no-spice">No Spice</option>
                <option value="less-spicy">Less Spicy</option>
                <option value="medium">Medium (Default)</option>
                <option value="more-spicy">More Spicy</option>
                <option value="extra-spicy">Extra Spicy</option>
              </select>
            </div>

            <div style={{ marginTop: 15 }}>
              <label style={{ display: "block", marginBottom: 10, fontWeight: "bold" }}>
                Oil Level:
              </label>
              <select 
                value={customization.oilLevel} 
                onChange={(e) => setCustomization({...customization, oilLevel: e.target.value})}
                style={{ width: "100%", padding: 8 }}
              >
                <option value="oil-free">Oil Free</option>
                <option value="less-oil">Less Oil</option>
                <option value="medium">Medium (Default)</option>
                <option value="extra-oil">Extra Oil</option>
              </select>
            </div>

            <div style={{ marginTop: 15 }}>
              <label style={{ display: "block", marginBottom: 10, fontWeight: "bold" }}>
                Special Instructions (Optional):
              </label>
              <textarea 
                value={customization.notes}
                onChange={(e) => setCustomization({...customization, notes: e.target.value})}
                placeholder="E.g., No onions, extra garnish, well cooked..."
                style={{ width: "100%", padding: 8, minHeight: 80, fontFamily: "inherit" }}
              />
            </div>

            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <button onClick={handleCustomizationConfirm} style={{ flex: 1, background: "#27ae60" }}>
                Add to Cart - ₹{selectedItem.price + (selectedOption?.priceModifier || 0)}
              </button>
              <button onClick={() => setShowCustomizationModal(false)} style={{ background: "#95a5a6" }}>
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