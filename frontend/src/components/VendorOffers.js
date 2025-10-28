import React, { useEffect, useMemo, useState } from "react";
import { fetchOffers, fetchSectionsMeta, fetchCombos, updateOffers } from "../api";
import { toast } from "react-toastify";

/**
 * VendorOffers
 * CRUD panel for managing special offers for the vendor's shop.
 * @param {{ token: string }} props
 */
const VendorOffers = ({ token }) => {
  const vendorShopId = useMemo(() => {
    try { return JSON.parse(atob(token.split(".")[1])).shopId || 1; } catch { return 1; }
  }, [token]);

  const [offers, setOffers] = useState([]);
  const [sections, setSections] = useState([]);
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [off, sec, cmb] = await Promise.all([
        fetchOffers(vendorShopId),
        fetchSectionsMeta(),
        fetchCombos(vendorShopId, false)
      ]);
      setOffers(Array.isArray(off) ? off : []);
      setSections(Array.isArray(sec?.names) ? sec.names : []);
      setCombos(Array.isArray(cmb) ? cmb : []);
    } catch {
      setOffers([]); setSections([]); setCombos([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [vendorShopId]);

  const addOffer = () => {
    setOffers(prev => ([{
      id: Date.now(),
      shopId: vendorShopId,
      title: "New Offer",
      bannerText: "New Offer",
      discountPercent: 0,
      discountAmount: null,
      applicableSections: [],
      applicableComboIds: [],
      start: "",
      end: "",
      active: true,
      stackable: true,
      maxDiscountAmount: null
    }, ...prev]));
  };

  const updateField = (idx, field, value) => {
    setOffers(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const toggleArrayValue = (idx, field, value) => {
    setOffers(prev => {
      const next = [...prev];
      const arr = Array.isArray(next[idx][field]) ? [...next[idx][field]] : [];
      const i = arr.findIndex(v => String(v) === String(value));
      if (i >= 0) arr.splice(i, 1); else arr.push(value);
      next[idx] = { ...next[idx], [field]: arr };
      return next;
    });
  };

  const removeOffer = (idx) => {
    setOffers(prev => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    try {
      const cleaned = offers.map(o => ({
        ...o,
        discountPercent: (o.discountPercent == null || o.discountPercent === "") ? null : Number(o.discountPercent),
        discountAmount: (o.discountAmount == null || o.discountAmount === "") ? null : Number(o.discountAmount),
        maxDiscountAmount: (o.maxDiscountAmount == null || o.maxDiscountAmount === "") ? null : Number(o.maxDiscountAmount),
        applicableSections: Array.isArray(o.applicableSections) ? o.applicableSections : [],
        applicableComboIds: Array.isArray(o.applicableComboIds) ? o.applicableComboIds : [],
      }));
      const res = await updateOffers(cleaned, token);
      if (res && res.status === "success") {
        toast.success("Offers saved");
        await load();
      } else {
        toast.error(res?.message || "Failed to save offers");
      }
    } catch {
      toast.error("Error saving offers");
    }
  };

  return (
    <div>
      <h2>Manage Offers</h2>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <button onClick={addOffer}>+ Add Offer</button>
        <button onClick={save} style={{ background: '#27ae60' }}>Save Changes</button>
      </div>
      {loading && <div>Loading...</div>}
      {offers.map((o, idx) => (
        <div key={o.id} className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">{o.title || 'Offer'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Title</div>
              <input value={o.title || ''} onChange={(e)=>updateField(idx,'title',e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Banner Text</div>
              <input value={o.bannerText || ''} onChange={(e)=>updateField(idx,'bannerText',e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Discount %</div>
              <input type="number" value={o.discountPercent ?? ''} onChange={(e)=>updateField(idx,'discountPercent', e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Flat Discount</div>
              <input type="number" value={o.discountAmount ?? ''} onChange={(e)=>updateField(idx,'discountAmount', e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Start (ISO)</div>
              <input placeholder="YYYY-MM-DDTHH:MM:SSZ" value={o.start || ''} onChange={(e)=>updateField(idx,'start',e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>End (ISO)</div>
              <input placeholder="YYYY-MM-DDTHH:MM:SSZ" value={o.end || ''} onChange={(e)=>updateField(idx,'end',e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label>
                <input type="checkbox" checked={o.active !== false} onChange={(e)=>updateField(idx,'active', e.target.checked)} /> Active
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label>
                <input type="checkbox" checked={o.stackable !== false} onChange={(e)=>updateField(idx,'stackable', e.target.checked)} /> Stackable
              </label>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>Max Discount Cap</div>
              <input type="number" value={o.maxDiscountAmount ?? ''} onChange={(e)=>updateField(idx,'maxDiscountAmount', e.target.value)} />
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Applicable Sections</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {sections.map((s) => (
                  <label key={s} className="menu-item-badge" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" style={{ display: 'none' }} checked={Array.isArray(o.applicableSections) && o.applicableSections.includes(s)} onChange={()=>toggleArrayValue(idx,'applicableSections', s)} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Applicable Combo IDs</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {combos.map((c) => (
                  <label key={c.id} className="menu-item-badge" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" style={{ display: 'none' }} checked={Array.isArray(o.applicableComboIds) && o.applicableComboIds.map(String).includes(String(c.id))} onChange={()=>toggleArrayValue(idx,'applicableComboIds', c.id)} />
                    {c.name} ({c.id})
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button onClick={()=>removeOffer(idx)} style={{ background: '#e74c3c' }}>Remove Offer</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default VendorOffers;
