import React, { useState, useEffect } from "react";
import { updateMenu } from "../api";
import { toast } from "react-toastify";

const MenuEditor = ({ token, menu, onUpdate }) => {
  const [selectedShop, setSelectedShop] = useState(1);
  const [items, setItems] = useState([]);

  useEffect(() => {
    const shop = menu.find(s => s.shopId === selectedShop);
    if (shop) {
      setItems(shop.items);
    }
  }, [selectedShop, menu]);

  const handleChange = (index, field, value) => {
    const next = [...items];
    if (field === "price" || field === "prepTime") value = Number(value) || 0;
    if (field === "available" || field === "isRecommended" || field === "isHotSeller" || field === "isVeg") value = Boolean(value);
    next[index] = { ...next[index], [field]: value };
    setItems(next);
  };

  const handleAdd = () => {
    setItems([...items, { 
      id: Date.now(), 
      name: "", 
      price: 0, 
      available: true, 
      image: "", 
      isRecommended: false, 
      isHotSeller: false,
      isVeg: true,
      prepTime: 10
    }]);
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
      
      {items.map((it, idx) => (
        <div key={it.id} className="menu-editor-item">
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
              placeholder="Image URL" 
              value={it.image} 
              onChange={(e) => handleChange(idx, "image", e.target.value)} 
            />
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