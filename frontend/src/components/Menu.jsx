  import React, { useEffect, useMemo, useRef, useState } from "react";
import { toggleFavorite, fetchActiveOffers, fetchCombos, fetchMenuSections, fetchSectionsMeta, expressInterest } from "../api";
import { toast } from "react-toastify";

const toHM = (date = new Date()) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const Menu = ({
  menu,
  addToCart,
  cart = [],
  incItemNoOption = () => {},
  decItemNoOption = () => {},
  incItemVariant = () => {},
  decItemVariant = () => {},
  selectedShop,
  setSelectedShop,
  favorites = [],
  cartShopMismatch = false,
  onFavoriteToggle,
  userId,
  hideFavorites = false,
  hideShopSelector = false,
  showInventory = false,
  readOnly = false,
  scheduledTime = '',
  activeSection: activeSectionProp = null,
  onActiveSectionChange,
  employeeToken = null,
}) => {
  const [vegOnly, setVegOnly] = useState(false);
  const [nonVegOnly, setNonVegOnly] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [multiOptionQuantities, setMultiOptionQuantities] = useState({});
  const [variantDrafts, setVariantDrafts] = useState({});
  const [offers, setOffers] = useState([]);
  const [combos, setCombos] = useState([]);
  const [sectioned, setSectioned] = useState(null);
  const [activeSection, setActiveSection] = useState(activeSectionProp || null);
  const [sectionWindows, setSectionWindows] = useState({});
  const [currentHm, setCurrentHm] = useState(toHM());
  const [interestSummaries, setInterestSummaries] = useState({});
  const [interestPending, setInterestPending] = useState(false);
  const interestCooldownsRef = useRef(new Map()); // key -> timestamp

  const interestKey = (item) => `${selectedShop}:${item?.id}`;

  const isLowStockOrSoldOut = (item) => {
    if (!item) return { lowStock: false, soldOut: false };
    const inventory = Number(item.inventory ?? 0);
    if (!Number.isFinite(inventory)) return { lowStock: false, soldOut: false };
    const threshold = Number(item.lowStockThreshold ?? item.lowStockLimit ?? item.lowStock ?? 5);
    const soldOut = inventory <= 0;
    const lowStock = !soldOut && (Number.isFinite(threshold) ? inventory <= threshold : inventory <= 5);
    return { lowStock, soldOut };
  };

  const canShowInterest = (item) => {
    if (!item || readOnly) return false;
    if (!employeeToken) return false;
    if (!shop || String(item.shopId ?? selectedShop) !== String(selectedShop)) return false;
    const { lowStock, soldOut } = isLowStockOrSoldOut(item);
    return lowStock || soldOut;
  };

  const handleExpressInterest = async (item) => {
    if (!item || interestPending) return;
    if (!employeeToken) {
      toast.info('Please sign in as an employee to express interest.');
      return;
    }

    const key = interestKey(item);
    const now = Date.now();
    const cooldownUntil = interestCooldownsRef.current.get(key) || 0;
    if (now < cooldownUntil) {
      const delta = Math.ceil((cooldownUntil - now) / 1000);
      toast.info(`Please wait ${delta}s before expressing interest again.`);
      return;
    }

    try {
      setInterestPending(true);
      const response = await expressInterest({ token: employeeToken, shopId: selectedShop, itemId: item.id });
      const status = response?.status;
      const summary = response?.summary;
      const cooldownMs = Number(response?.cooldownMs || 0);
      if (cooldownMs > 0) {
        interestCooldownsRef.current.set(key, now + cooldownMs);
      }

      if (status === 'duplicate') {
        toast.info('Interest already recorded recently.');
      } else {
        toast.success('Interest recorded!');
      }

      if (summary) {
        const interestedCount = summary.uniqueEmployees ?? summary.totalClicks ?? 0;
        setInterestSummaries((prev) => ({ ...prev, [key]: summary, lastUpdated: Date.now() }));
        if (interestedCount > 0) {
          toast.info(`${interestedCount} employee${interestedCount === 1 ? '' : 's'} interested in ${summary.metadata?.itemName || item.name}`);
        }
      }
    } catch (error) {
      console.error('Express interest failed', error);
      toast.error('Failed to express interest. Please try again.');
    } finally {
      setInterestPending(false);
    }
  };

  let filteredItems = shop.items;
  if (vegOnly) filteredItems = filteredItems.filter(item => item.isVeg);
  else if (nonVegOnly) filteredItems = filteredItems.filter(item => !item.isVeg);

  const sectionItems = (() => {
    if (!sectioned || !Array.isArray(sectioned.sections) || !activeSection) return filteredItems;
    const sec = sectioned.sections.find((s) => s.name === activeSection);
    if (!sec) return filteredItems;
    let items = sec.items || [];
    if (vegOnly) items = items.filter(it => it.isVeg);
    else if (nonVegOnly) items = items.filter(it => !it.isVeg);
    return items;
  })();

  const favoriteItems = sectionItems.filter(item => isFavorite(item.id));
  const recommended = sectionItems.filter(item => item.isRecommended && !isFavorite(item.id));
  const hotSellers = sectionItems.filter(item => item.isHotSeller && !item.isRecommended && !isFavorite(item.id));
  const regularItems = sectionItems.filter(item => !item.isRecommended && !item.isHotSeller && !isFavorite(item.id));

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
    const cartRemaining = Math.max(0, inventory - totalQty);
    const stockLeft = Math.max(0, inventory);
    const thisQty = qtyNoOption(item);
    const itemAvail = computeItemAvailability(item);
    const { allowAction, allowedNow, sectionWindow, itemWindow, nextDayOnly } = itemAvail;
    return (
      <div key={item.id} className="menu-item-card" style={totalQty > 0 ? { border: '2px solid #111', boxShadow: '0 0 0 3px rgba(0,0,0,0.05)' } : {}}>
        <div style={{ position: "relative" }}>
          <img 
            src={item.image && item.image.startsWith('http') ? item.image : `http://localhost:3001${item.image}`}
            alt={item.name} 
            className="menu-item-image"
            onError={(e) => {
              e.target.src = "https://dummyimage.com/200x150/95a5a6/ffffff&text=No+Image";
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
          {!allowAction && (
            <div style={{ position: 'absolute', top: 8, left: 8, background: '#7f8c8d', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
              {nextDayOnly ? 'NEXT DAY' : 'NEXT WINDOW'}
            </div>
          )}
          {stockLeft === 0 && allowAction && (
            <div style={{ position: 'absolute', top: 8, left: 8, background: '#e74c3c', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
              SOLD OUT
            </div>
          )}
          {stockLeft > 0 && stockLeft <= 10 && allowAction && (
            <div style={{ position: 'absolute', top: 8, left: 8, background: '#e67e22', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
              FEW LEFT
            </div>
          )}
          {(() => {
            if (!item.restockedAt) return null;
            if (stockLeft === 0) return null;
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
          <div className="menu-item-price">
            {(() => {
              const hasMods = item.hasOptions && Array.isArray(item.options) && item.options.some(o => Number(o.priceModifier || 0) > 0);
              return `₹${item.price}${hasMods ? '+' : ''}`;
            })()}
          </div>
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
              <span style={{ fontSize: 11, color: stockLeft === 0 ? '#e74c3c' : '#666' }}>Left: {stockLeft}</span>
            )}
          </div>
          {item.hasOptions && (
            <div style={{ fontSize: "11px", color: "#666", marginBottom: 4 }}>
              {item.options.length} options available
            </div>
          )}
          {!readOnly && (
          <div className="menu-item-actions" style={{ minHeight: 48, display: 'flex', alignItems: 'center' }}>
            {(!item.hasOptions && thisQty > 0 && allowAction) ? (
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
                    if (cartRemaining <= 0) { toast.error('No more items available to order'); return; }
                    if (cartShopMismatch) {
                      toast.warn("Cart already has items from another shop. Please place separate orders.");
                      return;
                    }
                    if (!allowAction) {
                      toast.info(nextDayOnly ? 'Available from next day' : 'Currently unavailable');
                      return;
                    }
                    incItemNoOption(item, selectedShop);
                  }}
                  disabled={cartRemaining <= 0 || cartShopMismatch || !allowAction}
                  style={{ width: 32, height: 32, background: '#fff', color: '#111', border: '1px solid #111', borderRadius: 6 }}
                >+</button>
              </div>
            ) : (
              <button 
                className="icon-btn" 
                onClick={() => handleAddClick(item)}
                disabled={!allowAction || cartRemaining <= 0 || cartShopMismatch}
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
                {stockLeft === 0 ? 'Sold Out' : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="10" cy="20" r="1"/>
                      <circle cx="18" cy="20" r="1"/>
                      <path d="M2 2h2l3.6 7.59a2 2 0 0 0 1.8 1.17H17a2 2 0 0 0 2-1.5l1.38-5.5H6"/>
                    </svg>
                    Add to Cart
                  </>
                )}
              </button>
            )}
            {cartRemaining <= 0 && stockLeft > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#e74c3c', textAlign: 'center', width: '100%' }}>
                No more items available to order
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2>Menu</h2>
      {offersForActiveSection.length > 0 && (
        <div className="card" style={{ marginBottom: 12, background: '#fff8e6', border: '1px solid #f1c40f' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Special Offers</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {offersForActiveSection.map((o)=> (
              <span key={o.id} className="menu-item-badge" style={{ borderColor: '#f1c40f', color: '#8a6d3b' }}>{o.bannerText || o.title}</span>
            ))}
          </div>
        </div>
      )}
      <div className="filter-section" style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginBottom: 12 }}>
        {!hideShopSelector && (
          <div className="menu-shop-selector">
            <label>Choose Shop:</label>
            <div className="shop-dropdown" ref={shopMenuRef}>
              <button
                type="button"
                className="secondary-button shop-selector-trigger"
                onClick={() => setShopMenuOpen((prev) => !prev)}
              >
                <span className="shop-selector-label compact">
                  <span className="shop-selector-text">{currentShop ? currentShop.shopName : "Select Shop"}</span>
                </span>
              </button>
              {shopMenuOpen && (
                <div className="concern-dropdown" style={{ minWidth: 220 }}>
                  {availableShops.length === 0 && (
                    <div className="dropdown-empty">No shops available</div>
                  )}
                  {availableShops.map((shop) => (
                    <button
                      type="button"
                      key={shop.shopId}
                      onClick={() => {
                        setSelectedShop(Number(shop.shopId));
                        setShopMenuOpen(false);
                        if (typeof onActiveSectionChange === "function") {
                          onActiveSectionChange(null);
                        }
                      }}
                    >
                      <span className="shop-name">{shop.shopName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div style={{ display:'inline-flex', alignItems:'center', gap:10, background:'#fff', border:'none', borderRadius:12, padding:'6px 12px' }}>
          <span aria-hidden title="Veg only" style={{ color:'#27ae60' }}>🌿</span>
          <label style={{ display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer' }}>
            <span style={{ fontSize: 13 }}>Veg only</span>
            <input
              type="checkbox"
              checked={vegOnly}
              onChange={(e)=>{ const v = e.target.checked; setVegOnly(v); if (v) setNonVegOnly(false); }}
              style={{ display:'none' }}
            />
            <span aria-hidden style={{ width:36, height:20, borderRadius:12, background: vegOnly ? '#27ae60' : '#ccc', position:'relative', transition:'all 0.2s' }}>
              <span style={{ position:'absolute', top:2, left: vegOnly ? 18 : 2, width:16, height:16, background:'#fff', borderRadius:'50%', transition:'left 0.2s' }} />
            </span>
          </label>
        </div>
        <div style={{ display:'inline-flex', alignItems:'center', gap:10, background:'#fff', border:'none', borderRadius:12, padding:'6px 12px' }}>
          <span aria-hidden title="Non-veg only" style={{ color:'#e74c3c' }}>🍗</span>
          <label style={{ display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer' }}>
            <span style={{ fontSize: 13 }}>Non-veg only</span>
            <input
              type="checkbox"
              checked={nonVegOnly}
              onChange={(e)=>{ const v = e.target.checked; setNonVegOnly(v); if (v) setVegOnly(false); }}
              style={{ display:'none' }}
            />
            <span aria-hidden style={{ width:36, height:20, borderRadius:12, background: nonVegOnly ? '#e74c3c' : '#ccc', position:'relative', transition:'all 0.2s' }}>
              <span style={{ position:'absolute', top:2, left: nonVegOnly ? 18 : 2, width:16, height:16, background:'#fff', borderRadius:'50%', transition:'left 0.2s' }} />
            </span>
          </label>
        </div>
      </div>
      {combos && combos.length > 0 && (
        <>
          <h3>🎁 Combo Offers</h3>
          <div className="menu-grid">
            {combos.map(renderComboCard)}
          </div>
        </>
      )}

      {sectioned && Array.isArray(sectioned.sections) && sectioned.sections.length > 0 && (
        <div className="section-tabs">
          {(() => {
            const order = { Breakfast: 1, Lunch: 2, Dinner: 3 };
            return sectioned.sections
              .slice()
              .sort((a, b) => (order[a.name] || 10) - (order[b.name] || 10))
              .map((sec) => (
                <button
                  key={sec.name}
                  type="button"
                  className={`section-tab ${activeSection === sec.name ? 'active' : ''}`}
                  onClick={() => setActiveSection(sec.name)}
                >
                  <span>{sec.name}</span>
                  {(() => {
                    const w = sectionWindows[sec.name];
                    if (!w || !w.start || !w.end) return null;
                    return <small>{w.start}-{w.end}</small>;
                  })()}
                </button>
              ));
          })()}
        </div>
      )}

      {sectionItems && sectionItems.length > 0 && (
        <>
          {favoriteItems.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>❤️ Favorite Picks</h4>
              <div className="menu-grid">{favoriteItems.map(renderItem)}</div>
            </>
          )}
          {hotSellers.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>🔥 Hot Sellers</h4>
              <div className="menu-grid">{hotSellers.map(renderItem)}</div>
            </>
          )}
          {recommended.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>🌟 Recommended</h4>
              <div className="menu-grid">{recommended.map(renderItem)}</div>
            </>
          )}
          {regularItems.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>All Items</h4>
              <div className="menu-grid">{regularItems.map(renderItem)}</div>
            </>
          )}
        </>
      )}

      {sectionItems.length === 0 && (
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