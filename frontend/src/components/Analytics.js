import React, { useEffect, useState } from "react";
import { fetchAnalytics } from "../api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

const Analytics = ({ token }) => {
  const [data, setData] = useState({ totalOrders: 0, popularItems: [] });

  useEffect(() => {
    fetchAnalytics(token).then(setData);
  }, [token]);

  return (
    <div>
      <h2>Analytics Dashboard</h2>
      <p>Total Orders: {data.totalOrders}</p>
      <h3>Popular Items</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data.popularItems}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="count" fill="#8884d8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default Analytics;