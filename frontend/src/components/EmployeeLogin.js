import React, { useEffect, useState, useRef } from "react";
import PropTypes from "prop-types";
import { employeeRequestOtp, employeeVerifyOtp, employeeGoogleLogin, employeeAppleLogin, employeePasswordLogin, employeePinLogin, employeeCheckUsername, employeeRegister } from "../api";
import { toast } from "react-toastify";

/**
 * EmployeeLogin
 * Two-step OTP flow for employee authentication.
 * @param {{ onSuccess: ({token:string, mobile:string})=>void }} props
 */

const EmployeeLogin = ({ onSuccess }) => {
  const [step, setStep] = useState("mobile");
  const [mode, setMode] = useState('mobile'); // 'mobile' | 'pin' | 'password'
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [uname, setUname] = useState("");
  const [pwd, setPwd] = useState("");
  const [pinUname, setPinUname] = useState("");
  const [pin, setPin] = useState("");
  const [pinContact, setPinContact] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regMobile, setRegMobile] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPin, setRegPin] = useState("");
  const [unameAvailable, setUnameAvailable] = useState(null); // true/false/null
  const [unameSuggestions, setUnameSuggestions] = useState([]);
  const [showPwd, setShowPwd] = useState(false);
  const [showRegPwd, setShowRegPwd] = useState(false);
  const PIN_IDENTITY_KEY = 'employeePinIdentity';

  const savePinIdentity = (identity) => {
    try { localStorage.setItem(PIN_IDENTITY_KEY, JSON.stringify(identity)); } catch {}
  };
  const getPinIdentity = () => {
    try {
      const raw = localStorage.getItem(PIN_IDENTITY_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && obj.username && (obj.mobile || obj.email)) return obj;
      return obj && obj.username ? obj : null;
    } catch { return null; }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem('employeeRecentMobiles');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setRecent(arr.filter(Boolean));
    } catch {}
  }, []);

  // No third-party SDKs in demo mode

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
      <div style={{ width:'100%', maxWidth: 420 }}>
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          <div style={{ fontWeight:700, marginBottom:8, fontSize:14 }}>Choose Login Method</div>
          <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
            <label style={{ display:'flex', alignItems:'center', gap:6 }}>
              <input type="radio" name="emp-login-mode" checked={mode==='mobile'} onChange={()=>{ setMode('mobile'); setStep('mobile'); }} />
              <span>Login by Mobile (OTP)</span>
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:6 }}>
              <input type="radio" name="emp-login-mode" checked={mode==='pin'} onChange={()=> setMode('pin')} />
              <span>Login by PIN</span>
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:6 }}>
              <input type="radio" name="emp-login-mode" checked={mode==='password'} onChange={()=> setMode('password')} />
              <span>Login by Username & Password</span>
            </label>
          </div>
        </div>

        {mode === 'mobile' && step === "mobile" && (
        <form onSubmit={requestOtp} style={{ width:'100%', background:'#fff', border:'1px solid #eee', borderRadius:12, padding:18, boxShadow:'0 6px 24px rgba(0,0,0,0.06)' }}>
          <h2 style={{ margin:0, fontSize:20 }}>Employee Login</h2>
          <div style={{ position:'relative', marginTop:12 }}>
            <input
              ref={inputRef}
              placeholder="Mobile Number (10 digits)"
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, ""))}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(()=>setShowSuggestions(false), 120)}
              maxLength={10}
              required
              style={{ width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:14 }}
            />
            <div style={{ fontSize:12, color:'#666', marginTop:6 }}>Enter 10-digit mobile number</div>
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
          <div style={{ marginTop: 10, textAlign:'center' }}>
            <button type="button" onClick={() => setShowRegister(s=>!s)} style={{ background:'transparent', border:'none', color:'#0077cc', cursor:'pointer', fontSize:13 }}>
              {showRegister ? 'Hide Registration' : 'New user? Register'}
            </button>
          </div>

          {showRegister && (
            <div className="card" style={{ marginTop:10, padding:12 }}>
              <div style={{ fontWeight:700, marginBottom:8, fontSize:14 }}>Register New Employee</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center' }}>
                <input
                  placeholder="Choose a username"
                  value={regUsername}
                  onChange={(e)=>{ setRegUsername(e.target.value.trim()); setUnameAvailable(null); setUnameSuggestions([]); }}
                  onBlur={async ()=>{
                    if (!regUsername) return;
                    try {
                      const r = await employeeCheckUsername(regUsername);
                      setUnameAvailable(!!r?.available);
                      if (r && r.available === false) {
                        // generate suggestions
                        const base = regUsername.replace(/[^a-zA-Z0-9_]/g,'').slice(0,16) || 'user';
                        const nums = Array.from({length:5},()=>String(Math.floor(100+Math.random()*900)));
                        setUnameSuggestions(nums.map(n=>`${base}${n}`));
                      }
                    } catch { setUnameAvailable(null); }
                  }}
                />
                <div style={{ fontSize:12 }}>
                  {unameAvailable === true && <span style={{ color:'#27ae60' }}>Available</span>}
                  {unameAvailable === false && <span style={{ color:'#e74c3c' }}>Not available</span>}
                </div>
              </div>
              {unameAvailable === false && unameSuggestions.length>0 && (
                <div style={{ fontSize:12, color:'#555', marginTop:4, display:'flex', gap:8, flexWrap:'wrap' }}>
                  <span>Suggestions:</span>
                  {unameSuggestions.map((sug, i)=> (
                    <button key={i} type="button" onClick={()=>{ setRegUsername(sug); setUnameAvailable(true); }} style={{ background:'#f1f5f9', border:'1px solid #e5e7eb', borderRadius:999, padding:'2px 8px', fontSize:12 }}>
                      {sug}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:8, marginTop:8 }}>
                <input placeholder="Email" value={regEmail} onChange={(e)=>setRegEmail(e.target.value)} />
                <input placeholder="Mobile (10 digits)" value={regMobile} onChange={(e)=>setRegMobile(e.target.value.replace(/[^0-9]/g,'').slice(0,10))} maxLength={10} />
                <div style={{ fontSize:12, color:'#666' }}>Enter 10-digit mobile number</div>
                <div style={{ position:'relative' }}>
                  <input type={showRegPwd ? 'text' : 'password'} placeholder="Password (8-20; a-z, A-Z, 0-9, one of .,&%#@!)" value={regPassword} onChange={(e)=>setRegPassword(e.target.value)} style={{ width:'100%', paddingRight:74 }} />
                  <button type="button" onClick={()=>setShowRegPwd(s=>!s)} style={{ position:'absolute', right:6, top:6, padding:'6px 10px', fontSize:12, border:'1px solid #ddd', background:'#f8f9fa', borderRadius:6 }}>
                    {showRegPwd ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input placeholder="4-digit PIN" value={regPin} onChange={(e)=>setRegPin(e.target.value.replace(/[^0-9]/g,'').slice(0,4))} maxLength={4} />
                <button type="button" onClick={async ()=>{
                  try {
                    // client validations
                    const uname = regUsername.trim();
                    if (!uname) { toast.error('Username required'); return; }
                    if (!/^\d{4}$/.test(regPin)) { toast.error('PIN must be 4 digits'); return; }
                    const pw = regPassword;
                    const strong = pw.length>=8 && pw.length<=20 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[\.,&%#@!]/.test(pw);
                    if (!strong) { toast.error('Password must be 8-20 chars with a-z, A-Z, 0-9 and one of .,&%#@!'); return; }
                    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(regEmail)) { toast.error('Enter a valid email'); return; }
                    if (String(regMobile||'').length !== 10) { toast.error('Enter 10-digit mobile'); return; }
                    setLoading(true);
                    const r = await employeeRegister({ username: uname, password: pw, pin: regPin, mobile: regMobile, email: regEmail });
                    if (r && r.status==='ok') {
                      toast.success('Registered successfully. You can now login.');
                      // Save PIN identity on this device for device-bound PIN login
                      savePinIdentity({ username: uname, mobile: regMobile, email: regEmail });
                      setShowRegister(false);
                      setRegUsername(''); setRegEmail(''); setRegMobile(''); setRegPassword(''); setRegPin(''); setUnameAvailable(null); setUnameSuggestions([]);
                    } else {
                      toast.error(r?.message || 'Registration failed');
                    }
                  } catch { toast.error('Error during registration'); } finally { setLoading(false); }
                }}>Register</button>
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={loading || mobile.length !== 10}
            style={{
              width:'100%', marginTop:12, padding:'12px 14px',
              background: loading ? '#444' : 'linear-gradient(90deg, #111, #2c3e50)',
              color:'#fff', border:'1px solid #111', borderRadius:10, fontWeight:700,
              display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8,
              boxShadow:'0 6px 18px rgba(0,0,0,0.18)'
            }}
          >
            <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13"/>
              <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
            {loading ? "Sending..." : "Send OTP"}
          </button>
          <div style={{ display:'flex', alignItems:'center', margin:'12px 0' }}>
            <div style={{ flex:1, height:1, background:'#eee' }} />
            <span style={{ margin:'0 8px', fontSize:12, color:'#888' }}>or</span>
            <div style={{ flex:1, height:1, background:'#eee' }} />
          </div>
          <div style={{ width:'100%', marginTop:4, display:'flex', justifyContent:'center', gap:12, flexWrap:'wrap' }}>
            <button
              type="button"
              onClick={async () => {
                try {
                  const email = window.prompt("Enter Google account email (demo)");
                  if (!email) return;
                  const res = await employeeGoogleLogin(email);
                  if (res && res.status === 'ok' && res.token) {
                    onSuccess({ token: res.token, mobile: res.mobile });
                    toast.success('Logged in with Google');
                  } else {
                    toast.error(res?.message || 'Google login failed');
                  }
                } catch {
                  toast.error('Error during Google login');
                }
              }}
              style={{
                padding:10, width:44, height:44, borderRadius:9999, border:'1px solid #ddd', background:'#fff', color:'#111', fontWeight:700,
                display:'inline-flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 12px rgba(0,0,0,0.06)'
              }}
              title="Continue with Google (demo)"
            >
              <svg aria-hidden xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.602 31.91 29.162 35 24 35c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.158 7.961 3.039l5.657-5.657C33.64 5.053 28.968 3 24 3 12.955 3 4 11.955 4 23s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.817C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.158 7.961 3.039l5.657-5.657C33.64 5.053 28.968 3 24 3 16.318 3 9.656 7.337 6.306 14.691z"/>
                <path fill="#4CAF50" d="M24 43c5.11 0 9.727-1.957 13.221-5.146l-6.106-5.159C29.066 34.836 26.671 36 24 36c-5.132 0-9.556-3.07-11.287-7.438l-6.55 5.047C9.478 39.556 16.227 43 24 43z"/>
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-1.037 3.01-3.166 5.466-5.888 7.012l-.001.001 6.106 5.159C39.353 36.521 44 30.732 44 23c0-1.341-.138-2.65-.389-3.917z"/>
              </svg>
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const email = window.prompt("Enter Apple account email (demo)");
                  if (!email) return;
                  const res = await employeeAppleLogin(email);
                  if (res && res.status === 'ok' && res.token) {
                    onSuccess({ token: res.token, mobile: res.mobile });
                    toast.success('Logged in with Apple');
                  } else {
                    toast.error(res?.message || 'Apple login failed');
                  }
                } catch {
                  toast.error('Error during Apple login');
                }
              }}
              style={{
                padding:10, width:44, height:44, borderRadius:9999, border:'1px solid #000', background:'#000', color:'#fff', fontWeight:700,
                display:'inline-flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 12px rgba(0,0,0,0.16)'
              }}
              title="Sign in with Apple (demo)"
            >
              <svg aria-hidden xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16.365 1.43c0 1.14-.47 2.217-1.225 3.019-.78.83-2.05 1.474-3.128 1.37-.136-1.093.396-2.254 1.15-3.06.785-.84 2.173-1.465 3.203-1.329zM20.7 17.284c-.6 1.384-.886 1.987-1.656 3.21-1.073 1.68-2.58 3.778-4.449 3.796-1.661.016-2.096-1.118-4.364-1.106-2.269.012-2.735 1.124-4.397 1.11-1.869-.016-3.299-1.905-4.372-3.583C-.163 17.7-.78 13.91.885 11.284c1.28-2.015 3.317-3.195 5.223-3.195 1.936 0 3.154 1.107 4.758 1.107 1.57 0 2.526-1.11 4.75-1.11 1.623 0 3.347.885 4.62 2.41-4.052 2.208-3.398 7.98-.536 9.798z"/>
              </svg>
            </button>
          </div>
        </form>
        )}

        {mode === 'mobile' && step === "otp" && (
        <form onSubmit={verifyOtp} style={{ width:'100%', background:'#fff', border:'1px solid #eee', borderRadius:12, padding:18, boxShadow:'0 6px 24px rgba(0,0,0,0.06)' }}>
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

        {mode === 'password' && (
          <div className="card" style={{ padding:18, background:'#fff', border:'1px solid #eee', borderRadius:12, boxShadow:'0 6px 24px rgba(0,0,0,0.06)' }}>
            <h2 style={{ margin:0, fontSize:20 }}>Login with Username & Password</h2>
            <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:10, marginTop:12 }}>
              <input placeholder="Username or Email" value={uname} onChange={(e)=>setUname(e.target.value)} />
              <div style={{ position:'relative' }}>
                <input type={showPwd ? 'text' : 'password'} placeholder="Password" value={pwd} onChange={(e)=>setPwd(e.target.value)} style={{ width:'100%', paddingRight:74 }} />
                <button type="button" onClick={()=>setShowPwd(s=>!s)} style={{ position:'absolute', right:6, top:6, padding:'6px 10px', fontSize:12, border:'1px solid #ddd', background:'#f8f9fa', borderRadius:6 }}>
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (!uname || !pwd) { toast.error('Enter username and password'); return; }
                    setLoading(true);
                    const res = await employeePasswordLogin(uname, pwd);
                    if (res && res.status === 'ok' && res.token) {
                      onSuccess({ token: res.token, mobile: res.mobile });
                      toast.success('Logged in');
                      if (res.username || uname) {
                        savePinIdentity({ username: res.username || uname, mobile: res.mobile, email: res.email });
                      }
                    } else {
                      toast.error(res?.message || 'Login failed');
                    }
                  } catch { toast.error('Error during login'); } finally { setLoading(false); }
                }}
                style={{ width:'100%', padding:'10px 12px', background:'#111', color:'#fff', border:'1px solid #111', borderRadius:8, fontWeight:600 }}
              >Login</button>
            </div>
          </div>
        )}

        {mode === 'pin' && (
          <div className="card" style={{ padding:18, background:'#fff', border:'1px solid #eee', borderRadius:12, boxShadow:'0 6px 24px rgba(0,0,0,0.06)' }}>
            <h2 style={{ margin:0, fontSize:20 }}>Login with 4-digit PIN</h2>
            <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8, marginTop:12, alignItems:'center' }}>
              <input placeholder="Enter 4-digit PIN" maxLength={4} value={pin} onChange={(e)=>setPin(e.target.value.replace(/[^0-9]/g,'').slice(0,4))} />
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (!/^\d{4}$/.test(pin)) { toast.error('Enter your 4-digit PIN'); return; }
                    const ident = getPinIdentity();
                    if (!ident || !ident.username) {
                      toast.error('PIN login not set up on this device. Please register or login once with username/password.');
                      return;
                    }
                    setLoading(true);
                    const res = await employeePinLogin(ident.username, pin, ident.mobile || ident.email);
                    if (res && res.status === 'ok' && res.token) {
                      onSuccess({ token: res.token, mobile: res.mobile });
                      toast.success('Logged in');
                    } else {
                      toast.error(res?.message || 'PIN login failed');
                    }
                  } catch { toast.error('Error during PIN login'); } finally { setLoading(false); }
                }}
              >Enter</button>
            </div>
            <div style={{ fontSize:12, color:'#666', marginTop:6 }}>
              PIN must be exactly 4 digits. PIN is device-bound here; registration or a prior login sets it up for this device.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeLogin;
EmployeeLogin.propTypes = {
  onSuccess: PropTypes.func.isRequired,
};
