import React, { useState } from "react";
import { toggleFavorite } from "../api";
import { toast } from "react-toastify";

const Menu = ({ menu, addToCart, cart, selectedShop, setSelectedShop, favorites, onFavoriteToggle, userId, hideFavorites, hideShopSelector }) => {
  const [dietFilter, setDietFilter] = useState("all");
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);

  if (!menu.length) return <p>Loading menu...</p>;

  const shop = menu.find((s) => s.shopId === selectedShop);
  if (!shop) return <p>Shop not found.</p>;

  const handleAddClick = (item) => {
    setSelectedItem(item);
    
    if (item.hasOptions && item.options) {
      setSelectedOption(item.options[0]);
      setShowOptionsModal(true);
    } else {
      // Add directly without customization modal
      addToCart(item, selectedShop, null, {});
      toast.success(`${item.name} added to cart!`);
    }
  };

  const handleOptionConfirm = () => {
    if (selectedItem && selectedOption) {
      addToCart(selectedItem, selectedShop, selectedOption, {});
      setShowOptionsModal(false);
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
            src={item.image && item.image.startsWith('http') ? item.image : `http://localhost:3001${item.image}`}
            alt={item.name} 
            className="menu-item-image"
            onError={(e) => {
              e.target.src = "https://via.placeholder.com/200x150/95a5a6/ffffff?text=No+Image";
            }}
          />
          {!hideFavorites && (
            <button
              className="favorite-btn"
              onClick={(e) => handleFavoriteClick(item.id, e)}
              style={{ background: 'transparent', border: 'none', padding: 4 }}
            >
              {isFavorite(item.id) ? "❤️" : "🤍"}
            </button>
          )}
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
              style={{
                width: "100%",
                padding: '10px 12px',
                background: '#fff',
                color: '#111',
                border: '1px solid #111',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="10" cy="20" r="1"/>
                <circle cx="18" cy="20" r="1"/>
                <path d="M2 2h2l3.6 7.59a2 2 0 0 0 1.8 1.17H17a2 2 0 0 0 2-1.5l1.38-5.5H6"/>
              </svg>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add to Cart
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
        {!hideShopSelector && (
          <>
            <label>Shop:&nbsp;</label>
            <select value={selectedShop} onChange={(e) => setSelectedShop(Number(e.target.value))}>
              {menu.map(shop => (<option key={shop.shopId} value={shop.shopId}>{shop.shopName}</option>))}
            </select>
            <label style={{ marginLeft: "20px" }}>Filter:&nbsp;</label>
          </>
        )}
        {hideShopSelector && (
          <label>Filter:&nbsp;</label>
        )}
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

      {/* Options Modal Only */}
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