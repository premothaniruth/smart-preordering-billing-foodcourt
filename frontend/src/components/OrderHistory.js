import React from "react";

const OrderHistory = ({ orders, onReorder, onBack, onClearHistory, onReportIssue }) => {
  // Sort orders in reverse chronological order (latest first)
  const sortedOrders = [...orders].sort((a, b) => 
    new Date(b.createdAt) - new Date(a.createdAt)
  );

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

      <div style={{ display: "grid", gap: 20 }}>
        {sortedOrders.map((order) => (
          <div key={order.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 15 }}>
              <div>
                <h3 style={{ margin: 0, color: "#2c3e50" }}>Order #{order.billingId}</h3>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  {new Date(order.createdAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  })}
                </div>
              </div>
              <span className={`badge badge-${order.status === 'ready' ? 'success' : 'warning'}`}>
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
                <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                  Prep Time: {order.prepTime} mins
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button 
                  onClick={() => onReorder(order)}
                  style={{ background: "#3498db", padding: "8px 16px" }}
                >
                  🔄 Reorder
                </button>
                <button 
                  onClick={() => onReportIssue(order)}
                  style={{ background: "#e67e22", padding: "8px 16px" }}
                >
                  ⚠️ Report Issue
                </button>
              </div>
            </div>

            {order.rating && (
              <div style={{ marginTop: 15, paddingTop: 15, borderTop: "1px solid #ecf0f1" }}>
                <div style={{ fontSize: 12, fontWeight: "bold", marginBottom: 4 }}>Your Rating:</div>
                <div style={{ color: "#f39c12", fontSize: 16 }}>
                  {"⭐".repeat(order.rating)}
                </div>
                {order.feedback && (
                  <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontStyle: "italic" }}>
                    "{order.feedback}"
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrderHistory;