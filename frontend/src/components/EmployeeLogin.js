import React, { useState } from "react";
import PropTypes from "prop-types";
import { employeeRequestOtp, employeeVerifyOtp } from "../api";
import { toast } from "react-toastify";

/**
 * EmployeeLogin
 * Two-step OTP flow for employee authentication.
 * @param {{ onSuccess: ({token:string, mobile:string})=>void }} props
 */

const EmployeeLogin = ({ onSuccess }) => {
  const [step, setStep] = useState("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  // Request OTP for entered mobile
  const requestOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await employeeRequestOtp(mobile);
      if (res.status === "ok") {
        toast.info("OTP sent. Check server console.");
        setStep("otp");
      } else {
        toast.error(res.message || "Failed to send OTP");
      }
    } catch (err) {
      toast.error("Error requesting OTP");
    } finally {
      setLoading(false);
    }
  };

  // Verify the OTP and return session to parent via onSuccess
  const verifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await employeeVerifyOtp(mobile, otp);
      if (res.status === "ok" && res.token) {
        toast.success("Logged in");
        onSuccess({ token: res.token, mobile: res.mobile });
      } else {
        toast.error(res.message || "Invalid OTP");
      }
    } catch (err) {
      toast.error("Error verifying OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {step === "mobile" && (
        <form onSubmit={requestOtp}>
          <h2>Employee Login</h2>
          <input
            placeholder="Mobile Number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, ""))}
            maxLength={10}
            required
          />
          <button type="submit" disabled={loading || mobile.length !== 10}>
            {loading ? "Sending..." : "Send OTP"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={verifyOtp}>
          <h2>Enter OTP</h2>
          <input
            placeholder="6-digit OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
            maxLength={6}
            required
          />
          <button type="submit" disabled={loading || otp.length !== 6}>
            {loading ? "Verifying..." : "Verify & Continue"}
          </button>
          <div className="mt-10">
            <button type="button" onClick={() => setStep("mobile")}>Back</button>
          </div>
        </form>
      )}
    </div>
  );
};

export default EmployeeLogin;
EmployeeLogin.propTypes = {
  onSuccess: PropTypes.func.isRequired,
};
