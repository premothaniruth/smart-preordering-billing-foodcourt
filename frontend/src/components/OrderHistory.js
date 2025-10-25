import React, { useMemo, useState } from "react";
import { submitRating } from "../api";

/**
 * OrderHistory
 * Categorizes orders for the employee view and supports rating and reorders.
 * Sections: Ready to Pick, Recent Orders, Completed Orders (with toggle for older).
 * Shows delivery time and an early-delivery encouragement note.
 * @param {{
 *  orders: any[],
 *  onReorder: (order:any)=>void,
 *  onBack: ()=>void,
 *  onClearHistory: ()=>void,
 *  onReportIssue: (order:any)=>void,
 * }} props
 */

const OrderHistory = ({ orders, onReorder, onBack, onClearHistory, onReportIssue }) => {
  const byCreatedDesc = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
  const readyOrders = useMemo(() => orders.filter(o => o.status === 'ready').sort(byCreatedDesc), [orders]);
  const completedOrders = useMemo(() => orders.filter(o => o.status === 'completed').sort(byCreatedDesc), [orders]);
  const recentOrders = useMemo(() => orders.filter(o => o.status !== 'ready' && o.status !== 'completed').sort(byCreatedDesc), [orders]);
  const [ratingState, setRatingState] = useState({});
  const [showOlderCompleted, setShowOlderCompleted] = useState(false);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <button onClick={onBack}>← Back to Menu</button>
        {orders.length > 0 && (
          <button 
            onClick={onClearHistory}
            style={{ background: "#e74c3c" }}
          >
            Clear History
          </button>
        )}
      </div>
      
      <h2>Order History</h2>
      
      {orders.length === 0 && (
        <p className="empty-state">You haven't placed any orders yet.</p>
      )}

      {readyOrders.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>Ready to Pick</h3>
          <div style={{ display: "grid", gap: 20 }}>
            {readyOrders.map((order) => (
              <div key={order.id} className="card">
                {renderOrderCard(order)}
              </div>
            ))}
          </div>
        </>
      )}

      {recentOrders.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>Recent Orders</h3>
          <div style={{ display: "grid", gap: 20 }}>
            {recentOrders.map((order) => (
              <div key={order.id} className="card">
                {renderOrderCard(order)}
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginTop: 20 }}>Completed Orders</h3>
      {completedOrders.length === 0 && (
        <p className="empty-state">No completed orders yet.</p>
      )}
      {completedOrders.length > 0 && (
        <>
          <div style={{ display: "grid", gap: 20 }}>
            {completedOrders.slice(0, 5).map((order) => (
              <div key={order.id} className="card">
                {renderOrderCard(order)}
              </div>
            ))}
          </div>
          {completedOrders.length > 5 && (
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setShowOlderCompleted(s => !s)} style={{ background: "#ecf0f1", color: "#2c3e50" }}>
                {showOlderCompleted ? "▾ Hide older" : "▸ Show older"}
              </button>
            </div>
          )}
          {showOlderCompleted && (
            <div style={{ display: "grid", gap: 20, marginTop: 10 }}>
              {completedOrders.slice(5).map((order) => (
                <div key={order.id} className="card">
                  {renderOrderCard(order)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  function isEarly(order) {
    if (!order.readyAt || !order.estimatedReadyTime) return false;
    try {
      return new Date(order.readyAt) < new Date(order.estimatedReadyTime);
    } catch { return false; }
  }

  function renderOrderCard(order) {
    const early = isEarly(order);
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 15 }}>
          <div>
            <h3 style={{ margin: 0, color: "#2c3e50" }}>Order #{order.billingId}</h3>
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              {new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
            {order.readyAt && (
              <div style={{ fontSize: 12, color: early ? '#27ae60' : '#666', marginTop: 2 }}>
                Delivered at: {new Date(order.readyAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            )}
          </div>
          <span className={`badge badge-${order.status === 'ready' ? 'success' : (order.status === 'completed' ? 'default' : 'warning')}`}>
            {order.status.toUpperCase()}
          </span>
        </div>

        <h4 style={{ fontSize: 14, marginTop: 15, marginBottom: 10 }}>Items:</h4>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {order.items.map((item, idx) => (
            <li key={idx} style={{ fontSize: 13, marginBottom: 8, paddingLeft: 0 }}>
              • {item.name} {item.option && `(${item.option})`} x{item.quantity} - ₹{item.price * item.quantity}
              {item.customization && item.customization.notes && (
                <div style={{ fontSize: 11, color: "#666", marginLeft: 12, marginTop: 2, fontStyle: "italic" }}>
                  📝 {item.customization.notes}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div style={{ marginTop: 15, paddingTop: 15, borderTop: "1px solid #ecf0f1", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <strong>Total: ₹{order.items.reduce((sum, it) => sum + it.price * it.quantity, 0)}</strong>
            {order.estimatedReadyTime && (
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                ETA: {new Date(order.estimatedReadyTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            )}
            {order.etaExtensionMinutes > 0 && (
              <div style={{ fontSize: 11, color: "#c0392b", marginTop: 2 }}>
                Vendor extended by {order.etaExtensionMinutes} min{order.etaExtensionMinutes>1?'s':''} {order.etaExtendedAt ? `on ${new Date(order.etaExtendedAt).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })}` : ''}
              </div>
            )}
            {early && (
              <div style={{ fontSize: 12, color: '#27ae60', marginTop: 6 }}>
                We prepared your order earlier than expected. Hope you enjoy our quick service! Please encourage us with a positive rating and feedback to serve you better.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => onReorder(order)} style={{ background: "#3498db", padding: "8px 16px" }}>🔄 Reorder</button>
            <button onClick={() => onReportIssue(order)} style={{ background: "#e67e22", padding: "8px 16px" }}>⚠️ Report Issue</button>
          </div>
        </div>

        {order.rating && (
          <div style={{ marginTop: 15, paddingTop: 15, borderTop: "1px solid #ecf0f1" }}>
            <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 4 }}>Your Rating:</div>
            <div style={{ color: "#f39c12", fontSize: 16 }}>{"⭐".repeat(order.rating)}</div>
            {order.feedback && (
              <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontStyle: "italic" }}>
                "{order.feedback}"
              </div>
            )}
          </div>
        )}

        {!order.rating && (
          <div style={{ marginTop: 15, paddingTop: 15, borderTop: "1px solid #ecf0f1" }}>
            <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 8 }}>Rate this order:</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              {[1,2,3,4,5].map(n => (
                <span
                  key={n}
                  onMouseEnter={() => setRatingState(prev => ({ ...prev, [order.id]: { ...(prev[order.id]||{}), hover: n } }))}
                  onMouseLeave={() => setRatingState(prev => ({ ...prev, [order.id]: { ...(prev[order.id]||{}), hover: 0 } }))}
                  onClick={() => setRatingState(prev => ({ ...prev, [order.id]: { ...(prev[order.id]||{}), selected: n } }))}
                  style={{ color: n <= ((ratingState[order.id]?.hover) || (ratingState[order.id]?.selected) || 0) ? '#f1c40f' : '#ccc', fontSize: 20, cursor: 'pointer' }}
                >★</span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Optional feedback"
                value={ratingState[order.id]?.text || ''}
                onChange={(e) => setRatingState(prev => ({ ...prev, [order.id]: { ...(prev[order.id]||{}), text: e.target.value } }))}
                style={{ flex: '1 1 240px' }}
              />
              <button
                onClick={async () => {
                  const sel = ratingState[order.id]?.selected || 0;
                  if (!sel) return;
                  await submitRating(order.id, sel, ratingState[order.id]?.text || '');
                  order.rating = sel;
                  order.feedback = ratingState[order.id]?.text || '';
                  setRatingState(prev => ({ ...prev, [order.id]: { hover: 0, selected: sel, text: prev[order.id]?.text || '' } }));
                }}
                disabled={!ratingState[order.id]?.selected}
              >Submit Rating</button>
            </div>
          </div>
        )}
      </>
    );
  }
};

export default OrderHistory;