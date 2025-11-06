import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { toast } from "react-toastify";
import { deleteAdminEmployee, fetchAdminEmployees } from "../api";

const AUTO_REFRESH_INTERVAL = 30_000;

const AdminEmployeeDirectory = ({ adminSession }) => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const loadEmployees = useCallback(async () => {
    if (!adminSession) {
      setEmployees([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminEmployees(adminSession);
      if (res?.status === "ok" && Array.isArray(res.employees)) {
        setEmployees(res.employees);
      } else {
        setEmployees([]);
        setError(res?.message || "Failed to load employees");
        if (res?.message) toast.error(res.message);
      }
    } catch (err) {
      console.error("Failed to fetch employees", err);
      setEmployees([]);
      setError("Unable to load employees");
      toast.error("Unable to load employees");
    } finally {
      setLoading(false);
    }
  }, [adminSession]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees, refreshNonce]);

  useEffect(() => {
    if (!adminSession) return undefined;
    const timer = setInterval(() => {
      setRefreshNonce((n) => n + 1);
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [adminSession]);

  const handleManualRefresh = () => {
    setRefreshNonce((n) => n + 1);
  };

  const handleDelete = async (employee) => {
    if (!adminSession || !employee?.id) return;
    const label = employee.username || employee.email || `Employee #${employee.id}`;
    const confirmed = window.confirm(`Remove ${label}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      setLoading(true);
      const res = await deleteAdminEmployee(adminSession, employee.id);
      if (res?.status === "success") {
        toast.success("Employee removed");
        setEmployees((prev) => prev.filter((entry) => entry.id !== employee.id));
      } else {
        toast.error(res?.message || "Failed to remove employee");
      }
    } catch (error) {
      console.error("Failed to delete employee", error);
      toast.error("Unable to remove employee");
    } finally {
      setLoading(false);
    }
  };

  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      const aName = (a.username || a.email || "").toLowerCase();
      const bName = (b.username || b.email || "").toLowerCase();
      return aName.localeCompare(bName);
    });
  }, [employees]);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Registered Employees</span>
        <div style={{ display: "flex", gap: 10 }}>
          {loading && <span style={{ fontSize: 12, color: "#7f8c8d" }}>Loading…</span>}
          <button type="button" onClick={handleManualRefresh} className="secondary-button" disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {error && (
          <div style={{ padding: 16, color: "#c0392b" }}>{error}</div>
        )}
        {!error && sortedEmployees.length === 0 && (
          <div style={{ padding: 16, color: "#7f8c8d" }}>No employees found.</div>
        )}
        {!error && sortedEmployees.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f2f6f9", textAlign: "left", fontSize: 12, color: "#7f8c8d" }}>
                  <th style={{ padding: "10px 12px" }}>Username</th>
                  <th style={{ padding: "10px 12px" }}>Email</th>
                  <th style={{ padding: "10px 12px" }}>Mobile</th>
                  <th style={{ padding: "10px 12px" }}>Role</th>
                  <th style={{ padding: "10px 12px" }}>Wallet</th>
                  <th style={{ padding: "10px 12px" }}>Created</th>
                  <th style={{ padding: "10px 12px" }}>Updated</th>
                  <th style={{ padding: "10px 12px", width: 80 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmployees.map((employee) => {
                  const { wallet = {} } = employee;
                  return (
                    <tr key={employee.id} style={{ borderBottom: "1px solid #eef2f6", fontSize: 13 }}>
                      <td style={{ padding: "10px 12px" }}>{employee.username || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>{employee.email || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>{employee.mobile || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>{employee.roleSlug || employee.role || "Employee"}</td>
                      <td style={{ padding: "10px 12px" }}>₹{Number(wallet.balance || 0).toFixed(2)}</td>
                      <td style={{ padding: "10px 12px" }}>{employee.createdAt ? new Date(employee.createdAt).toLocaleString("en-IN", { dateStyle: "medium" }) : "—"}</td>
                      <td style={{ padding: "10px 12px" }}>{employee.updatedAt ? new Date(employee.updatedAt).toLocaleString("en-IN", { dateStyle: "medium" }) : "—"}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleDelete(employee)}
                          disabled={loading}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

AdminEmployeeDirectory.propTypes = {
  adminSession: PropTypes.shape({
    username: PropTypes.string.isRequired,
    password: PropTypes.string,
  }),
};

export default AdminEmployeeDirectory;
