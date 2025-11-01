import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  employeePasswordLogin,
  employeePinLogin,
  employeeRequestOtp,
  employeeVerifyOtp,
  employeeRegister,
} from "../api";
import { toast } from "react-toastify";

const PIN_IDENTITY_KEY = "employeePinIdentity";
const OTP_IDENTITY_KEY = "employeeOtpIdentity";

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

const readOtpIdentity = () => {
  try {
    const raw = localStorage.getItem(OTP_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.username && (parsed.mobile || parsed.email)) {
      return parsed;
    }
  } catch {}
  return null;
};

const EmployeeLogin = ({ onSuccess, onBack }) => {
  const [authMode, setAuthMode] = useState("signin");
  const [signInMethod, setSignInMethod] = useState("password");
  const [loading, setLoading] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);

  const [uname, setUname] = useState("");
  const [pwd, setPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showSignupPwd, setShowSignupPwd] = useState(false);

  const [pinUsername, setPinUsername] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);

  const [otpMobile, setOtpMobile] = useState("");
  const [otpStage, setOtpStage] = useState("request");
  const [otp, setOtp] = useState("");
  const [otpCountdown, setOtpCountdown] = useState(0);

  const [pinIdentity, setPinIdentity] = useState(() => readPinIdentity());
  const [otpIdentity, setOtpIdentity] = useState(() => readOtpIdentity());

  const [signupData, setSignupData] = useState({
    username: "",
    email: "",
    mobile: "",
    password: "",
    pin: "",
  });

  useEffect(() => {
    if (otpStage === "verify" && otpCountdown > 0) {
      const id = setTimeout(() => setOtpCountdown((c) => c - 1), 1000);
      return () => clearTimeout(id);
    }
  }, [otpStage, otpCountdown]);

  useEffect(() => {
    setLoading(false);
    setOtpStage("request");
    setOtp("");
    setOtpCountdown(0);
  }, [signInMethod]);

  useEffect(() => {
    setLoading(false);
    if (authMode === "signin") {
      setSignupLoading(false);
    }
  }, [authMode]);

  const persistPinIdentity = (identity) => {
    try {
      localStorage.setItem(PIN_IDENTITY_KEY, JSON.stringify(identity));
      setPinIdentity(identity);
    } catch {}
  };

  const persistOtpIdentity = (identity) => {
    try {
      localStorage.setItem(OTP_IDENTITY_KEY, JSON.stringify(identity));
      setOtpIdentity(identity);
    } catch {}
  };

  const formatMobileDigits = (value) => String(value || "").replace(/[^0-9]/g, "").slice(0, 10);

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
          persistOtpIdentity(identity);
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
    if (!pinUsername.trim()) {
      toast.error("Enter your username");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      toast.error("Enter your 4-digit PIN");
      return;
    }
    try {
      setLoading(true);
      const res = await employeePinLogin(pinUsername.trim(), pin, pinIdentity?.mobile || pinIdentity?.email);
      if (res && res.status === "ok" && res.token) {
        onSuccess({ token: res.token, mobile: res.mobile });
        toast.success("Logged in");
        persistPinIdentity({ username: pinUsername.trim(), mobile: res.mobile, email: res.email });
      } else {
        toast.error(res?.message || "PIN login failed");
      }
    } catch {
      toast.error("Error during PIN login");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (event) => {
    event.preventDefault();
    const digits = formatMobileDigits(otpMobile);
    if (digits.length !== 10) {
      toast.error("Enter a valid 10-digit mobile");
      return;
    }
    try {
      setLoading(true);
      const res = await employeeRequestOtp(digits);
      if (res && res.status === "ok") {
        toast.success("OTP sent to your registered mobile");
        setOtpStage("verify");
        setOtpCountdown(45);
      } else {
        toast.error(res?.message || "Failed to send OTP");
      }
    } catch {
      toast.error("Error requesting OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    const digits = formatMobileDigits(otpMobile);
    if (digits.length !== 10) {
      toast.error("Enter a valid 10-digit mobile");
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      toast.error("Enter the 6-digit OTP");
      return;
    }
    try {
      setLoading(true);
      const res = await employeeVerifyOtp(digits, otp);
      if (res && res.status === "ok" && res.token) {
        toast.success("Logged in");
        onSuccess({ token: res.token, mobile: res.mobile });
        setOtp("");
        setOtpMobile("");
        setOtpStage("request");
        setOtpCountdown(0);
      } else {
        toast.error(res?.message || "Invalid OTP");
      }
    } catch {
      toast.error("Error verifying OTP");
    } finally {
      setLoading(false);
    }
  };

  const validateSignup = () => {
    const { username, email, mobile, password, pin } = signupData;
    if (!username.trim()) {
      toast.error("Username is required");
      return false;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || "").trim())) {
      toast.error("Enter a valid email address");
      return false;
    }
    if (formatMobileDigits(mobile).length !== 10) {
      toast.error("Enter a valid 10-digit mobile");
      return false;
    }
    if (!(password && password.length >= 8 && password.length <= 20 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[\.,&%#@!]/.test(password))) {
      toast.error("Password must be 8-20 chars with a-z, A-Z, 0-9 and one of .,&%#@!");
      return false;
    }
    if (!/^\d{4}$/.test(pin)) {
      toast.error("PIN must be exactly 4 digits");
      return false;
    }
    return true;
  };

  const handleSignup = async (event) => {
    event.preventDefault();
    if (!validateSignup()) return;
    try {
      setSignupLoading(true);
      const payload = {
        username: signupData.username.trim(),
        email: signupData.email.trim(),
        mobile: formatMobileDigits(signupData.mobile),
        password: signupData.password,
        pin: signupData.pin,
      };
      const res = await employeeRegister(payload);
      if (res && res.status === "ok") {
        toast.success("Registration successful. You can now sign in.");
        setAuthMode("signin");
        setSignInMethod("password");
        setUname(payload.username);
        setPwd("");
      } else {
        toast.error(res?.message || "Registration failed");
      }
    } catch {
      toast.error("Error during registration");
    } finally {
      setSignupLoading(false);
    }
  };

  return (
    <div className="employee-login-wrapper">
      <button onClick={onBack} className="link-button" style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <div className="card employee-login-card">
        {authMode === "signin" ? (
          <>
            <h2 className="employee-auth-title">Sign in if you have already registered</h2>
            <p className="employee-auth-subtext">Choose any of the options below to access your employee account.</p>

            <div className="employee-auth-methods">
              <button
                type="button"
                onClick={() => setSignInMethod("otp")}
                className={`employee-auth-method ${signInMethod === "otp" ? "active" : ""}`}
              >
                Mobile + OTP
              </button>
              <button
                type="button"
                onClick={() => setSignInMethod("pin")}
                className={`employee-auth-method ${signInMethod === "pin" ? "active" : ""}`}
              >
                4-digit PIN
              </button>
              <button
                type="button"
                onClick={() => setSignInMethod("password")}
                className={`employee-auth-method ${signInMethod === "password" ? "active" : ""}`}
              >
                Username &amp; Password
              </button>
            </div>

            {signInMethod === "otp" && (
              <form onSubmit={otpStage === "request" ? handleRequestOtp : handleVerifyOtp} className="employee-auth-form">
                <div>
                  <label className="label">Registered Mobile (+91)</label>
                  <input
                    placeholder="10-digit mobile"
                    value={otpMobile}
                    onChange={(e) => setOtpMobile(formatMobileDigits(e.target.value))}
                    maxLength={10}
                    required
                  />
                </div>
                {otpStage === "verify" && (
                  <div>
                    <label className="label">Enter OTP</label>
                    <input
                      placeholder="6-digit OTP"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                      maxLength={6}
                      required
                    />
                  </div>
                )}
                <div className="employee-auth-actions">
                  <button type="submit" disabled={loading}>
                    {loading ? "Please wait..." : otpStage === "request" ? "Send OTP" : "Verify & Login"}
                  </button>
                  {otpStage === "verify" && (
                    <button
                      type="button"
                      disabled={loading || otpCountdown > 0}
                      onClick={handleRequestOtp}
                      className="secondary"
                    >
                      {otpCountdown > 0 ? `Resend in ${otpCountdown}s` : "Resend OTP"}
                    </button>
                  )}
                </div>
              </form>
            )}

            {signInMethod === "pin" && (
              <form onSubmit={handlePinLogin} className="employee-auth-form">
                <div>
                  <label className="label">Username</label>
                  <input placeholder="Enter username" value={pinUsername} onChange={(e) => setPinUsername(e.target.value)} required />
                </div>
                <div className="password-field">
                  <label className="label">4-digit PIN</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPin ? "text" : "password"}
                      placeholder="PIN"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                      maxLength={4}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin((s) => !s)}
                      className="password-toggle"
                      aria-label={showPin ? "Hide PIN" : "Show PIN"}
                    >
                      {showPin ? (
                        <svg
                          aria-hidden="true"
                          className="eye-icon"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M3 3l18 18"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                          <path
                            d="M9.88 9.88A3 3 0 0114.12 14.12"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                          <path
                            d="M10.73 5.08A10.86 10.86 0 0121 12c-1.1 1.86-2.57 3.47-4.31 4.71M6.24 6.24C4.03 7.73 2.28 9.67 1 12c1.88 3.34 5.36 6 10 6 1.48 0 2.86-.24 4.11-.69"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      ) : (
                        <svg
                          aria-hidden="true"
                          className="eye-icon"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinejoin="round"
                            fill="none"
                          />
                          <circle
                            cx="12"
                            cy="12"
                            r="3"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            fill="none"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading}>
                  {loading ? "Logging in..." : "Login"}
                </button>
              </form>
            )}

            {signInMethod === "password" && (
              <form onSubmit={handlePasswordLogin} className="employee-auth-form">
                <div>
                  <label className="label">Username or Email</label>
                  <input placeholder="john.doe" value={uname} onChange={(e) => setUname(e.target.value)} required />
                </div>
                <div className="password-field">
                  <label className="label">Password</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPwd ? "text" : "password"}
                      placeholder="Password"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      className="password-toggle"
                      aria-label={showPwd ? "Hide password" : "Show password"}
                    >
                      {showPwd ? (
                        <svg
                          aria-hidden="true"
                          className="eye-icon"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M3 3l18 18"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                          <path
                            d="M9.88 9.88A3 3 0 0114.12 14.12"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                          <path
                            d="M10.73 5.08A10.86 10.86 0 0121 12c-1.1 1.86-2.57 3.47-4.31 4.71M6.24 6.24C4.03 7.73 2.28 9.67 1 12c1.88 3.34 5.36 6 10 6 1.48 0 2.86-.24 4.11-.69"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      ) : (
                        <svg
                          aria-hidden="true"
                          className="eye-icon"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinejoin="round"
                            fill="none"
                          />
                          <circle
                            cx="12"
                            cy="12"
                            r="3"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            fill="none"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading}>
                  {loading ? "Logging in..." : "Login"}
                </button>
              </form>
            )}

            <div className="employee-auth-footer">
              <span>New employee?</span>
              <button type="button" className="link-button" onClick={() => setAuthMode("signup")}>
                Sign up if you are logging in for the first time
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="employee-auth-title">Create your employee account</h2>
            <p className="employee-auth-subtext">Register once with your official details to access ordering and tracking.</p>

            <form onSubmit={handleSignup} className="employee-auth-form">
              <div>
                <label className="label">Username</label>
                <input
                  placeholder="Choose a username"
                  value={signupData.username}
                  onChange={(e) => setSignupData((prev) => ({ ...prev, username: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={signupData.email}
                  onChange={(e) => setSignupData((prev) => ({ ...prev, email: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Mobile (+91)</label>
                <input
                  placeholder="10-digit mobile"
                  value={signupData.mobile}
                  onChange={(e) => setSignupData((prev) => ({ ...prev, mobile: formatMobileDigits(e.target.value) }))}
                  maxLength={10}
                  required
                />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="password-input-wrapper">
                  <input
                    type={showSignupPwd ? "text" : "password"}
                    placeholder="Password (8-20 chars, a-z, A-Z, 0-9, one of .,&%#@!)"
                    value={signupData.password}
                    onChange={(e) => setSignupData((prev) => ({ ...prev, password: e.target.value }))}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPwd((v) => !v)}
                    className="password-toggle"
                    aria-label={showSignupPwd ? "Hide password" : "Show password"}
                  >
                    {showSignupPwd ? (
                      <svg
                        aria-hidden="true"
                        className="eye-icon"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M3 3l18 18"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                        <path
                          d="M9.88 9.88A3 3 0 0114.12 14.12"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                        <path
                          d="M10.73 5.08A10.86 10.86 0 0121 12c-1.1 1.86-2.57 3.47-4.31 4.71M6.24 6.24C4.03 7.73 2.28 9.67 1 12c1.88 3.34 5.36 6 10 6 1.48 0 2.86-.24 4.11-.69"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    ) : (
                      <svg
                        aria-hidden="true"
                        className="eye-icon"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                          fill="none"
                        />
                        <circle
                          cx="12"
                          cy="12"
                          r="3"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          fill="none"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">4-digit PIN</label>
                <input
                  placeholder="PIN"
                  value={signupData.pin}
                  onChange={(e) => setSignupData((prev) => ({ ...prev, pin: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) }))}
                  maxLength={4}
                  required
                />
              </div>
              <button type="submit" disabled={signupLoading}>
                {signupLoading ? "Registering..." : "Register"}
              </button>
            </form>

            <div className="employee-auth-footer">
              <span>Already registered?</span>
              <button type="button" className="link-button" onClick={() => setAuthMode("signin")}>
                Back to sign in options
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
;

EmployeeLogin.propTypes = {
  onSuccess: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
};

export default EmployeeLogin;
