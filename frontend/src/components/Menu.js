import React, { useState } from "react";
import { toggleFavorite } from "../api";
import { toast } from "react-toastify";

/**
 * Menu
 * Renders the user menu: sections, item cards, and variant selection modal.
 * Keeps per-item variant selections in a draft until checkout.
 * @param {{
 *  menu: Array,
 *  addToCart: (item:any, shopId:number, selectedOption?:any, customization?:any)=>void,
 *  cart: Array,
 *  incItemNoOption?: (item:any, shopId:number)=>void,
 *  decItemNoOption?: (item:any, shopId:number)=>void,
 *  incItemVariant?: (item:any, shopId:number, option:any)=>void,
 *  decItemVariant?: (item:any, shopId:number, option:any)=>void,
 *  selectedShop: number,
 *  setSelectedShop: (shopId:number)=>void,
 *  favorites: number[],
 *  onFavoriteToggle: ()=>void,
 *  userId: string,
 *  hideFavorites?: boolean,
 *  hideShopSelector?: boolean,
 *  showInventory?: boolean
 * }} props
 */
const Menu = ({ menu, addToCart, cart = [], incItemNoOption = () => {}, decItemNoOption = () => {}, incItemVariant = () => {}, decItemVariant = () => {}, selectedShop, setSelectedShop, favorites = [], onFavoriteToggle, userId, hideFavorites = false, hideShopSelector = false, showInventory = false }) => {
  const [dietFilter, setDietFilter] = useState("all");
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [multiOptionQuantities, setMultiOptionQuantities] = useState({}); // optionName -> qty (working state)
  const [variantDrafts, setVariantDrafts] = useState({}); // itemId -> { optionName -> qty }

  if (!menu.length) return <p>Loading menu...</p>;

  const shop = menu.find((s) => s.shopId === selectedShop);
  if (!shop) return <p>Shop not found.</p>;

  // Open modal for variant items; otherwise add immediately
  const handleAddClick = (item) => {
    setSelectedItem(item);
    
    // Inventory guard
    const inv = Number(item.inventory ?? 100);
    const remaining = Math.max(0, inv - qtyInCart(item));
    if (remaining <= 0) {
      toast.error("This item is sold out");
      return;
    }

    if (item.hasOptions && item.options) {
      // Open modal to select multiple variants and quantities, persist per-item until checkout
      const existing = variantDrafts[item.id];
      if (existing) {
        setMultiOptionQuantities(existing);
      } else {
        const init = {};
        item.options.forEach(o => { init[o.name] = 0; });
        setVariantDrafts(prev => ({ ...prev, [item.id]: init }));
        setMultiOptionQuantities(init);
      }
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

  // Toggle favorite state (uses backend), stops card click propagation
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

  // total qty of this item across all variants for selected shop
  const qtyInCart = (item) => {
    return cart
      .filter(c => c.shopId === selectedShop && c.item.id === item.id)
      .reduce((sum, c) => sum + c.quantity, 0);
  };

  // qty for this item without any selected option
  const qtyNoOption = (item) => {
    const entry = cart.find(c => c.shopId === selectedShop && c.item.id === item.id && !c.item.selectedOption);
    return entry ? entry.quantity : 0;
  };

  const renderItem = (item) => {
    const totalQty = qtyInCart(item);
    const inventory = Number(item.inventory ?? 100);
    const remaining = Math.max(0, inventory - totalQty);
    const thisQty = qtyNoOption(item);
    return (
      <div key={item.id} className="menu-item-card" style={totalQty > 0 ? { border: '2px solid #111', boxShadow: '0 0 0 3px rgba(0,0,0,0.05)' } : {}}>
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
          {remaining === 0 && (
            <div style={{ position: 'absolute', top: 8, left: 8, background: '#e74c3c', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
              SOLD OUT
            </div>
          )}
          {(() => {
            if (!item.restockedAt) return null;
            if (remaining === 0) return null;
            const d = new Date(item.restockedAt);
            const now = new Date();
            const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
            if (!sameDay) return null;
            return (
              <div style={{ position: 'absolute', top: 8, right: 8, background: '#2ecc71', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                RESTOCKED
              </div>
            );
          })()}
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: "11px", color: "#666" }}>⏱️ {item.prepTime || 5} mins prep time</span>
            {showInventory && (
              <span style={{ fontSize: 11, color: remaining === 0 ? '#e74c3c' : '#666' }}>Left: {remaining}</span>
            )}
          </div>
          {item.hasOptions && (
            <div style={{ fontSize: "11px", color: "#666", marginBottom: 4 }}>
              {item.options.length} options available
            </div>
          )}
          <div className="menu-item-actions" style={{ minHeight: 48, display: 'flex', alignItems: 'center' }}>
            {(!item.hasOptions && thisQty > 0) ? (
              <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <button
                  className="icon-btn"
                  onClick={() => decItemNoOption(item, selectedShop)}
                  style={{ width: 32, height: 32, background: '#fff', color: '#111', border: '1px solid #111', borderRadius: 6 }}
                >−</button>
                <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{thisQty}</span>
                <button
                  className="icon-btn"
                  onClick={() => {
                    if (remaining <= 0) { toast.error('No more inventory available'); return; }
                    incItemNoOption(item, selectedShop);
                  }}
                  disabled={remaining <= 0}
                  style={{ width: 32, height: 32, background: '#fff', color: '#111', border: '1px solid #111', borderRadius: 6 }}
                >+</button>
              </div>
            ) : (
              <button 
                className="icon-btn" 
                onClick={() => handleAddClick(item)}
                disabled={!item.available || remaining <= 0}
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
                  gap: 6,
                  whiteSpace: 'nowrap'
                }}
              >
                {remaining === 0 ? 'Sold Out' : (
                  <>
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
                  </>
                )}
              </button>
            )}
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

      {/* Options Modal with multi-variant selection and per-variant steppers */}
      {showOptionsModal && selectedItem && (
        <div className="modal-overlay" onClick={() => setShowOptionsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Select Variants for {selectedItem.name}</h3>
            <div style={{ marginTop: 15, display: 'grid', gap: 10 }}>
              {selectedItem.options.map((option, idx) => {
                const qty = multiOptionQuantities[option.name] || 0;
                const checked = qty > 0;
                const totalSelected = Object.values(multiOptionQuantities).reduce((a,b)=>a+(b||0),0);
                const inventory = Number(selectedItem.inventory ?? 100);
                const remaining = Math.max(0, inventory - qtyInCart(selectedItem) - totalSelected + qty);
                return (
                  <div key={idx} className="card" style={{ padding: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && remaining <= 0}
                        onChange={(e) => {
                          setMultiOptionQuantities(prev => {
                            if (e.target.checked) {
                              const totalSelected = Object.values(prev).reduce((a,b)=>a+(b||0),0);
                              const cap = Number(selectedItem.inventory ?? 100) - qtyInCart(selectedItem);
                              if (totalSelected >= cap && qty === 0) {
                                toast.error('No more inventory available');
                                return prev;
                              }
                            }
                            const next = { ...prev, [option.name]: e.target.checked ? (qty || 1) : 0 };
                            setVariantDrafts(d => ({ ...d, [selectedItem.id]: next }));
                            return next;
                          });
                        }}
                      />
                      <span style={{ flex: 1 }}>
                        {option.name}{option.priceModifier > 0 ? ` (+₹${option.priceModifier})` : ''}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => setMultiOptionQuantities(prev => {
                            const next = { ...prev, [option.name]: Math.max(0, (prev[option.name] || 0) - 1) };
                            setVariantDrafts(d => ({ ...d, [selectedItem.id]: next }));
                            return next;
                          })}
                          disabled={!checked}
                        >−</button>
                        <span style={{ width: 24, textAlign: 'center' }}>{qty}</span>
                        <button
                          onClick={() => setMultiOptionQuantities(prev => {
                            const total = Object.values(prev).reduce((a,b)=>a+(b||0),0);
                            if (total >= Number(selectedItem.inventory ?? 100) - qtyInCart(selectedItem)) { toast.error('No more inventory available'); return prev; }
                            const next = { ...prev, [option.name]: (prev[option.name] || 0) + 1 };
                            setVariantDrafts(d => ({ ...d, [selectedItem.id]: next }));
                            return next;
                          })}
                          disabled={!checked || (Number(selectedItem.inventory ?? 100) - qtyInCart(selectedItem) - Object.values(multiOptionQuantities).reduce((a,b)=>a+(b||0),0) <= 0)}
                        >+</button>
                      </div>
                    </label>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <button
                onClick={() => {
                  try {
                    const ops = selectedItem.options || [];
                    ops.forEach((opt) => {
                      const qty = multiOptionQuantities[opt.name] || 0;
                      for (let i = 0; i < qty; i++) incItemVariant(selectedItem, selectedShop, opt);
                    });
                    toast.success("Added to cart");
                  } finally {
                    setShowOptionsModal(false);
                    setSelectedItem(null);
                    // DO NOT clear draft; persist until checkout
                  }
                }}
                style={{ flex: 1, background: "#27ae60" }}
              >
                Add Selected Variants
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