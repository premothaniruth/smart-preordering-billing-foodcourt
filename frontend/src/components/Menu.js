import React, { useEffect, useMemo, useRef, useState } from "react";
import { toggleFavorite, fetchActiveOffers, fetchCombos, fetchMenuSections, fetchSectionsMeta } from "../api";
import { toast } from "react-toastify";

const toHM = (date = new Date()) => {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

const isHmWithinWindow = (hm, windowInfo) => {
  if (!windowInfo || !windowInfo.start || !windowInfo.end) return true;
  const { start, end } = windowInfo;
  if (!start || !end) return true;
  if (start === end) return true;
  if (start < end) {
    return hm >= start && hm <= end;
  }
  // Window spans midnight (e.g., 22:00 - 02:00)
  return hm >= start || hm <= end;
};

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
 *  showInventory?: boolean,
 *  activeSection?: string | null,
 *  onActiveSectionChange?: (section: string | null) => void
 * }} props
 */
const Menu = ({ menu, addToCart, cart = [], incItemNoOption = () => {}, decItemNoOption = () => {}, incItemVariant = () => {}, decItemVariant = () => {}, selectedShop, setSelectedShop, favorites = [], cartShopMismatch = false, onFavoriteToggle, userId, hideFavorites = false, hideShopSelector = false, showInventory = false, readOnly = false, scheduledTime = '', activeSection: activeSectionProp = null, onActiveSectionChange }) => {
  const [vegOnly, setVegOnly] = useState(false);
  const [nonVegOnly, setNonVegOnly] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [multiOptionQuantities, setMultiOptionQuantities] = useState({}); // optionName -> qty (working state)
  const [variantDrafts, setVariantDrafts] = useState({}); // itemId -> { optionName -> qty }
  const [offers, setOffers] = useState([]);
  const [combos, setCombos] = useState([]);
  const [sectioned, setSectioned] = useState(null); // { shopId, shopName, sections }
  const [activeSection, setActiveSection] = useState(activeSectionProp || null);
  const [sectionWindows, setSectionWindows] = useState({}); // name -> { start, end }
  const [currentHm, setCurrentHm] = useState(toHM());

  useEffect(() => {
    if (activeSectionProp === undefined) return;
    if (activeSectionProp !== activeSection) {
      setActiveSection(activeSectionProp || null);
    }
  }, [activeSectionProp]);

  useEffect(() => {
    if (typeof onActiveSectionChange === 'function') {
      onActiveSectionChange(activeSection || null);
    }
  }, [activeSection, onActiveSectionChange]);

  useEffect(() => {
    const id = setInterval(() => setCurrentHm(toHM()), 60000);
    return () => clearInterval(id);
  }, []);

  const scheduledDate = useMemo(() => {
    if (!scheduledTime) return null;
    const parsed = new Date(scheduledTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [scheduledTime]);

  const scheduledHm = useMemo(() => (scheduledDate ? toHM(scheduledDate) : null), [scheduledDate]);
  const scheduledInFuture = useMemo(() => (scheduledDate ? scheduledDate.getTime() > Date.now() : false), [scheduledDate]);

  const resolveSectionWindow = (item) => {
    const candidates = [item?.section, item?.sectionName, item?.category, item?.categoryName];
    for (const key of candidates) {
      if (!key) continue;
      const win = sectionWindows[key];
      if (win) return win;
    }
    return null;
  };

  const computeItemAvailability = (item) => {
    const hm = scheduledHm || currentHm;
    const sectionWindow = resolveSectionWindow(item);
    const withinSectionWindow = isHmWithinWindow(hm, sectionWindow);
    const itemWindow = item?.availableStart && item?.availableEnd ? { start: item.availableStart, end: item.availableEnd } : null;
    const withinItemWindow = itemWindow ? isHmWithinWindow(hm, itemWindow) : true;
    const isAvailableFlag = item?.available !== false;
    const allowedNow = isAvailableFlag && withinSectionWindow && withinItemWindow;

    const sectionSameDay = hasSameDayAvailability(sectionWindow, currentHm);
    const itemSameDay = hasSameDayAvailability(itemWindow, currentHm);
    const sameDayAvailable = sectionSameDay && itemSameDay;

    const scheduledWithinWindow = scheduledHm
      ? (!sectionWindow || isHmWithinWindow(scheduledHm, sectionWindow)) && (!itemWindow || isHmWithinWindow(scheduledHm, itemWindow))
      : false;

    const canPreOrder = scheduledInFuture && scheduledWithinWindow && sameDayAvailable;
    const allowAction = allowedNow || canPreOrder;
    const nextDayOnly = !sameDayAvailable;
    return { hm, sectionWindow, itemWindow, allowedNow, canPreOrder, allowAction, nextDayOnly };
  };

  useEffect(() => {
    if (!selectedShop) return;
    fetchActiveOffers(selectedShop).then(setOffers).catch(()=>setOffers([]));
    fetchCombos(selectedShop, true).then(setCombos).catch(()=>setCombos([]));
    fetchMenuSections(selectedShop)
      .then((data) => {
        setSectioned(data);
        if (data && Array.isArray(data.sections) && data.sections.length > 0) {
          setActiveSection((current) => {
            if (current && data.sections.some((sec) => sec.name === current)) {
              return current;
            }
            if (activeSectionProp && data.sections.some((sec) => sec.name === activeSectionProp)) {
              return activeSectionProp;
            }
            return data.sections[0].name;
          });
        } else {
          setActiveSection(null);
        }
      })
      .catch(()=>{ setSectioned(null); setActiveSection(null); });
    fetchSectionsMeta().then((d)=> setSectionWindows(d?.windows || {})).catch(()=>setSectionWindows({}));
  }, [selectedShop]);

  useEffect(() => {
    if (cart.length !== 0) return;
    setVariantDrafts((prev) => (prev && Object.keys(prev).length ? {} : prev));
    setMultiOptionQuantities((prev) => (prev && Object.keys(prev).length ? {} : prev));
    setSelectedOption(null);
    setSelectedItem(null);
    setShowOptionsModal(false);
  }, [cart.length]);

  const availableShops = useMemo(() => menu || [], [menu]);
  const [shopMenuOpen, setShopMenuOpen] = useState(false);
  const shopMenuRef = useRef(null);

  useEffect(() => {
    if (!shopMenuOpen) return;
    const handleClickOutside = (event) => {
      if (shopMenuRef.current && !shopMenuRef.current.contains(event.target)) {
        setShopMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [shopMenuOpen]);

  const currentShop = useMemo(() => {
    return availableShops.find((shop) => String(shop.shopId) === String(selectedShop)) || null;
  }, [availableShops, selectedShop]);

  if (!menu.length) return <p>Loading menu...</p>;

  const shop = menu.find((s) => s.shopId === selectedShop);
  if (!shop) return <p>Shop not found.</p>;
  const shopIcon = null;

  // Open modal for variant items; otherwise add immediately
  const handleAddClick = (item) => {
    const { allowAction, nextDayOnly } = computeItemAvailability(item);

    if (cartShopMismatch) {
      toast.warn("Cart already has items from another shop. Please place separate orders.");
      return;
    }
    if (!allowAction) {
      toast.info(nextDayOnly ? 'Available from next day' : 'Currently unavailable');
      return;
    }
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

  const renderComboCard = (combo) => {
    const components = Array.isArray(combo.components) ? combo.components : [];
    const comboAvail = computeItemAvailability({
      section: combo?.section,
      sectionName: combo?.sectionName,
      category: combo?.category,
      categoryName: combo?.categoryName,
      availableStart: combo?.availableStart,
      availableEnd: combo?.availableEnd,
      available: combo?.available
    });
    const { sectionWindow, itemWindow, nextDayOnly: comboNextDayOnly } = comboAvail;
    const comboAllowed = comboAvail.allowAction;
    // Derive combo capacity from component inventories
    const findItem = (id) => (shop && Array.isArray(shop.items)) ? shop.items.find(i => Number(i.id) === Number(id)) : null;
    // Build consumed counts per item id from current cart (singles and combos)
    const consumedByItemId = (() => {
      const map = new Map();
      for (const line of cart) {
        if (line.item?.comboId && Array.isArray(line.item?.comboComponents)) {
          for (const comp of line.item.comboComponents) {
            const need = Math.max(1, Number(comp.quantity || 1));
            map.set(comp.itemId, (map.get(comp.itemId) || 0) + need * Number(line.quantity || 0));
          }
        } else if (line.item && line.item.id != null) {
          map.set(Number(line.item.id), (map.get(Number(line.item.id)) || 0) + Number(line.quantity || 0));
        }
      }
      return map;
    })();
    const capacity = (() => {
      if (!components.length) return 0;
      let cap = Infinity;
      for (const c of components) {
        const it = findItem(c.itemId);
        const inv = Number(it?.inventory ?? 0);
        const need = Math.max(1, Number(c?.quantity || 1));
        const consumed = Number(consumedByItemId.get(Number(c.itemId)) || 0);
        const remainingUnits = Math.max(0, inv - consumed);
        const possible = Math.floor(remainingUnits / need);
        cap = Math.min(cap, possible);
      }
      return Number.isFinite(cap) ? cap : 0;
    })();
    const inCartCombo = cart.filter(c => c.shopId === selectedShop && c.item?.comboId === combo.id).reduce((s, c) => s + c.quantity, 0);
    const stockLeft = Math.max(0, capacity - inCartCombo);
    const compLines = components.map((c, idx) => {
      const base = c && (c.name || ((shop && Array.isArray(shop.items)) ? (shop.items.find(i => Number(i.id) === Number(c.itemId))?.name) : null) || 'Item');
      const qty = Number(c?.quantity || 1);
      const opt = c?.option ? ` (${c.option})` : '';
      return (
        <div key={idx} style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, color:'#555' }}>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{base}{opt}</span>
          <span style={{ color:'#333' }}>×{qty}</span>
        </div>
      );
    });
    const handleAddCombo = () => {
      if (cartShopMismatch) { toast.warn("Cart already has items from another shop. Please place separate orders."); return; }
      if (stockLeft <= 0) { toast.error('No more combos available to order'); return; }
      if (!comboAllowed) { toast.info(comboNextDayOnly ? 'Order opens next day' : 'Next order window not open yet'); return; }
      const synthetic = {
        id: 1000000 + Number(combo.id || 0),
        comboId: combo.id,
        name: combo.name || 'Combo',
        price: Number(combo.price || 0),
        available: stockLeft > 0,
        image: '',
        prepTime: 10,
        inventory: stockLeft,
        comboComponents: components.map(c => ({ itemId: Number(c.itemId)||0, quantity: Number(c.quantity)||1 }))
      };
      addToCart(synthetic, selectedShop, null, {});
      toast.success(`${combo.name} combo added to cart!`);
    };
    return (
      <div key={combo.id} className="menu-item-card">
        <div className="menu-item-content">
          <div className="menu-item-name">{combo.name}</div>
          <div className="menu-item-price">
            ₹{combo.price}
            {(comboAvail.itemWindow?.start && comboAvail.itemWindow?.end) && (
              <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>({comboAvail.itemWindow.start}-{comboAvail.itemWindow.end})</span>
            )}
          </div>
          {(() => {
            if (!comboAllowed) {
              return (
                <div style={{ position: 'absolute', top: 8, left: 8, background: '#7f8c8d', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                  {comboNextDayOnly ? 'NEXT DAY' : 'NEXT WINDOW'}
                </div>
              );
            }
            if (stockLeft === 0) {
              return (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 8, left: 0, background: '#e74c3c', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                    SOLD OUT
                  </div>
                </div>
              );
            }
          })()}
          <div style={{ fontSize: 12, color: '#666', margin: '6px 0' }}>Combo Offer</div>
          {components.length > 0 && (
            <div className="card" style={{ background:'#fafafa', border:'1px solid #eee', padding:8, margin:'6px 0' }}>
              <div style={{ fontWeight:600, fontSize:12, color:'#333', marginBottom:6 }}>Includes</div>
              <div style={{ display:'grid', gap:4 }}>
                {compLines}
              </div>
            </div>
          )}
          {showInventory && (
            <div style={{ fontSize: 11, color: stockLeft === 0 ? '#e74c3c' : '#666', marginBottom: 6 }}>Left: {stockLeft}</div>
          )}
          {!readOnly && (
            <button
              className="icon-btn"
              onClick={handleAddCombo}
              disabled={!comboAllowed || stockLeft <= 0 || cartShopMismatch}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#fff',
                color: '#111',
                border: "1px solid #111",
                borderRadius: 6,
                opacity: comboAllowed && stockLeft > 0 ? 1 : 0.6
              }}
            >
              {comboAllowed ? (stockLeft > 0 ? 'Add Combo' : 'Sold Out') : 'Next order is from tomorrow'}
            </button>
          )}
        </div>
      </div>
    );
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
    const { allowAction, allowedNow, sectionWindow, itemWindow } = itemAvail;
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
      {offers && offers.length > 0 && (
        <div className="card" style={{ marginBottom: 12, background: '#fff8e6', border: '1px solid #f1c40f' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Special Offers</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {offers.map((o)=> (
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