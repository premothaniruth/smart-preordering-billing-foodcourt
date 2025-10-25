import React, { useEffect, useMemo, useState } from "react";
import { fetchVendorFeedbacks, fetchPublicFeedbacks } from "../api";

const VendorFeedbacks = ({ token }) => {
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('shop'); // 'shop' or 'global'
  const [ratingMin, setRatingMin] = useState(0);
  const [days, setDays] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setLoading(true);
    const load = async () => {
      if (view === 'shop') {
        const data = await fetchVendorFeedbacks(token);
        setFeedbacks(Array.isArray(data) ? data : []);
      } else {
        const data = await fetchPublicFeedbacks({ ratingMin: ratingMin || undefined, days: days || undefined });
        setFeedbacks(Array.isArray(data) ? data : []);
      }
    };
    load().finally(() => setLoading(false));
  }, [token, view, ratingMin, days]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return feedbacks.slice(start, start + pageSize);
  }, [feedbacks, page]);
  const totalPages = Math.max(1, Math.ceil(feedbacks.length / pageSize));

  return (
    <div>
      <h2>Customer Feedbacks</h2>
      <div className="filter-section" style={{ gap: 10, alignItems: 'center' }}>
        <label>View:&nbsp;</label>
        <select value={view} onChange={(e)=>{ setView(e.target.value); setPage(1); }}>
          <option value="shop">My Shop</option>
          <option value="global">Global</option>
        </select>
        {view === 'global' && (
          <>
            <label style={{ marginLeft: 10 }}>Min Rating:&nbsp;</label>
            <select value={ratingMin} onChange={(e)=>{ setRatingMin(Number(e.target.value)); setPage(1); }}>
              <option value={0}>All</option>
              <option value={3}>3+</option>
              <option value={4}>4+</option>
              <option value={5}>5</option>
            </select>
            <label style={{ marginLeft: 10 }}>Last (days):&nbsp;</label>
            <input type="number" min="0" placeholder="e.g., 30" value={days || ''} onChange={(e)=>{ setDays(Number(e.target.value) || 0); setPage(1); }} style={{ width: 90 }} />
          </>
        )}
      </div>
      {loading && <p className="empty-state">Loading feedbacks...</p>}
      {!loading && feedbacks.length === 0 && (
        <p className="empty-state">No feedbacks yet.</p>
      )}
      <div style={{ display: "grid", gap: 12 }}>
        {paged.map((f, idx) => (
          <div key={idx} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <div style={{ fontSize: 13, color: '#666' }}>Billing ID: <strong>{f.billingId}</strong></div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{new Date(f.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              </div>
              <div style={{ color: '#f1c40f', fontSize: 18 }}>{'★'.repeat(f.rating)}{'☆'.repeat(Math.max(0, 5 - f.rating))}</div>
            </div>
            {f.feedback && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                “{f.feedback}”
              </div>
            )}
            {f.user && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#888' }}>By: {f.user}</div>
            )}
          </div>
        ))}
      </div>
      {feedbacks.length > 0 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 12 }}>
          <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1, p-1))}>Prev</button>
          <span style={{ fontSize: 12 }}>Page {page} / {totalPages}</span>
          <button disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages, p+1))}>Next</button>
        </div>
      )}
    </div>
  );
};

export default VendorFeedbacks;
