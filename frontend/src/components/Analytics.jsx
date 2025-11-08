import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { fetchAnalytics, downloadAnalyticsExport } from "../api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

/**
 * Analytics
 * Vendor analytics dashboard: KPIs, breakdown, and top items chart.
 * @param {{ token:string }} props
 */
const DEFAULT_SUMMARY = {
  generatedAt: "",
  totals: {
    orders: 0,
    revenue: 0,
    averageOrderValue: 0,
    inventoryNetDelta: 0,
  },
  statusBreakdown: {},
  averagePrepExtensionMinutes: 0,
  timeSeries: [],
  inventory: {
    recentAdjustments: [],
    totalDepletion: 0,
  },
  history: [],
};

const Analytics = ({ token, defaultFoodCourt = "fc-1", foodCourtOptions = [] }) => {
  const [data, setData] = useState(DEFAULT_SUMMARY);
  const [period, setPeriod] = useState("weekly");
  const [granularity, setGranularity] = useState("hour");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState("json");
  const [historyChartType, setHistoryChartType] = useState("bar");
  const { vendorShopId, vendorFoodCourt } = useMemo(() => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ""));
      return {
        vendorShopId: payload?.shopId || 0,
        vendorFoodCourt: payload?.foodCourt || defaultFoodCourt
      };
    } catch {
      return { vendorShopId: 0, vendorFoodCourt: defaultFoodCourt };
    }
  }, [token, defaultFoodCourt]);

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

  const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const formatNumber = (value) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

  // fetch analytics when filters change
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchAnalytics(token, period, granularity, vendorFoodCourt)
      .then((summary) => {
        if (active) {
          setData(summary || DEFAULT_SUMMARY);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.message || 'Failed to load analytics');
          setData(DEFAULT_SUMMARY);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, vendorFoodCourt, period, granularity]);

  const ordersSeries = useMemo(() => data.timeSeries.map((row) => ({ ...row, orders: row.orders || 0 })), [data.timeSeries]);
  const revenueSeries = useMemo(() => data.timeSeries.map((row) => ({ ...row, revenue: row.revenue || 0 })), [data.timeSeries]);
  const historyDataset = useMemo(
    () =>
      (data.history || []).map((row) => ({
        ...row,
        label: new Date(row.period).toLocaleString("en-IN", { month: "short", year: "numeric" }),
        orders: Number(row.orders || 0),
        revenue: Number(row.revenue || 0),
      })),
    [data.history]
  );
  const piePalette = ["#4f46e5", "#8b5cf6", "#0ea5e9", "#14b8a6", "#f97316", "#f43f5e", "#facc15", "#22c55e"];

  const renderHistoryChart = () => {
    if (!historyDataset.length) {
      return (
        <div className="history-chart-empty">No history yet. Upload or generate data to view trends.</div>
      );
    }

    if (historyChartType === "line") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={historyDataset} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="orders" orientation="left" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="revenue" orientation="right" tickFormatter={(value) => `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value, name) => (name === "Revenue" ? formatCurrency(value) : formatNumber(value))} />
            <Legend />
            <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke="#2563eb" strokeWidth={2} activeDot={{ r: 6 }} />
            <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue" stroke="#7c3aed" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (historyChartType === "pie") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip formatter={(value) => formatCurrency(value)} />
            <Legend />
            <Pie
              data={historyDataset}
              dataKey="revenue"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius="75%"
              label={(entry) => `${entry.label}`}
            >
              {historyDataset.map((entry, index) => (
                <Cell key={entry.period} fill={piePalette[index % piePalette.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={historyDataset} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value, name) => (name === "Revenue" ? formatCurrency(value) : formatNumber(value))} />
          <Legend />
          <Bar dataKey="orders" name="Orders" fill="#2563eb" radius={[6, 6, 0, 0]} />
          <Bar dataKey="revenue" name="Revenue" fill="#7c3aed" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAnalytics(token, period, granularity, vendorFoodCourt);
      setData(res || DEFAULT_SUMMARY);
    } catch (err) {
      setError(err?.message || 'Failed to load analytics');
      setData(DEFAULT_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [token, vendorFoodCourt, period, granularity]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await downloadAnalyticsExport(token, exportFormat);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const extension = exportFormat === "csv" ? "csv" : "json";
      link.href = url;
      link.download = `analytics-export-${new Date().toISOString().slice(0, 10)}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || "Failed to export analytics");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 10 }}>Analytics Dashboard</h2>
      <div className="filter-section" style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <label>Period:&nbsp;</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <label>Granularity:&nbsp;</label>
          <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
            <option value="hour">Hourly</option>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
          </select>
        </div>
        <div>
          <label>Export Format:&nbsp;</label>
          <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #2980b9', background: exporting ? '#95a5a6' : '#2980b9', color: '#fff', cursor: exporting ? 'not-allowed' : 'pointer' }}
        >
          {exporting ? 'Exporting…' : 'Export Snapshot'}
        </button>
        {data.generatedAt && (
          <span style={{ fontSize: 12, color: '#777' }}>Updated: {new Date(data.generatedAt).toLocaleString()}</span>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 12, background: '#fdecea', border: '1px solid #f5c6cb', color: '#a94442' }}>{error}</div>
      )}

      {loading && (
        <div style={{ marginBottom: 12, fontSize: 13, color: '#555' }}>Loading analytics…</div>
      )}

      {/* KPI tiles */}
      <div style={{ display:'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div style={tileStyle(baseColor)}>
          <div style={headerStyle}>Total Orders</div>
          <div style={valueStyle}>{formatNumber(data.totals?.orders)}</div>
        </div>
        <div style={tileStyle(baseColor)}>
          <div style={headerStyle}>Total Revenue</div>
          <div style={valueStyle}>{formatCurrency(data.totals?.revenue)}</div>
        </div>
        <div style={tileStyle(baseColor)}>
          <div style={headerStyle}>Avg Order Value</div>
          <div style={valueStyle}>{formatCurrency(data.totals?.averageOrderValue)}</div>
        </div>
        <div style={tileStyle(baseColor)}>
          <div style={headerStyle}>Inventory Net Delta</div>
          <div style={valueStyle}>{formatNumber(data.totals?.inventoryNetDelta)}</div>
        </div>
      </div>
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, alignItems:'start' }}>
          <div>
            <div className="card-header" style={{ fontSize:14, marginBottom:6 }}>Prep & Status</div>
            <div>Average Prep Extension: <strong>{Number(data.averagePrepExtensionMinutes || 0).toFixed(1)} mins</strong></div>
            <div style={{ marginTop: 8 }}>Status Breakdown:</div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {Object.entries(data.statusBreakdown || {}).length === 0 && <li style={{ color: '#777' }}>No status changes</li>}
              {Object.entries(data.statusBreakdown || {}).map(([status, count]) => (
                <li key={status}><strong>{status.toUpperCase()}</strong>: {formatNumber(count)}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="card-header" style={{ fontSize:14, marginBottom:6 }}>Inventory Insights</div>
            <div>Total Depletion: <strong>{formatNumber(data.inventory?.totalDepletion)}</strong></div>
            <div>Recent Adjustments: <strong>{formatNumber(data.inventory?.recentAdjustments?.length || 0)}</strong></div>
          </div>
        </div>
      </div>

      <h3>Orders Over Time</h3>
      <div style={{ width: "100%", height: 280, marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ordersSeries} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" tickFormatter={(value) => new Date(value).toLocaleString("en-IN", { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} interval={Math.max(0, Math.floor((ordersSeries.length || 1) / 6) - 1)} tick={{ fontSize: 10 }} />
            <YAxis />
            <Tooltip labelFormatter={(value) => new Date(value).toLocaleString()} />
            <Bar dataKey="orders" fill="#2980b9" name="Orders" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h3>Revenue Over Time</h3>
      <div style={{ width: "100%", height: 280, marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={revenueSeries} margin={{ top: 10, right: 12, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" tickFormatter={(value) => new Date(value).toLocaleString("en-IN", { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} interval={Math.max(0, Math.floor((revenueSeries.length || 1) / 6) - 1)} tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={(value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
            <Tooltip labelFormatter={(value) => new Date(value).toLocaleString()} formatter={(value) => [formatCurrency(value), 'Revenue']} />
            <Bar dataKey="revenue" fill="#27ae60" name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div>
          <h3>Recent Inventory Adjustments</h3>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6 }}>
            <table width="100%" cellPadding="8" style={{ fontSize: 13 }}>
              <thead style={{ background: '#f7f9fc' }}>
                <tr>
                  <th align="left">When</th>
                  <th align="left">Item</th>
                  <th align="right">Δ</th>
                  <th align="right">Current</th>
                </tr>
              </thead>
              <tbody>
                {data.inventory?.recentAdjustments?.length === 0 && (
                  <tr>
                    <td colSpan="4" align="center" style={{ color: '#777', padding: 16 }}>No adjustments yet.</td>
                  </tr>
                )}
                {data.inventory?.recentAdjustments?.map((entry, idx) => (
                  <tr key={idx}>
                    <td>{new Date(entry.time).toLocaleString()}</td>
                    <td>{entry.itemName || `Item ${entry.itemId}`}</td>
                    <td align="right" style={{ color: entry.delta < 0 ? '#c0392b' : '#27ae60' }}>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</td>
                    <td align="right">{entry.current != null ? formatNumber(entry.current) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3>Historical Performance</h3>
          <div className="history-chart-controls">
            <div className="chart-toggle">
              <button type="button" className={historyChartType === "bar" ? "active" : ""} onClick={() => setHistoryChartType("bar")}>Bar</button>
              <button type="button" className={historyChartType === "line" ? "active" : ""} onClick={() => setHistoryChartType("line")}>Line</button>
              <button type="button" className={historyChartType === "pie" ? "active" : ""} onClick={() => setHistoryChartType("pie")}>Pie</button>
            </div>
          </div>
          <div className="history-chart" style={{ width: "100%", height: 260, marginBottom: 12 }}>
            {renderHistoryChart()}
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6 }}>
            <table width="100%" cellPadding="8" style={{ fontSize: 13 }}>
              <thead style={{ background: '#f7f9fc' }}>
                <tr>
                  <th align="left">Period</th>
                  <th align="right">Orders</th>
                  <th align="right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.history?.length === 0 && (
                  <tr>
                    <td colSpan="3" align="center" style={{ color: '#777', padding: 16 }}>No history yet.</td>
                  </tr>
                )}
                {data.history?.map((row, idx) => (
                  <tr key={idx}>
                    <td>{new Date(row.period).toLocaleString('en-IN', { month: 'short', year: 'numeric' })}</td>
                    <td align="right">{formatNumber(row.orders)}</td>
                    <td align="right">{formatCurrency(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

Analytics.propTypes = {
  token: PropTypes.string.isRequired,
};

export default Analytics;