import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { employeePasswordLogin, employeePinLogin } from "../api";
import { toast } from "react-toastify";

const PIN_IDENTITY_KEY = "employeePinIdentity";

const readPinIdentity = () => {
  try {
    const raw = localStorage.getItem(PIN_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.username && (parsed.mobile || parsed.email)) {
      return parsed;
    }
  } catch {}
  return null;
};

const EmployeeLogin = ({ onSuccess }) => {
  const [mode, setMode] = useState("password");
  const [loading, setLoading] = useState(false);
  const [uname, setUname] = useState("");
  const [pwd, setPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [pin, setPin] = useState("");
  const [pinIdentity, setPinIdentity] = useState(() => readPinIdentity());

  useEffect(() => {
    setLoading(false);
    if (mode === "password") {
      setPin("");
    } else {
      setPwd("");
      setShowPwd(false);
    }
  }, [mode]);

  const persistPinIdentity = (identity) => {
    try {
      localStorage.setItem(PIN_IDENTITY_KEY, JSON.stringify(identity));
      setPinIdentity(identity);
    } catch {}
  };

  const handlePasswordLogin = async (event) => {
    event.preventDefault();
    if (!uname || !pwd) {
      toast.error("Enter username and password");
      return;
    }
    try {
      setLoading(true);
      const res = await employeePasswordLogin(uname, pwd);
      if (res && res.status === "ok" && res.token) {
        onSuccess({ token: res.token, mobile: res.mobile });
        toast.success("Logged in");
        const identity = {
          username: res.username || uname,
          mobile: res.mobile,
          email: res.email,
        };
        if (identity.username) {
          persistPinIdentity(identity);
        }
      } else {
        toast.error(res?.message || "Login failed");
      }
    } catch {
      toast.error("Error during login");
    } finally {
      setLoading(false);
    }
  };

  const handlePinLogin = async (event) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(pin)) {
      toast.error("Enter your 4-digit PIN");
      return;
    }
    if (!pinIdentity || !pinIdentity.username) {
      toast.error("PIN login not set up on this device. Please login once with username & password.");
      return;
    }
    try {
      setLoading(true);
      const res = await employeePinLogin(pinIdentity.username, pin, pinIdentity.mobile || pinIdentity.email);
      if (res && res.status === "ok" && res.token) {
        onSuccess({ token: res.token, mobile: res.mobile });
        toast.success("Logged in");
      } else {
        toast.error(res?.message || "PIN login failed");
      }
    } catch {
      toast.error("Error during PIN login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Choose Login Method</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="radio" name="emp-login-mode" checked={mode === "password"} onChange={() => setMode("password")} />
              <span>Username &amp; Password</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="radio" name="emp-login-mode" checked={mode === "pin"} onChange={() => setMode("pin")} />
              <span>4-digit PIN</span>
            </label>
          </div>
        </div>

        {mode === "password" && (
          <form onSubmit={handlePasswordLogin} className="card" style={{ padding: 18, background: "#fff", border: "1px solid #eee", borderRadius: 12, boxShadow: "0 6px 24px rgba(0,0,0,0.06)" }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Login with Username &amp; Password</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 12 }}>
              <input placeholder="Username or Email" value={uname} onChange={(e) => setUname(e.target.value)} />
              <div style={{ position: "relative" }}>
                <input
                  type={showPwd ? "text" : "password"}
                  placeholder="Password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  style={{ width: "100%", paddingRight: 74 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  style={{ position: "absolute", right: 6, top: 6, padding: "6px 10px", fontSize: 12, border: "1px solid #ddd", background: "#f8f9fa", borderRadius: 6 }}
                >
                  {showPwd ? "Hide" : "Show"}
                </button>
              </div>
              <button
                type="submit"
                style={{ width: "100%", padding: "10px 12px", background: "#111", color: "#fff", border: "1px solid #111", borderRadius: 8, fontWeight: 600 }}
                disabled={loading}
              >
                {loading ? "Logging in..." : "Login"}
              </button>
            </div>
          </form>
        )}

        {mode === "pin" && (
          <form onSubmit={handlePinLogin} className="card" style={{ padding: 18, background: "#fff", border: "1px solid #eee", borderRadius: 12, boxShadow: "0 6px 24px rgba(0,0,0,0.06)" }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Login with 4-digit PIN</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 12, alignItems: "center" }}>
              <input placeholder="Enter 4-digit PIN" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />
              <button type="submit" disabled={loading}>
                {loading ? "Logging in..." : "Enter"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
              PIN login uses the credentials saved on this device after a successful username/password login.
            </div>
            {pinIdentity ? (
              <div style={{ fontSize: 12, color: "#444", marginTop: 8 }}>
                Stored identity: <strong>{pinIdentity.username}</strong>
                {pinIdentity.email ? ` (${pinIdentity.email})` : pinIdentity.mobile ? ` (${pinIdentity.mobile})` : ""}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#d35400", marginTop: 8 }}>
                No PIN identity stored yet. Please login once with username and password to enable PIN login.
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

EmployeeLogin.propTypes = {
  onSuccess: PropTypes.func.isRequired,
};

export default EmployeeLogin;
