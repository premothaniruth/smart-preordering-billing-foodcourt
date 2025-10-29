import React, { useEffect, useState, useRef } from "react";
import PropTypes from "prop-types";
import { employeeRequestOtp, employeeVerifyOtp, employeeGoogleLogin, employeeAppleLogin } from "../api";
import { GOOGLE_CLIENT_ID, APPLE_CLIENT_ID } from "../config";
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
  const [recent, setRecent] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const googleBtnRef = useRef(null);
  const [appleReady, setAppleReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('employeeRecentMobiles');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setRecent(arr.filter(Boolean));
    } catch {}
  }, []);

  // Load Google Identity Services and render button
  useEffect(() => {
    if (step !== 'mobile') return;
    if (!GOOGLE_CLIENT_ID) return;
    const ensureScript = () => new Promise((resolve) => {
      if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      document.head.appendChild(s);
    });
    let cancelled = false;
    ensureScript().then(() => {
      if (cancelled) return;
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            try {
              const idToken = response?.credential;
              if (!idToken) return toast.error('Google sign-in failed');
              const res = await employeeGoogleLogin(idToken);
              if (res && res.status === 'ok' && res.token) {
                onSuccess({ token: res.token, mobile: res.mobile });
                toast.success('Logged in with Google');
              } else {
                toast.error(res?.message || 'Google login failed');
              }
            } catch {
              toast.error('Error during Google login');
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true
        });
        if (googleBtnRef.current) {
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            theme: 'outline',
            size: 'large',
            type: 'standard',
            shape: 'pill',
            logo_alignment: 'left',
          });
        }
      } catch {}
    });
    return () => { cancelled = true; };
  }, [step]);

  // Load Apple JS SDK
  useEffect(() => {
    if (step !== 'mobile') return;
    if (!APPLE_CLIENT_ID) return;
    const ensureScript = () => new Promise((resolve) => {
      if (window.AppleID && window.AppleID.auth) return resolve();
      const s = document.createElement('script');
      s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
      s.async = true;
      s.onload = () => resolve();
      document.head.appendChild(s);
    });
    let cancelled = false;
    ensureScript().then(() => {
      if (cancelled) return;
      try {
        window.AppleID.auth.init({
          clientId: APPLE_CLIENT_ID,
          scope: 'name email',
          redirectURI: window.location.origin, // not used for popup but required
          usePopup: true,
        });
        setAppleReady(true);
      } catch {}
    });
    return () => { cancelled = true; };
  }, [step]);

  const rememberMobile = (num) => {
    try {
      const raw = localStorage.getItem('employeeRecentMobiles');
      const arr = raw ? JSON.parse(raw) : [];
      const next = [num, ...arr.filter(x => x !== num)].slice(0, 5);
      localStorage.setItem('employeeRecentMobiles', JSON.stringify(next));
      setRecent(next);
    } catch {}
  };

  // countdown for resend
  useEffect(() => {
    if (step !== 'otp') return;
    if (resendSeconds <= 0) return;
    const id = setInterval(() => setResendSeconds((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [step, resendSeconds]);

  const maskMobile = (num) => {
    if (!num) return '';
    const s = String(num).replace(/\D/g, '');
    if (s.length <= 4) return s.padStart(s.length, '*');
    const first = s.slice(0, 3);
    const last = s.slice(-3);
    return `${first}****${last}`; // e.g., 987****321
  };

  const clearSuggestions = () => {
    try { localStorage.removeItem('employeeRecentMobiles'); } catch {}
    setRecent([]);
  };

  // Request OTP for entered mobile
  const requestOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await employeeRequestOtp(mobile);
      if (res.status === "ok") {
        toast.info("OTP sent. Check server console.", { autoClose: 2000 });
        setStep("otp");
        setResendSeconds(45);
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
        rememberMobile(res.mobile || mobile);
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
    <div style={{ display:'flex', justifyContent:'center', padding:'20px' }}>
      {step === "mobile" && (
        <form onSubmit={requestOtp} style={{ width:'100%', maxWidth: 380, background:'#fff', border:'1px solid #eee', borderRadius:12, padding:18, boxShadow:'0 6px 24px rgba(0,0,0,0.06)' }}>
          <h2 style={{ margin:0, fontSize:20 }}>Employee Login</h2>
          <div style={{ position:'relative', marginTop:12 }}>
            <input
              ref={inputRef}
              placeholder="Mobile Number"
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, ""))}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(()=>setShowSuggestions(false), 120)}
              maxLength={10}
              required
              style={{ width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:14 }}
            />
            {showSuggestions && recent.length > 0 && (
              <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1px solid #ddd', borderRadius:6, marginTop:4, zIndex:10, overflow:'hidden' }}>
                {recent.map((num, idx) => (
                  <div
                    key={idx}
                    onMouseDown={(e)=>{ e.preventDefault(); setMobile(num); setShowSuggestions(false); inputRef.current && inputRef.current.blur(); }}
                    style={{ padding:'8px 10px', cursor:'pointer', fontSize:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}
                  >
                    <span>📞 {maskMobile(num)}</span>
                    <span style={{ fontSize:12, color:'#999' }}>Tap to use</span>
                  </div>
                ))}
                <div style={{ borderTop:'1px solid #eee', padding:'6px 10px', textAlign:'right' }}>
                  <button type="button" onMouseDown={(e)=>{ e.preventDefault(); clearSuggestions(); setShowSuggestions(false); }} style={{ background:'transparent', border:'none', color:'#e74c3c', cursor:'pointer', fontSize:12 }}>Clear suggestions</button>
                </div>
              </div>
            )}
          </div>
          <button type="submit" disabled={loading || mobile.length !== 10} style={{ width:'100%', marginTop:12, padding:'10px 12px', background:'#111', color:'#fff', border:'1px solid #111', borderRadius:8, fontWeight:600 }}>
            {loading ? "Sending..." : "Send OTP"}
          </button>
          <div style={{ display:'flex', alignItems:'center', margin:'12px 0' }}>
            <div style={{ flex:1, height:1, background:'#eee' }} />
            <span style={{ margin:'0 8px', fontSize:12, color:'#888' }}>or</span>
            <div style={{ flex:1, height:1, background:'#eee' }} />
          </div>
          <div style={{ width:'100%', marginTop:4, display:'flex', justifyContent:'center', gap:12, flexWrap:'wrap' }}>
            <div ref={googleBtnRef} />
            <button
              type="button"
              disabled={!appleReady}
              onClick={async () => {
                try {
                  const resp = await window.AppleID.auth.signIn();
                  const idToken = resp?.authorization?.id_token;
                  if (!idToken) return toast.error('Apple sign-in failed');
                  const res = await employeeAppleLogin(idToken);
                  if (res && res.status === 'ok' && res.token) {
                    onSuccess({ token: res.token, mobile: res.mobile });
                    toast.success('Logged in with Apple');
                  } else {
                    toast.error(res?.message || 'Apple login failed');
                  }
                } catch (e) {
                  // User may cancel popup; only toast on actual errors
                  if (String(e?.error) !== 'popup_closed_by_user') toast.error('Error during Apple login');
                }
              }}
              style={{ padding:'8px 12px', borderRadius:8, border:'1px solid #111', background:'#000', color:'#fff', fontWeight:600 }}
              title={appleReady ? 'Continue with Apple' : 'Apple not initialized'}
            >
               Sign in with Apple
            </button>
          </div>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={verifyOtp} style={{ width:'100%', maxWidth: 380, background:'#fff', border:'1px solid #eee', borderRadius:12, padding:18, boxShadow:'0 6px 24px rgba(0,0,0,0.06)' }}>
          <h2 style={{ margin:0, fontSize:20 }}>Enter OTP</h2>
          <input
            placeholder="6-digit OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
            maxLength={6}
            required
            style={{ width:'100%', marginTop:12, padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:14, letterSpacing:2 }}
          />
          <button type="submit" disabled={loading || otp.length !== 6} style={{ width:'100%', marginTop:12, padding:'10px 12px', background:'#111', color:'#fff', border:'1px solid #111', borderRadius:8, fontWeight:600 }}>
            {loading ? "Verifying..." : "Verify & Continue"}
          </button>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:10 }}>
            <button type="button" onClick={() => setStep("mobile")} style={{ background:'#fff', color:'#111', border:'1px solid #111', padding:'8px 12px', borderRadius:8 }}>Back</button>
            <button
              type="button"
              onClick={async () => { if (resendSeconds > 0) return; setLoading(true); try { const r = await employeeRequestOtp(mobile); if (r.status === 'ok') { toast.info('OTP sent. Check server console.', { autoClose: 2000 }); setResendSeconds(45); } else { toast.error(r.message || 'Failed to resend OTP'); } } catch { toast.error('Error requesting OTP'); } finally { setLoading(false);} }}
              disabled={resendSeconds > 0}
              style={{ background:'#fff', color:'#111', border:'1px solid #111', padding:'8px 12px', borderRadius:8, opacity: resendSeconds>0 ? 0.6 : 1 }}
            >
              {resendSeconds > 0 ? `Resend OTP in ${resendSeconds}s` : 'Resend OTP'}
            </button>
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
