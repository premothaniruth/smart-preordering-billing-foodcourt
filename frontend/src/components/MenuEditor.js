import React, { useState, useEffect } from "react";
import { updateMenu } from "../api";
import { toast } from "react-toastify";

const MenuEditor = ({ token, menu, onUpdate }) => {
  const [selectedShop, setSelectedShop] = useState(1);
  const [items, setItems] = useState([]);

  useEffect(() => {
    const shop = menu.find(s => s.shopId === selectedShop);
    setItems(shop && Array.isArray(shop.items) ? shop.items : []);
  }, [selectedShop, menu]);

  const handleChange = (index, field, value) => {
    const next = [...items];
    if (field === "price" || field === "prepTime" || field === "inventory") value = Number(value) || 0;
    if (field === "available" || field === "isRecommended" || field === "isHotSeller" || field === "isVeg") value = Boolean(value);
    next[index] = { ...next[index], [field]: value };
    setItems(next);
  };

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

  return (
    <div>
      <h2>Menu Editor</h2>
      <div style={{ marginBottom: 20 }}>
        <label>Select Shop:&nbsp;</label>
        <select value={selectedShop} onChange={(e) => setSelectedShop(Number(e.target.value))}>
          {menu.map(shop => (<option key={shop.shopId} value={shop.shopId}>{shop.shopName}</option>))}
        </select>
      </div>

      <button onClick={handleAdd} style={{ marginBottom: 15 }}>+ Add New Item</button>
      <div className="menu-editor-item" style={{ background: '#fff', border: '1px solid #eee' }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontWeight: 600, color: '#2c3e50' }}>
          <div>Item Name</div>
          <div>Price</div>
          <div>Preparation Time (mins)</div>
          <div>Inventory Count</div>
          <div>Image URL</div>
        </div>
      </div>
      
      {items.map((it, idx) => (
        <div key={it.id} className="menu-editor-item">
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>Item Name</div>
            <div>Price</div>
            <div>Preparation Time (mins)</div>
            <div>Inventory Count</div>
            <div>Image URL</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input 
              placeholder="Item Name" 
              value={it.name} 
              onChange={(e) => handleChange(idx, "name", e.target.value)} 
            />
            <input 
              placeholder="Price" 
              type="number" 
              value={it.price} 
              onChange={(e) => handleChange(idx, "price", e.target.value)} 
            />
            <input 
              placeholder="Prep Time (mins)" 
              type="number" 
              value={it.prepTime || 10} 
              onChange={(e) => handleChange(idx, "prepTime", e.target.value)} 
            />
            <input 
              placeholder="Inventory Count"
              type="number"
              value={it.inventory || 0}
              onChange={(e) => handleChange(idx, "inventory", e.target.value)}
            />
            <input 
              placeholder="Image URL" 
              value={it.image} 
              onChange={(e) => handleChange(idx, "image", e.target.value)} 
            />
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
      
      <button onClick={handleSave} style={{ marginTop: 20, background: "#27ae60", padding: "12px 24px" }}>
        Save All Changes
      </button>
    </div>
  );
};

export default MenuEditor;