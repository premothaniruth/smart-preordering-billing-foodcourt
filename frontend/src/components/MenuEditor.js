import React, { useState, useEffect, useMemo } from "react";
import { updateMenu } from "../api";
import { toast } from "react-toastify";

/**
 * MenuEditor
 * Vendor-facing editor for managing items and variants for the current shop.
 * @param {{ token:string, menu:any[], onUpdate: ()=>void }} props
 */

const MenuEditor = ({ token, menu, onUpdate }) => {
  const decodeShopId = () => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.shopId || 1;
    } catch {
      return 1;
    }
  };
  const vendorShopId = decodeShopId();
  const [selectedShop, setSelectedShop] = useState(vendorShopId);
  const [items, setItems] = useState([]);
  const [lowThreshold, setLowThreshold] = useState(10);

  // Sync local items when selected shop or menu changes
  useEffect(() => {
    const shop = menu.find(s => s.shopId === selectedShop);
    setItems(shop && Array.isArray(shop.items) ? shop.items : []);
  }, [selectedShop, menu]);

  const original = useMemo(() => JSON.stringify(items), [selectedShop]);
  const isDirty = useMemo(() => JSON.stringify(items) !== original, [items, original]);

  // Generic handler to update item fields (number/boolean coercion included)
  const handleChange = (index, field, value) => {
    const next = [...items];
    if (field === "price" || field === "prepTime" || field === "inventory") value = Number(value) || 0;
    if (field === "available" || field === "isRecommended" || field === "isHotSeller" || field === "isVeg") value = Boolean(value);
    next[index] = { ...next[index], [field]: value };
    setItems(next);
  };

  // Add a new blank item to the top of the list
  const handleAdd = () => {
    setItems([{ 
      id: Date.now(), 
      name: "", 
      price: 0, 
      available: true, 
      image: "", 
      isRecommended: false, 
      isHotSeller: false,
      isVeg: true,
      prepTime: 10,
      inventory: 0,
      hasOptions: false,
      options: []
    }, ...items]);
  };

  const handleRemove = (index) => {
    const next = [...items];
    next.splice(index, 1);
    setItems(next);
  };

  const handleRestockAll = () => {
    const ok = window.confirm("Restock all items to 100? This will overwrite current inventory counts.");
    if (!ok) return;
    setItems(prev => prev.map(it => ({ ...it, inventory: 100 })));
  };

  const handleRestockLow = () => {
    const lowCount = items.filter(it => Number(it.inventory ?? 0) <= Number(lowThreshold)).length;
    if (lowCount === 0) { toast.info('No low-stock items to restock'); return; }
    const ok = window.confirm(`Restock ${lowCount} low-stock items (≤ ${lowThreshold}) to 100?`);
    if (!ok) return;
    setItems(prev => prev.map(it => (Number(it.inventory ?? 0) <= Number(lowThreshold) ? { ...it, inventory: 100 } : it)));
    toast.success('Updated low-stock items to 100. Click Save Changes to persist.');
  };

  // Persist changes to backend
  const handleSave = async () => {
    try {
      const data = await updateMenu(items, token);
      if (data.status === "success") {
        toast.success("Menu saved successfully");
        onUpdate();
      } else {
        toast.error("Failed to save menu");
      }
    } catch {
      toast.error("Error saving menu");
    }
  };

  const displayItems = useMemo(() => {
    const withIdx = items.map((it, idx) => ({ it, idx }));
    return withIdx.sort((a, b) => {
      const aInv = Number(a.it.inventory || 0);
      const bInv = Number(b.it.inventory || 0);
      const aLow = aInv <= Number(lowThreshold);
      const bLow = bInv <= Number(lowThreshold);
      if (aLow !== bLow) return aLow ? -1 : 1; // low first
      if (aLow && bLow) return aInv - bInv; // both low: lower inv first
      return 0; // otherwise keep relative order
    });
  }, [items, lowThreshold]);

  return (
    <div>
      <h2>Menu Editor</h2>
      <div style={{ marginBottom: 20 }}>
        <label>Editing Shop:&nbsp;</label>
        <strong>{menu.find(s=>s.shopId===vendorShopId)?.shopName || `Shop ${vendorShopId}`}</strong>
      </div>

      {isDirty && (
        <button onClick={handleSave} style={{ marginBottom: 15, background: "#27ae60", padding: "10px 16px" }}>
          Save Changes
        </button>
      )}
      <div style={{ display: 'flex', gap: 10, marginBottom: 15, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={handleAdd}>+ Add New Item</button>
        <button onClick={handleRestockAll} style={{ background: '#2c3e50', color: '#fff' }}>Restock all to 100</button>
        <span style={{ fontSize: 12, color: '#777' }}>Low threshold</span>
        <input type="number" min="0" value={lowThreshold} onChange={(e)=>setLowThreshold(Number(e.target.value)||0)} style={{ width: 80 }} />
        <button onClick={handleRestockLow}>
          Restock low to 100
        </button>
      </div>
      
      {displayItems.map(({ it, idx }) => (
        <div
          key={it.id}
          className="menu-editor-item"
          style={Number(it.inventory || 0) <= Number(lowThreshold)
            ? { borderLeft: '4px solid #e67e22', background: 'rgba(230, 126, 34, 0.06)' }
            : {}}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Item Name</div>
              <input 
                placeholder="Item Name" 
                value={it.name} 
                onChange={(e) => handleChange(idx, "name", e.target.value)} 
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Price</div>
              <input 
                placeholder="Price" 
                type="number" 
                value={it.price} 
                onChange={(e) => handleChange(idx, "price", e.target.value)} 
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Preparation Time (mins)</div>
              <input 
                placeholder="Prep Time (mins)" 
                type="number" 
                value={it.prepTime || 10} 
                onChange={(e) => handleChange(idx, "prepTime", e.target.value)} 
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Inventory Count</div>
              <input 
                placeholder="Inventory Count"
                type="number"
                value={it.inventory || 0}
                onChange={(e) => handleChange(idx, "inventory", e.target.value)}
              />
              {Number(it.inventory || 0) <= Number(lowThreshold) && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#e67e22', fontWeight: 700 }}>Low stock</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Image URL</div>
              <input 
                placeholder="Image URL" 
                value={it.image} 
                onChange={(e) => handleChange(idx, "image", e.target.value)} 
              />
            </div>
          </div>

          {/* Variants Editor */}
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={!!it.hasOptions}
                onChange={(e) => handleChange(idx, "hasOptions", e.target.checked)}
              /> Has Variants
            </label>
            {it.hasOptions && (
              <div style={{ marginTop: 10, padding: 10, background: '#f8f9fa', borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>Variant Name</div>
                  <div>Price Modifier</div>
                </div>
                {(it.options || []).map((opt, oidx) => (
                  <div key={oidx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, marginBottom: 8 }}>
                    <input
                      placeholder="Variant name"
                      value={opt.name || ''}
                      onChange={(e) => {
                        const next = [...items];
                        const opts = [...(next[idx].options || [])];
                        opts[oidx] = { ...opts[oidx], name: e.target.value };
                        next[idx] = { ...next[idx], options: opts };
                        setItems(next);
                      }}
                    />
                    <input
                      type="number"
                      placeholder="Price +"
                      value={opt.priceModifier || 0}
                      onChange={(e) => {
                        const next = [...items];
                        const opts = [...(next[idx].options || [])];
                        opts[oidx] = { ...opts[oidx], priceModifier: Number(e.target.value) || 0 };
                        next[idx] = { ...next[idx], options: opts };
                        setItems(next);
                      }}
                    />
                    <button
                      type="button"
                      style={{ background: '#e74c3c' }}
                      onClick={() => {
                        const next = [...items];
                        const opts = [...(next[idx].options || [])];
                        opts.splice(oidx, 1);
                        next[idx] = { ...next[idx], options: opts };
                        setItems(next);
                      }}
                    >Remove</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const next = [...items];
                    const opts = [...(next[idx].options || [])];
                    opts.push({ name: '', priceModifier: 0 });
                    next[idx] = { ...next[idx], options: opts };
                    setItems(next);
                  }}
                >+ Add Variant</button>
              </div>
            )}
          </div>
          
          <div style={{ marginTop: 10, display: "flex", gap: 15, flexWrap: "wrap" }}>
            <label>
              <input 
                type="checkbox" 
                checked={it.available} 
                onChange={(e) => handleChange(idx, "available", e.target.checked)} 
              /> Available
            </label>
            <label>
              <input 
                type="checkbox" 
                checked={it.isVeg} 
                onChange={(e) => handleChange(idx, "isVeg", e.target.checked)} 
              /> Veg
            </label>
            <label>
              <input 
                type="checkbox" 
                checked={it.isRecommended} 
                onChange={(e) => handleChange(idx, "isRecommended", e.target.checked)} 
              /> Recommended
            </label>
            <label>
              <input 
                type="checkbox" 
                checked={it.isHotSeller} 
                onChange={(e) => handleChange(idx, "isHotSeller", e.target.checked)} 
              /> Hot Seller
            </label>
          </div>
          
          <button 
            onClick={() => handleRemove(idx)} 
            style={{ marginTop: 10, background: "#e74c3c" }}
          >
            Remove Item
          </button>
        </div>
      ))}
      
      {/* Save button moved to top and appears only when dirty */}
    </div>
  );
};

export default MenuEditor;