import React, { useState, useEffect, useMemo } from "react";
import { updateMenu, fetchSectionsMeta, uploadVendorImage, preprocessVendorImage, uploadVendorImagePrepared } from "../api";
import { toast } from "react-toastify";

/**
 * MenuEditor
 * Vendor-facing editor for managing items and variants for the current shop.
 * @param {{ token:string, menu:any[], onUpdate: ()=>void, targetItemId?: number|string }} props
 */

const MenuEditor = ({ token, menu, onUpdate, targetItemId }) => {
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
  const [highlightId, setHighlightId] = useState(null);
  const [sectionNames, setSectionNames] = useState([]);
  const [dragItemId, setDragItemId] = useState(null);
  const [sectionFilter, setSectionFilter] = useState('');
  const [pendingUploads, setPendingUploads] = useState({}); // itemId -> { dataUrl, size, name, mime, base64 }

  // Sync local items when selected shop or menu changes
  useEffect(() => {
    const shop = menu.find(s => s.shopId === selectedShop);
    setItems(shop && Array.isArray(shop.items) ? shop.items : []);
  }, [selectedShop, menu]);

  // Load section names
  useEffect(() => {
    fetchSectionsMeta().then((d)=>{
      setSectionNames(Array.isArray(d?.names) ? d.names : []);
    }).catch(()=>setSectionNames([]));
  }, []);

  // Auto-scroll to deep-linked item from dashboard and briefly highlight
  useEffect(() => {
    if (!targetItemId) return;
    const el = document.getElementById(`menu-item-${targetItemId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(Number(targetItemId));
      try { window.dispatchEvent(new CustomEvent('menu:clear-target')); } catch {}
      const t = setTimeout(() => setHighlightId(null), 2500);
      return () => clearTimeout(t);
    }
  }, [targetItemId, items]);

  const original = useMemo(() => JSON.stringify(items), [selectedShop]);
  const isDirty = useMemo(() => JSON.stringify(items) !== original, [items, original]);

  // Generic handler to update item fields (number/boolean coercion included)
  const handleChange = (index, field, value) => {
    const next = [...items];
    if (field === "price" || field === "prepTime" || field === "inventory") value = Number(value) || 0;
    if (field === "available" || field === "isRecommended" || field === "isHotSeller" || field === "isVeg") value = Boolean(value);
    if (field === "inventory") {
      const prevInv = Number(items[index]?.inventory || 0);
      const newInv = Number(value) || 0;
      if (newInv > prevInv) {
        next[index] = { ...next[index], [field]: newInv, restockedAt: new Date().toISOString() };
      } else {
        next[index] = { ...next[index], [field]: newInv };
      }
    } else {
      next[index] = { ...next[index], [field]: value };
    }
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
      options: [],
      section: sectionNames[0] || "Breakfast"
    }, ...items]);
  };

  const handleRemove = (index) => {
    const next = [...items];
    next.splice(index, 1);
    setItems(next);
  };

  const [restockValue, setRestockValue] = useState(100);

  const applyRestockLow = () => {
    const lowCount = items.filter(it => Number(it.inventory ?? 0) <= Number(lowThreshold)).length;
    if (lowCount === 0) { toast.info('No low-stock items to restock'); return; }
    const ok = window.confirm(`Set inventory to ${restockValue} for ${lowCount} low-stock items (≤ ${lowThreshold})?`);
    if (!ok) return;
    const now = new Date().toISOString();
    setItems(prev => prev.map(it => (Number(it.inventory ?? 0) <= Number(lowThreshold) ? { ...it, inventory: Number(restockValue) || 0, restockedAt: now } : it)));
    toast.success('Updated low-stock items. Click Save Changes to persist.');
  };

  const applyRestockAll = () => {
    const ok = window.confirm(`Set inventory to ${restockValue} for all items?`);
    if (!ok) return;
    const now = new Date().toISOString();
    setItems(prev => prev.map(it => ({ ...it, inventory: Number(restockValue) || 0, restockedAt: now })));
    toast.success('Updated all items. Click Save Changes to persist.');
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

  const handleDragStart = (id) => setDragItemId(id);
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDropOn = (targetId) => {
    if (!dragItemId || dragItemId === targetId) return;
    const dragItem = items.find(it => it.id === dragItemId);
    const targetItem = items.find(it => it.id === targetId);
    if (!dragItem || !targetItem) return;
    // Reorder only within same section
    const sec = dragItem.section || '';
    if ((targetItem.section || '') !== sec) return;
    const sectionItems = items.filter(it => (it.section || '') === sec);
    const others = items.filter(it => (it.section || '') !== sec);
    const order = sectionItems.slice().sort((a,b)=>Number(a.sectionOrder||0)-Number(b.sectionOrder||0));
    const fromIdx = order.findIndex(x=>x.id===dragItemId);
    const toIdx = order.findIndex(x=>x.id===targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const moved = order.splice(fromIdx,1)[0];
    order.splice(toIdx,0,moved);
    // Re-assign sectionOrder
    const reassigned = order.map((it, i) => ({ ...it, sectionOrder: i }));
    // Merge back
    const next = [...others, ...reassigned];
    setItems(next);
    setDragItemId(null);
  };

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
        <span style={{ fontSize: 12, color: '#777' }}>Restock to</span>
        <input type="number" min="0" value={restockValue} onChange={(e)=>setRestockValue(Number(e.target.value)||0)} style={{ width: 100 }} />
        <span style={{ fontSize: 12, color: '#777' }}>Low threshold</span>
        <input type="number" min="0" value={lowThreshold} onChange={(e)=>setLowThreshold(Number(e.target.value)||0)} style={{ width: 80 }} />
        <button onClick={applyRestockLow}>Restock low</button>
        <button onClick={applyRestockAll}>Restock all</button>
        <span style={{ fontSize: 12, color: '#777' }}>Filter section</span>
        <select value={sectionFilter} onChange={(e)=>setSectionFilter(e.target.value)}>
          <option value="">All</option>
          {sectionNames.map(s => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>
      
      {displayItems
        .filter(({ it }) => !sectionFilter || (it.section || '') === sectionFilter)
        .map(({ it, idx }) => (
        <div
          key={it.id}
          className="menu-editor-item"
          id={`menu-item-${it.id}`}
          draggable
          onDragStart={() => handleDragStart(it.id)}
          onDragOver={handleDragOver}
          onDrop={() => handleDropOn(it.id)}
          style={Number(it.inventory || 0) <= Number(lowThreshold)
            ? { borderLeft: '4px solid #e67e22', background: 'rgba(230, 126, 34, 0.06)' }
            : { ...((highlightId === it.id) ? { outline: '2px solid #3498db', boxShadow: '0 0 0 4px rgba(52,152,219,0.15)' } : {}) }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 10, alignItems: 'start' }}>
            <div title="Drag to reorder within section" style={{ cursor: 'grab', userSelect: 'none', paddingTop: 22 }} aria-hidden>
              ☰
            </div>
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
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Section</div>
              <select
                value={it.section || ''}
                onChange={(e)=>handleChange(idx, 'section', e.target.value)}
              >
                <option value="">Select section</option>
                {sectionNames.map((s)=> (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Section Order</div>
              <input
                type="number"
                placeholder="Order"
                value={Number(it.sectionOrder || 0)}
                onChange={(e)=>handleChange(idx, 'sectionOrder', Number(e.target.value)||0)}
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
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input 
                  placeholder="Image URL" 
                  value={it.image} 
                  onChange={(e) => handleChange(idx, "image", e.target.value)} 
                  style={{ flex:1 }}
                />
                <button
                  type="button"
                  onClick={() => { handleChange(idx, 'image', ''); toast.info('Image removed'); }}
                  style={{ background:'#fff', color:'#c0392b', border:'1px solid #c0392b', borderRadius:6, padding:'6px 10px', fontSize:12, whiteSpace:'nowrap' }}
                  title="Remove current image"
                >Remove</button>
              </div>
              <div style={{ marginTop: 6, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/jpg"
                  onChange={async (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (!file) return;
                    try {
                      const prepared = await preprocessVendorImage(file);
                      setPendingUploads(prev => ({ ...prev, [it.id]: prepared }));
                      toast.info(`Ready to upload (${Math.round(prepared.size/1024)} KB)`);
                    } catch (err) {
                      toast.error(String(err?.message || 'Unable to process image'));
                    } finally {
                      e.target.value = '';
                    }
                  }}
                />
                <span style={{ fontSize: 11, color: '#666' }}>Max 5MB. JPEG/PNG only.</span>
              </div>
              {pendingUploads[it.id] && (
                <div className="card" style={{ marginTop: 8, padding: 8, display:'flex', alignItems:'center', gap:10 }}>
                  <img src={pendingUploads[it.id].dataUrl} alt="preview" style={{ width: 80, height: 60, objectFit:'cover', borderRadius: 6, border:'1px solid #eee' }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, color:'#333' }}>Prepared: {(pendingUploads[it.id].mime || '').replace('image/','').toUpperCase()} · {Math.round(pendingUploads[it.id].size/1024)} KB</div>
                    <div style={{ fontSize:11, color:'#666' }}>Click Upload to attach this image to the item.</div>
                  </div>
                  <button
                    type="button"
                    onClick={async ()=>{
                      const prepared = pendingUploads[it.id];
                      if (!prepared) return;
                      try {
                        const res = await uploadVendorImagePrepared({ name: prepared.name, mime: prepared.mime, base64: prepared.base64 }, `Bearer ${token}`);
                        if (res && res.status === 'ok' && res.path) {
                          handleChange(idx, 'image', res.path);
                          setPendingUploads(prev => { const n = { ...prev }; delete n[it.id]; return n; });
                          toast.success('Image uploaded');
                        } else {
                          toast.error(res?.message || 'Upload failed');
                        }
                      } catch (err) {
                        toast.error(String(err?.message || 'Upload error'));
                      }
                    }}
                  >Upload</button>
                  <button
                    type="button"
                    onClick={()=> setPendingUploads(prev => { const n = { ...prev }; delete n[it.id]; return n; })}
                    style={{ background:'#fff', color:'#111', border:'1px solid #111' }}
                  >Discard</button>
                </div>
              )}
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
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    const next = [...items];
                    const opts = [...(next[idx].options || [])];
                    const hasVeg = opts.some(o=>String(o.name).toLowerCase()==='veg');
                    const hasNonVeg = opts.some(o=>String(o.name).toLowerCase()==='non-veg' || String(o.name).toLowerCase()==='non veg');
                    if (!hasVeg) opts.push({ name: 'Veg', priceModifier: 0 });
                    if (!hasNonVeg) opts.push({ name: 'Non-Veg', priceModifier: 20 });
                    next[idx] = { ...next[idx], options: opts };
                    setItems(next);
                    toast.success('Added Veg/Non-Veg variants');
                  }}
                >Quick add Veg/Non-Veg</button>
              </div>
            )}
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
            <label>
              <input
                type="checkbox"
                checked={!!it.hidden}
                onChange={(e)=>handleChange(idx, 'hidden', e.target.checked)}
              /> Hidden
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