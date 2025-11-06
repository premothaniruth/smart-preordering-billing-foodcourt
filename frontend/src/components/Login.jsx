import React, { useState } from "react";
import PropTypes from "prop-types";
import { vendorLogin } from "../api";
import { toast } from "react-toastify";

/**
 * Login
 * Vendor login form (username/password). On success, returns JWT token via onLogin.
 * @param {{ onLogin: (token:string)=>void }} props
 */

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Attempt vendor login via API
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await vendorLogin(username, password);
      if (data.token) {
        onLogin({ token: data.token, foodCourt: data.foodCourt });
        toast.success(`Logged into ${(data.foodCourt || "fc-1").toUpperCase()} successfully`);
      } else {
        toast.error(data.message || "Login failed");
      }
    } catch {
      toast.error("Login error");
    }
  };

  return (
    <div>
      <h2>Vendor Login</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Vendor username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
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
};

export default Login;