import React, { useEffect, useMemo, useState } from "react";
import { fetchCombos, updateCombos, fetchMenu } from "../api";
import { toast } from "react-toastify";

/**
 * VendorCombos
 * CRUD panel for managing combos for the vendor's shop.
 * @param {{ token: string }} props
 */
const VendorCombos = ({ token }) => {
  const vendorShopId = useMemo(() => {
    try { return JSON.parse(atob(token.split(".")[1])).shopId || 1; } catch { return 1; }
  }, [token]);

  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState([]);
  const [idNameMap, setIdNameMap] = useState(new Map());
  const shopItems = useMemo(() => {
    const shop = (menu || []).find(s => String(s.shopId) === String(vendorShopId));
    return shop && Array.isArray(shop.items) ? shop.items : [];
  }, [menu, vendorShopId]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchCombos(vendorShopId, false);
      setCombos(Array.isArray(data) ? data : []);
    } catch { setCombos([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [vendorShopId]);

  useEffect(() => {
    // Build id->name map for current shop
    fetchMenu().then((m) => {
      setMenu(m || []);
      const shop = (m || []).find(s => String(s.shopId) === String(vendorShopId));
      const map = new Map();
      if (shop && Array.isArray(shop.items)) {
        for (const it of shop.items) map.set(Number(it.id), it.name);
      }
      setIdNameMap(map);
    }).catch(()=>{});
  }, [vendorShopId]);

  const addCombo = () => {
    setCombos(prev => ([{
      id: Date.now(),
      shopId: vendorShopId,
      name: "New Combo",
      price: 0,
      active: true,
      components: []
    }, ...prev]));
  };

  const updateField = (idx, field, value) => {
    setCombos(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addComponent = (idx) => {
    setCombos(prev => {
      const next = [...prev];
      const c = next[idx];
      const comps = Array.isArray(c.components) ? [...c.components] : [];
      comps.push({ itemId: 0, quantity: 1, name: "", option: "", overridePrice: null });
      next[idx] = { ...c, components: comps };
      return next;
    });
  };

  const updateComponent = (idx, cidx, field, value) => {
    setCombos(prev => {
      const next = [...prev];
      const combo = next[idx];
      const comps = [...(combo.components || [])];
      comps[cidx] = { ...comps[cidx], [field]: value };
      next[idx] = { ...combo, components: comps };
      return next;
    });
  };

  const removeComponent = (idx, cidx) => {
    setCombos(prev => {
      const next = [...prev];
      const combo = next[idx];
      const comps = [...(combo.components || [])];
      comps.splice(cidx, 1);
      next[idx] = { ...combo, components: comps };
      return next;
    });
  };

  const removeCombo = (idx) => {
    setCombos(prev => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    try {
      const payload = combos.map(c => ({
        ...c,
        price: Number(c.price) || 0,
        components: (c.components || []).map(x => ({
          ...x,
          itemId: Number(x.itemId) || 0,
          quantity: Number(x.quantity) || 1,
          overridePrice: (x.overridePrice == null || x.overridePrice === "") ? null : Number(x.overridePrice)
        }))
      }));
      const res = await updateCombos(payload, token);
      if (res && res.status === "success") {
        toast.success("Combos saved");
        await load();
      } else {
        toast.error(res?.message || "Failed to save combos");
      }
    } catch {
      toast.error("Error saving combos");
    }
  };

  return (
    <div>
      <h2>Manage Combos</h2>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <button onClick={addCombo}>+ Add Combo</button>
        <button onClick={save} style={{ background: '#27ae60' }}>Save Changes</button>
      </div>
      {loading && <div>Loading...</div>}
      {combos.map((c, idx) => (
        <div key={c.id} className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">{c.name || 'Combo'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Name</div>
              <input value={c.name || ''} onChange={(e)=>updateField(idx,'name',e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Price</div>
              <input type="number" value={c.price || 0} onChange={(e)=>updateField(idx,'price', Number(e.target.value)||0)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label>
                <input type="checkbox" checked={c.active !== false} onChange={(e)=>updateField(idx,'active', e.target.checked)} /> Active
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={()=>removeCombo(idx)} style={{ background: '#e74c3c' }}>Remove</button>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Components</div>
            {(c.components || []).map((comp, cidx) => (
              <div key={cidx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                <div style={{ position: 'relative' }}>
                  <input
                    list={`combo-item-list-${idx}-${cidx}`}
                    placeholder="Search or enter item name"
                    value={idNameMap.get(Number(comp.itemId)) || ''}
                    onChange={(e) => {
                      // find item by name (first exact, then startsWith, then includes)
                      const q = e.target.value.trim().toLowerCase();
                      if (!q) { updateComponent(idx,cidx,'itemId', 0); return; }
                      const exact = shopItems.find(it => String(it.name).toLowerCase() === q);
                      const starts = exact || shopItems.find(it => String(it.name).toLowerCase().startsWith(q));
                      const any = starts || shopItems.find(it => String(it.name).toLowerCase().includes(q));
                      if (any) updateComponent(idx,cidx,'itemId', Number(any.id) || 0);
                    }}
                  />
                  <datalist id={`combo-item-list-${idx}-${cidx}`}>
                    {shopItems.map(it => (
                      <option key={it.id} value={it.name}>{it.id}</option>
                    ))}
                  </datalist>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    ID: {comp.itemId || '—'}
                  </div>
                </div>
                <input type="number" placeholder="Qty" value={comp.quantity || 1} onChange={(e)=>updateComponent(idx,cidx,'quantity', Number(e.target.value)||1)} />
                <input placeholder="Name (optional)" value={comp.name || ''} onChange={(e)=>updateComponent(idx,cidx,'name', e.target.value)} />
                <input placeholder="Option (optional)" value={comp.option || ''} onChange={(e)=>updateComponent(idx,cidx,'option', e.target.value)} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" placeholder="Override Price (optional)" value={comp.overridePrice ?? ''} onChange={(e)=>updateComponent(idx,cidx,'overridePrice', e.target.value)} />
                  <button onClick={()=>removeComponent(idx,cidx)} style={{ background: '#e74c3c' }}>Remove</button>
                </div>
              </div>
            ))}
            <button onClick={()=>addComponent(idx)}>+ Add Component</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default VendorCombos;
