import React, { useEffect, useState } from "react";
import { fetchAnalytics } from "../api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

const Analytics = ({ token }) => {
  const [data, setData] = useState({ totalOrders: 0, totalItems: 0, popularItems: [], breakdown: { daily: 0, monthly: 0, quarterly: 0, yearly: 0 }, avgRating: 0, totalRatings: 0 });
  const [period, setPeriod] = useState("daily");

  useEffect(() => {
    fetchAnalytics(token, period).then(setData);
  }, [token, period]);

  return (
    <div>
      <h2>Analytics Dashboard</h2>
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
      <div className="card">
        <div className="flex-between">
          <div>
            <div className="card-header">Summary</div>
            <div>Total Orders: <strong>{data.totalOrders}</strong></div>
            <div>Total Items Ordered: <strong>{data.totalItems}</strong></div>
            <div>Average Rating: <strong>{data.avgRating}</strong> ({data.totalRatings})</div>
          </div>
          <div>
            <div className="card-header">Breakdown</div>
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
          <BarChart data={data.popularItems}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Analytics;