import React, { useState, useEffect } from "react";
import { updateMenu } from "../api";
import { toast } from "react-toastify";

const MenuEditor = ({ token, shopItems }) => {
  const [items, setItems] = useState(shopItems || []);

  useEffect(() => {
    setItems(shopItems || []);
  }, [shopItems]);

  const handleChange = (index, field, value) => {
    const newItems = [...items];
    if(field === "price"){
      value = Number(value) || 0;
    }
    if(field === "available"){
      value = Boolean(value);
    }
    newItems[index][field] = value;
    setItems(newItems);
  };

  const handleAdd = () => {
    setItems([...items, { id: Date.now(), name: "", price: 0, available: true }]);
  };

  const handleRemove = (index) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleSave = async () => {
    try {
      const data = await updateMenu(items, token);
      if (data.status === "success") toast.success("Menu saved");
      else toast.error("Failed to save menu");
    } catch {
      toast.error("Error saving menu");
    }
  };

  return (
    <div>
      <h2>Menu Editor</h2>
      <button onClick={handleAdd}>Add Item</button>
      {items.map((item, i) => (
        <div key={item.id} style={{ marginBottom: "10px", border: "1px solid #ccc", padding: "10px" }}>
          <input
            type="text"
            placeholder="Name"
            value={item.name}
            onChange={(e) => handleChange(i, "name", e.target.value)}
          />
          <input
            type="number"
            placeholder="Price"
            value={item.price}
            onChange={(e) => handleChange(i, "price", e.target.value)}
            style={{ marginLeft: "10px" }}
          />
          <label style={{ marginLeft: "10px" }}>
            <input
              type="checkbox"
              checked={item.available}
              onChange={(e) => handleChange(i, "available", e.target.checked)}
            />
            Available
          </label>
          <button onClick={() => handleRemove(i)} style={{ marginLeft: "10px" }}>
            Remove
          </button>
        </div>
      ))}
      <button onClick={handleSave}>Save Menu</button>
    </div>
  );
};

export default MenuEditor;