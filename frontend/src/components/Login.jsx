import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { vendorLogin } from "../api";
import { toast } from "react-toastify";

/**
 * Login
 * Vendor login form (username/password). On success, returns JWT token via onLogin.
 * @param {{ onLogin: (token:string)=>void }} props
 */

const Login = ({
  onLogin,
  onBack = undefined,
  foodCourts = [],
  defaultFoodCourt = "fc-1",
  onFoodCourtChange = undefined,
  foodCourtsLoading = false,
}) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const normalizedOptions = useMemo(() => {
    if (!Array.isArray(foodCourts) || foodCourts.length === 0) {
      const fallback = defaultFoodCourt || "fc-1";
      return [{ value: fallback, label: fallback.toUpperCase() }];
    }
    return foodCourts.map((option) => {
      if (typeof option === "string") {
        const value = option.trim();
        return { value, label: value.toUpperCase() };
      }
      const value = String(option?.value ?? option?.id ?? "").trim();
      const labelSource = option?.label ?? option?.name ?? value;
      const label = String((labelSource || "Food Court"));
      return { value: value || "", label: label || value.toUpperCase() };
    }).filter((option) => option.value);
  }, [foodCourts, defaultFoodCourt]);

  const initialFoodCourt = useMemo(() => {
    const fallback = normalizedOptions[0]?.value || defaultFoodCourt || "fc-1";
    try {
      const stored = localStorage.getItem("vendorSelectedFoodCourt");
      if (stored && normalizedOptions.some((option) => option.value === stored)) {
        return stored;
      }
    } catch {}
    return fallback;
  }, [defaultFoodCourt, normalizedOptions]);

  const [foodCourt, setFoodCourt] = useState(initialFoodCourt);

  useEffect(() => {
    if (normalizedOptions.length === 0) return;
    if (!normalizedOptions.some((option) => option.value === foodCourt)) {
      setFoodCourt(normalizedOptions[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedOptions]);

  useEffect(() => {
    try {
      localStorage.setItem("vendorSelectedFoodCourt", foodCourt);
    } catch {}
    if (typeof onFoodCourtChange === "function") {
      onFoodCourtChange(foodCourt);
    }
  }, [foodCourt]);

  // Attempt vendor login via API
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await vendorLogin(username, password, foodCourt);
      if (data.token) {
        try {
          localStorage.setItem("vendorSelectedFoodCourt", data.foodCourt || foodCourt);
        } catch {}
        onLogin({ token: data.token, foodCourt: data.foodCourt });
        const label = normalizedOptions.find((option) => option.value === (data.foodCourt || foodCourt))?.label
          || (data.foodCourt || foodCourt || "fc-1").toUpperCase();
        toast.success(`Logged into ${label} successfully`);
      } else {
        toast.error(data.message || "Login failed");
      }
    } catch {
      toast.error("Login error");
    }
  };

  return (
    <div>
      {typeof onBack === 'function' && (
        <button type="button" onClick={onBack} className="link-button" style={{ marginBottom: 12 }}>
          ← Back
        </button>
      )}
      <h2>Vendor Login</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Vendor username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <br />
        <div style={{ margin: "12px 0" }}>
          <div style={{ fontSize: 13, color: "#7f8c8d", marginBottom: 6 }}>Select Food Court</div>
          <select
            value={foodCourt}
            onChange={(e) => setFoodCourt(e.target.value)}
            disabled={foodCourtsLoading || normalizedOptions.length === 0}
            style={{ minWidth: 200 }}
          >
            {normalizedOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {foodCourtsLoading && (
            <div style={{ fontSize: 12, color: "#7f8c8d", marginTop: 6 }}>Refreshing food courts…</div>
          )}
        </div>
        <br />
        <div style={{ position: "relative", display: "inline-block" }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ paddingRight: 70 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              border: "none",
              background: "none",
              color: "#2980b9",
              cursor: "pointer",
              width: 32,
              height: 32,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <svg
                aria-hidden="true"
                className="eye-icon"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                style={{ width: 18, height: 18 }}
              >
                <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M9.88 9.88A3 3 0 0114.12 14.12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d="M10.73 5.08A10.86 10.86 0 0121 12c-1.1 1.86-2.57 3.47-4.31 4.71M6.24 6.24C4.03 7.73 2.28 9.67 1 12c1.88 3.34 5.36 6 10 6 1.48 0 2.86-.24 4.11-.69" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                className="eye-icon"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                style={{ width: 18, height: 18 }}
              >
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
              </svg>
            )}
          </button>
        </div>
        <br />
        <button type="submit">Login</button>
      </form>
    </div>
  );
};

Login.propTypes = {
  onLogin: PropTypes.func.isRequired,
  onBack: PropTypes.func,
  foodCourts: PropTypes.arrayOf(
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.shape({
        value: PropTypes.string,
        label: PropTypes.string,
        id: PropTypes.string,
        name: PropTypes.string,
      }),
    ])
  ),
  defaultFoodCourt: PropTypes.string,
  onFoodCourtChange: PropTypes.func,
  foodCourtsLoading: PropTypes.bool,
};

export default Login;