import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { fetchAnalytics } from "../api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

/**
 * Analytics
 * Vendor analytics dashboard: KPIs, breakdown, and top items chart.
 * @param {{ token:string }} props
 */
const Analytics = ({ token }) => {
  const [data, setData] = useState({ totalOrders: 0, totalItems: 0, popularItems: [], breakdown: { daily: 0, monthly: 0, quarterly: 0, yearly: 0 }, avgRating: 0, totalRatings: 0, prev: null });
  const [period, setPeriod] = useState("daily");
  const vendorShopId = useMemo(() => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.shopId || 0;
    } catch { return 0; }
  }, [token]);

  const baseColor = useMemo(() => {
    const palette = [
      '#2c3e50', // dark blue
      '#27ae60', // green
      '#e67e22', // orange
      '#8e44ad', // purple
      '#2980b9', // blue
      '#c0392b'  // red
    ];
    const idx = Math.abs(Number(vendorShopId)) % palette.length;
    return palette[idx];
  }, [vendorShopId]);

  const tileStyle = (accent) => ({ background: `${accent}14`, border: `1px solid ${accent}33`, borderRadius: 10, padding: '10px 12px' });
  const headerStyle = { fontSize: 12, color: '#666' };
  const valueStyle = { fontSize: 22, fontWeight: 700 };

  const renderTrend = (current, prev) => {
    if (prev == null || prev === 0 || current == null) return null;
    const diff = current - prev;
    const pct = Math.round((diff / Math.max(prev, 1)) * 100);
    const up = diff > 0;
    const color = up ? '#27ae60' : (diff < 0 ? '#c0392b' : '#999');
    const arrow = up ? '▲' : (diff < 0 ? '▼' : '■');
    return <span style={{ marginLeft: 6, fontSize: 12, color }}>{arrow} {Math.abs(pct)}%</span>;
  };

  // fetch analytics when token/period changes
  useEffect(() => {
    fetchAnalytics(token, period).then(setData);
  }, [token, period]);

  return (
    <div>
      <h2 style={{ marginBottom: 10 }}>Analytics Dashboard</h2>
      <div className="filter-section" style={{ marginBottom: 10 }}>
        <label>Period:&nbsp;</label>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="">All</option>
          <option value="daily">Daily</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>

      {/* KPI tiles */}
      <div style={{ display:'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div style={tileStyle(baseColor)}>
          <div style={headerStyle}>Total Orders</div>
          <div style={valueStyle}>{data.totalOrders}{renderTrend(data.totalOrders, data.prev?.totalOrders)}</div>
        </div>
        <div style={tileStyle(baseColor)}>
          <div style={headerStyle}>Total Items</div>
          <div style={valueStyle}>{data.totalItems}{renderTrend(data.totalItems, data.prev?.totalItems)}</div>
        </div>
        <div style={tileStyle(baseColor)}>
          <div style={headerStyle}>Avg Rating</div>
          <div style={valueStyle}>{data.avgRating}{renderTrend(data.avgRating, data.prev?.avgRating)}</div>
        </div>
        <div style={tileStyle(baseColor)}>
          <div style={headerStyle}>Total Ratings</div>
          <div style={valueStyle}>{data.totalRatings}{renderTrend(data.totalRatings, data.prev?.totalRatings)}</div>
        </div>
      </div>
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, alignItems:'start' }}>
          <div>
            <div className="card-header" style={{ fontSize:14, marginBottom:6 }}>Summary</div>
            <div>Total Orders: <strong>{data.totalOrders}</strong></div>
            <div>Total Items Ordered: <strong>{data.totalItems}</strong></div>
            <div>Average Rating: <strong>{data.avgRating}</strong> ({data.totalRatings})</div>
          </div>
          <div>
            <div className="card-header" style={{ fontSize:14, marginBottom:6 }}>Breakdown</div>
            <div>Daily: <strong>{data.breakdown?.daily || 0}</strong></div>
            <div>Monthly: <strong>{data.breakdown?.monthly || 0}</strong></div>
            <div>Quarterly: <strong>{data.breakdown?.quarterly || 0}</strong></div>
            <div>Yearly: <strong>{data.breakdown?.yearly || 0}</strong></div>
          </div>
        </div>
      </div>

      <h3>Top Items</h3>
      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.popularItems} margin={{ top: 10, right: 12, left: 12, bottom: 20 }} barCategoryGap={8}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" interval={0} tickMargin={8} padding={{ left: 8, right: 8 }} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

Analytics.propTypes = {
  token: PropTypes.string.isRequired,
};

export default Analytics;